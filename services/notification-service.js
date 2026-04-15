/**
 * KOMERCE — Notification Service v4.0 (COLIS-FIRST)
 *
 * WhatsApp via TWILIO (principal) + Email via Brevo + SMS via Africa's Talking
 * + Facture envoyée après confirmation paiement cash
 * + Logging en DB (notification_log)
 *
 * v4.0 — Twilio WhatsApp (principal) + Brevo email
 *         Facture WhatsApp à la confirmation cash
 *         Flux corrigé: confirmed → ordered → preparation → shipped...
 */

'use strict';

const { sendSMS }        = require('../utils/sms');
const { sendOrderEmail } = require('../utils/email');
const db                 = require('../db');

// ─── Config ─────────────────────────────────────────────────

const BREVO_KEY      = process.env.BREVO_API_KEY || '';
const TWILIO_SID     = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_TOKEN   = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_WA_FROM = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';

// Statuts pour lesquels on envoie un EMAIL (4 étapes clés uniquement)
// ❌ collected retiré — pas d'email pour la remise (user instruction)
const EMAIL_STATUSES = new Set(['confirmed', 'shipped', 'available', 'cancelled']);

// ─── SMS templates ──────────────────────────────────────────

const STATUS_SMS = {
  ordered:     (ref) => `Komerce : Commande ${ref} lancée ! Votre colis est en cours de traitement.`,
  preparation: (ref) => `Komerce : Commande ${ref} — colis reçu au Hub, contrôle qualité en cours.`,
  shipped:     (ref) => `Komerce : Commande ${ref} — votre colis est prêt, remis au transitaire.`,
  in_transit:  (ref) => `Komerce : Commande ${ref} — votre colis est embarqué ! 🚢`,
  available:   (ref, relais) => `Komerce : Commande ${ref} disponible au relais ${relais || ''}. Venez le récupérer !`,
  collected:   (ref) => `Komerce : Commande ${ref} remise. Merci de votre confiance ! 🎉`,
};

// ─── WhatsApp message templates ─────────────────────────────

const WA_MESSAGES = {
  payment_confirmed: (d) =>
    `✅ *Paiement confirmé*\n\nBonjour ${d.customerName},\nVotre commande *${d.orderRef}* est confirmée.\n\n💰 *Total : ${Number(d.totalKmf).toLocaleString()} KMF*\n\nVotre colis sera préparé très bientôt !\n— Komerce 🛒`,

  invoice: (d) =>
    `🧾 *FACTURE ${d.invoiceNum}*\n\nBonjour ${d.customerName},\n\n${d.itemsText}\n\n━━━━━━━━━━━━━━━━━━\n💰 *TOTAL : ${Number(d.totalKmf).toLocaleString()} KMF*\n━━━━━━━━━━━━━━━━━━\n\n✅ Paiement : ${d.paymentLabel}\nRéf commande : ${d.orderRef}\n\nMerci pour votre confiance ! 🙏\n— Komerce`,

  parcel_created: (d) =>
    `📦 *Colis créé*\n\nBonjour ${d.customerName},\nVotre colis *${d.parcelRef}* a été créé pour la commande *${d.orderRef}*.\n\nIl est maintenant en préparation au Hub !\n— Komerce 🛒`,

  preparation: (d) =>
    `📦 *Colis en préparation*\n\nBonjour ${d.customerName},\nVotre colis *${d.parcelRef}* est en cours de préparation au hub.\n\n— Komerce 🛒`,

  shipped: (d) =>
    `✈️ *Colis expédié*\n\nBonjour ${d.customerName},\nVotre colis *${d.parcelRef}* a été expédié vers *${d.island || 'les Comores'}*.\n\nVous serez notifié(e) dès son arrivée au relais.\n— Komerce 🛒`,

  in_transit: (d) =>
    `🚢 *Colis en transit*\n\nBonjour ${d.customerName},\nVotre colis *${d.parcelRef}* est en route vers *${d.island || 'les Comores'}* !\n\n— Komerce 🛒`,

  available: (d) =>
    `📍 *Colis disponible !*\n\nBonjour ${d.customerName},\nVotre colis *${d.parcelRef}* est disponible au relais :\n📍 *${d.relaisName || d.island || ''}*\n\n🔑 Code de retrait : *${d.pickupCode || '—'}*\n\nPrésentez ce code pour récupérer votre colis.\n— Komerce 🛒`,

  collected: (d) =>
    `✅ *Colis remis*\n\nBonjour ${d.customerName},\nVotre colis *${d.parcelRef}* vous a été remis avec succès.\n\nMerci pour votre confiance ! 🙏\n— Komerce 🛒`,

  incident: (d) =>
    `🚨 *Incident signalé*\n\nBonjour ${d.customerName},\nUn incident a été signalé sur votre colis *${d.parcelRef}*.\n\nNotre équipe traite le problème.\n— Komerce 🛒`,

  order_created_cash: (d) =>
    `🛒 *Commande enregistrée !*\n\nBonjour ${d.customerName},\nVotre commande *${d.orderRef}* a bien été enregistrée.\n\n${d.itemsText}\n\n━━━━━━━━━━━━━━━━━━\n💰 *Total : ${Number(d.totalKmf).toLocaleString()} KMF*\n━━━━━━━━━━━━━━━━━━\n\n🏪 *Relais : ${d.relaisName || 'votre relais'}*\n🔑 *Code de paiement : ${d.cashCode}*\n\n📋 *Prochaine étape :*\nRendez-vous au relais pour payer en espèces.\nPrésentez votre code *${d.cashCode}* ou la référence *${d.orderRef}*.\n\n⏰ Vous avez 36h pour régler.\n\n📍 Suivre ma commande :\n${d.trackingUrl}\n\n— Komerce 🛒`,

  order_created_stripe: (d) =>
    `🛒 *Commande confirmée !*\n\nBonjour ${d.customerName},\nVotre commande *${d.orderRef}* est confirmée et payée ✅\n\n${d.itemsText}\n\n━━━━━━━━━━━━━━━━━━\n💰 *Total : ${Number(d.totalKmf).toLocaleString()} KMF*\n━━━━━━━━━━━━━━━━━━\n\n✅ Paiement en ligne reçu.\nVotre commande est en cours de traitement !\n\n📍 Suivre ma commande :\n${d.trackingUrl}\n\n— Komerce 🛒`,
};

// ─── WhatsApp wa.me link generator ──────────────────────────

function getWhatsAppLink(phone, text) {
  if (!phone) return null;
  const clean = phone.replace(/[^0-9]/g, '');
  return `https://wa.me/${clean}?text=${encodeURIComponent(text)}`;
}

// ─── WhatsApp send via TWILIO (PRINCIPAL) ───────────────────

async function sendWhatsAppTwilio(phone, text) {
  if (!TWILIO_SID || !TWILIO_TOKEN) {
    return { success: false, provider: 'twilio', reason: 'no_config' };
  }
  if (!phone) return { success: false, provider: 'twilio', reason: 'no_phone' };

  const cleanPhone = phone.replace(/[^0-9+]/g, '');
  const to = cleanPhone.startsWith('whatsapp:') ? cleanPhone : `whatsapp:${cleanPhone}`;

  try {
    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: TWILIO_WA_FROM,
          To: to,
          Body: text,
        }),
      }
    );
    const data = await resp.json();
    if (data.sid) {
      console.log(`[WA-TWILIO] ✅ → ${phone} (SID: ${data.sid})`);
      return { success: true, provider: 'twilio', sid: data.sid, status: data.status };
    }
    console.error(`[WA-TWILIO] ❌ ${resp.status}:`, data.message || JSON.stringify(data).substring(0, 200));
    return { success: false, provider: 'twilio', reason: data.message || 'api_error', code: data.code };
  } catch (err) {
    console.error('[WA-TWILIO] ❌', err.message);
    return { success: false, provider: 'twilio', reason: 'exception', detail: err.message };
  }
}

// ─── WhatsApp send via Brevo API (fallback) ─────────────────

async function sendWhatsAppBrevo(phone, text) {
  if (!BREVO_KEY) return { success: false, provider: 'brevo', reason: 'no_api_key' };
  if (!phone) return { success: false, provider: 'brevo', reason: 'no_phone' };

  try {
    const resp = await fetch('https://api.brevo.com/v3/whatsapp/sendMessage', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        senderNumber: process.env.WHATSAPP_SENDER || process.env.BREVO_SENDER_PHONE || '',
        recipientNumber: phone.replace(/[^0-9+]/g, ''),
        text,
        type: 'text'
      })
    });
    const data = await resp.json();
    if (resp.ok) {
      console.log(`[WA-BREVO] ✅ → ${phone}`);
      return { success: true, provider: 'brevo', messageId: data.messageId || data.id };
    }
    return { success: false, provider: 'brevo', reason: 'api_error', status: resp.status };
  } catch (err) {
    return { success: false, provider: 'brevo', reason: 'exception', detail: err.message };
  }
}

// ─── Unified WhatsApp sender ────────────────────────────────

async function sendWhatsApp(phone, text) {
  if (!phone) return { success: false, reason: 'no_phone' };

  // 1. Try Twilio (principal)
  let result = await sendWhatsAppTwilio(phone, text);

  // 2. Fallback: Brevo
  if (!result.success) {
    result = await sendWhatsAppBrevo(phone, text);
  }

  // 3. Always generate wa.me link
  const waLink = getWhatsAppLink(phone, text);

  if (!result.success) {
    console.log(`[WA] ⚠️ APIs failed — wa.me link: ${waLink?.substring(0, 60)}...`);
    return { success: false, provider: 'link', link: waLink, apiResult: result };
  }

  result.link = waLink;
  return result;
}


// ─── Get unique phone numbers (local + diaspora) ────────────

function getUniquePhones(localPhone, diasporaPhone) {
  const phones = [];
  const seen = new Set();
  for (const p of [localPhone, diasporaPhone]) {
    if (!p) continue;
    const clean = p.replace(/[^0-9+]/g, '');
    if (clean.length >= 8 && !seen.has(clean)) {
      seen.add(clean);
      phones.push(clean);
    }
  }
  return phones;
}

// ─── Log notification to DB ─────────────────────────────────

async function logNotification({ parcelRef, orderRef, channel, event, recipient, status, detail }) {
  try {
    await db.query(`
      INSERT INTO notification_log (parcel_ref, order_ref, channel, event, recipient, status, detail, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `, [parcelRef || null, orderRef || null, channel, event, recipient, status, JSON.stringify(detail || {})]);
  } catch (err) {
    if (err.code === '42P01') {
      console.warn('[NOTIF-LOG] ⚠️ Table notification_log inexistante');
    } else {
      console.error('[NOTIF-LOG] ⚠️', err.message);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API — COLIS-FIRST notifications
// ═══════════════════════════════════════════════════════════════

/**
 * Called after a SCAN (parcel status change)
 */
async function notifyParcelScan(parcelId, parcelRef, newStatus, extraData = {}) {
  try {
    const { rows } = await db.query(`
      SELECT 
        p.reference AS parcel_ref, p.pickup_code, p.destination_island,
        r.name AS relais_name, r.island AS relais_island,
        o.reference AS order_ref, o.total_kmf,
        o.payment_mode, o.payment_status,
        COALESCE( u.full_name, p.recipient_name) AS customer_name,
        u.phone AS local_phone,
        u.whatsapp_phone AS diaspora_phone,
        COALESCE(u.phone, p.recipient_phone) AS fallback_phone,
        u.email AS customer_email,
        o.id AS order_id, o.cash_ref_code
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN relais r ON r.id = COALESCE(p.relais_id, o.relais_id)
      WHERE p.id = $1::uuid
    `, [parcelId]);

    if (!rows.length) {
      console.warn(`[NOTIF] ⚠️ Colis ${parcelRef} introuvable`);
      return null;
    }

    const results = { whatsapp: [], email: [], sms: [] };

    for (const row of rows) {
      const d = {
        customerName: row.customer_name || 'Client',
        parcelRef: row.parcel_ref,
        orderRef: row.order_ref,
        totalKmf: row.total_kmf,
        island: row.relais_island || row.destination_island,
        relaisName: row.relais_name,
        pickupCode: row.pickup_code,
      };

      // Build list of ALL unique phones (local +269 + diaspora +33)
      const allPhones = getUniquePhones(row.local_phone || row.fallback_phone, row.diaspora_phone);

      // 1. WhatsApp → send to ALL phones (local + diaspora)
      const waTemplate = WA_MESSAGES[newStatus];
      if (waTemplate && allPhones.length > 0) {
        const waText = waTemplate(d);
        for (const phone of allPhones) {
          const waResult = await sendWhatsApp(phone, waText);
          results.whatsapp.push(waResult);
          
          await logNotification({
            parcelRef: row.parcel_ref, orderRef: row.order_ref,
            channel: 'whatsapp', event: `scan_${newStatus}`,
            recipient: phone,
            status: waResult.success ? 'sent' : 'link_generated',
            detail: waResult
          });
        }
      }

      // 2. Email (key stages only)
      if (EMAIL_STATUSES.has(newStatus) && row.customer_email) {
        const emailData = {
          reference: row.order_ref || row.parcel_ref,
          customer_name: row.customer_name,
          customer_email: row.customer_email,
          total_kmf: row.total_kmf,
          payment_mode: row.payment_mode,
          relay_name: row.relais_name,
          cash_ref_code: row.pickup_code || row.cash_ref_code,
        };
        const emailResult = await sendOrderEmail(emailData, newStatus);
        results.email.push(emailResult);
        
        await logNotification({
          parcelRef: row.parcel_ref, orderRef: row.order_ref,
          channel: 'email', event: `scan_${newStatus}`,
          recipient: row.customer_email,
          status: emailResult?.sent ? 'sent' : 'skipped',
          detail: emailResult
        });
      }

      // 3. SMS → send to ALL phones
      if (allPhones.length > 0 && STATUS_SMS[newStatus]) {
        for (const phone of allPhones) {
          const smsText = STATUS_SMS[newStatus](row.order_ref || row.parcel_ref, row.relais_name);
          sendSMS(phone, smsText, `parcel_${newStatus}`, row.order_id)
            .then(r => logNotification({
              parcelRef: row.parcel_ref, orderRef: row.order_ref,
              channel: 'sms', event: `scan_${newStatus}`,
              recipient: phone, status: 'sent', detail: r
            }))
            .catch(e => logNotification({
              parcelRef: row.parcel_ref, orderRef: row.order_ref,
              channel: 'sms', event: `scan_${newStatus}`,
              recipient: phone, status: 'failed', detail: { error: e.message }
            }));
          results.sms.push({ queued: true, phone });
        }
      }
    }

    console.log(`[NOTIF] 📬 Scan ${newStatus} → ${parcelRef} | WA:${results.whatsapp.length} Email:${results.email.length} SMS:${results.sms.length}`);
    return results;
  } catch (err) {
    console.error(`[NOTIF] ❌ notifyParcelScan(${parcelRef}, ${newStatus}):`, err.message);
    return null;
  }
}

/**
 * Called when cash payment is confirmed
 * → Generates invoice + sends WhatsApp with invoice details
 */
async function notifyPaymentConfirmed(orderId, orderRef) {
  try {
    const { rows: [order] } = await db.query(`
      SELECT o.id, o.reference, o.total_kmf, o.payment_mode,
        u.full_name AS customer_name,
        u.phone AS local_phone,
        u.whatsapp_phone AS diaspora_phone,
        u.email AS customer_email,
        r.name AS relais_name
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN relais r ON r.id = o.relais_id
      WHERE o.id = $1::uuid
    `, [orderId]);

    if (!order) return null;

    // Build list of ALL phone numbers to notify
    order.all_phones = getUniquePhones(order.local_phone, order.diaspora_phone);
    order.customer_phone = order.all_phones[0] || null;

    // ── Fetch order items for invoice ──
    const { rows: items } = await db.query(`
      SELECT oi.quantity, oi.price_kmf, p.name AS product_name
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1::uuid
    `, [orderId]);

    // ── Generate invoice ──
    const { v4: uuidv4 } = require('uuid');
    const year = new Date().getFullYear();
    let invNum = null;

    try {
      const { rows: [{ max_seq }] } = await db.query(
        `SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM 'INV-\\d{4}-(\\d+)') AS INT)), 0) AS max_seq
         FROM invoices WHERE invoice_number LIKE $1`, [`INV-${year}-%`]
      );
      const seq = (max_seq || 0) + 1;
      invNum = `INV-${year}-${String(seq).padStart(4, '0')}`;

      const itemsSnapshot = items.map(i => ({
        product_name: i.product_name || 'Article',
        quantity: i.quantity,
        price_kmf: Number(i.price_kmf),
      }));

      await db.query(`
        INSERT INTO invoices (
          id, invoice_number, order_id,
          client_name, client_phone, relay_name,
          items_snapshot, subtotal_kmf, shipping_kmf, total_kmf,
          payment_mode, payment_status, created_at
        ) VALUES (
          $1::uuid, $2, $3::uuid,
          $4, $5, $6,
          $7::jsonb, $8, 0, $9,
          $10, 'paid', NOW()
        )
      `, [
        uuidv4(), invNum, orderId,
        order.customer_name, order.customer_phone, order.relais_name,
        JSON.stringify(itemsSnapshot), order.total_kmf, order.total_kmf,
        order.payment_mode,
      ]);

      console.log(`🧾 Invoice ${invNum} created for ${orderRef}`);
    } catch (invErr) {
      console.error(`[INVOICE] ⚠️ ${invErr.message}`);
    }

    const results = {};

    // ── Build items text for WhatsApp ──
    const itemsText = items.map(i =>
      `• ${i.product_name || 'Article'} ×${i.quantity} — ${Number(i.price_kmf).toLocaleString()} KMF`
    ).join('\n');

    const payLabel = order.payment_mode === 'cash_relais' ? 'Cash au relais ✅' : 'En ligne ✅';

    // ── WhatsApp: invoice message → ALL phones (local + diaspora) ──
    const d = {
      customerName: order.customer_name || 'Client',
      orderRef: order.reference,
      totalKmf: order.total_kmf,
      invoiceNum: invNum || order.reference,
      itemsText,
      paymentLabel: payLabel,
    };

    results.whatsapp = [];
    for (const phone of order.all_phones) {
      const waText = WA_MESSAGES.invoice(d);
      const waResult = await sendWhatsApp(phone, waText);
      results.whatsapp.push(waResult);

      await logNotification({
        orderRef: order.reference,
        channel: 'whatsapp', event: 'payment_confirmed_invoice',
        recipient: phone,
        status: waResult.success ? 'sent' : 'link_generated',
        detail: { ...waResult, invoice: invNum }
      });
    }

    // ── Email ──
    if (order.customer_email) {
      const emailData = {
        reference: order.reference,
        customer_name: order.customer_name,
        customer_email: order.customer_email,
        total_kmf: order.total_kmf,
        payment_mode: order.payment_mode,
        relay_name: order.relais_name,
      };
      results.email = await sendOrderEmail(emailData, 'confirmed');

      await logNotification({
        orderRef: order.reference,
        channel: 'email', event: 'payment_confirmed',
        recipient: order.customer_email,
        status: results.email?.sent ? 'sent' : 'skipped',
        detail: results.email
      });
    }

    console.log(`[NOTIF] 💰 Payment confirmed + invoice → ${orderRef} | ${order.customer_name}`);
    return { ...results, invoice: invNum };
  } catch (err) {
    console.error(`[NOTIF] ❌ notifyPaymentConfirmed(${orderRef}):`, err.message);
    return null;
  }
}

/**
 * Called when a parcel is created for an order
 */
async function notifyParcelCreated(parcelRef, orderId, orderRef) {
  try {
    const { rows: [data] } = await db.query(`
      SELECT o.reference AS order_ref, o.total_kmf,
        u.full_name AS customer_name,
        u.phone AS local_phone,
        u.whatsapp_phone AS diaspora_phone,
        u.email AS customer_email
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.id = $1::uuid
    `, [orderId]);

    if (!data) return null;

    const d = {
      customerName: data.customer_name || 'Client',
      parcelRef,
      orderRef: data.order_ref,
      totalKmf: data.total_kmf,
    };

    // Send to ALL phones (local + diaspora)
    const allPhones = getUniquePhones(data.local_phone, data.diaspora_phone);
    for (const phone of allPhones) {
      const waText = WA_MESSAGES.parcel_created(d);
      const result = await sendWhatsApp(phone, waText);
      await logNotification({
        parcelRef, orderRef: data.order_ref,
        channel: 'whatsapp', event: 'parcel_created',
        recipient: phone,
        status: result.success ? 'sent' : 'link_generated',
        detail: result
      });
    }

    console.log(`[NOTIF] 📦 Parcel created → ${parcelRef} for ${orderRef}`);
  } catch (err) {
    console.error(`[NOTIF] ❌ notifyParcelCreated:`, err.message);
  }
}

// ─── Legacy exports (backward compat) ───────────────────────

function notifyStatusChange(order, status) {
  const phone = order.user_phone;
  if (phone && STATUS_SMS[status]) {
    sendSMS(phone, STATUS_SMS[status](order.reference, order.relais_name), status, order.id)
      .catch(e => console.error('[NOTIF-SMS]', e.message));
  }
  if (EMAIL_STATUSES.has(status)) {
    sendOrderEmail(order, status).catch(e => console.error('[NOTIF-EMAIL]', e.message));
  }
}

async function notifyOrderCreated(order, phone, email, emailItems, relais, cashSmsText) {
  const BASE_URL = process.env.BASE_URL || 'https://komerce-backend-production.up.railway.app';
  const trackingUrl = `${BASE_URL}/suivi.html`;

  try {
    // Build items text for WhatsApp
    const itemsText = (emailItems || []).map(i =>
      `• ${i.name || 'Article'} ×${i.qty} — ${Number(i.price_kmf).toLocaleString()} KMF`
    ).join('\n') || '(voir détails sur la boutique)';

    const d = {
      customerName: order.recipient_name || order.customer_name || 'Client',
      orderRef: order.reference,
      totalKmf: order.total_kmf,
      relaisName: relais?.name || '',
      cashCode: order.cash_ref_code || '',
      trackingUrl,
      itemsText,
    };

    // ── WhatsApp via Twilio (PRINCIPAL) ──
    if (phone) {
      const isCash = order.payment_mode === 'cash_relais';
      const waTemplate = isCash ? WA_MESSAGES.order_created_cash : WA_MESSAGES.order_created_stripe;
      const waText = waTemplate(d);
      const waResult = await sendWhatsApp(phone, waText);

      await logNotification({
        orderRef: order.reference,
        channel: 'whatsapp',
        event: isCash ? 'order_created_cash' : 'order_created_stripe',
        recipient: phone,
        status: waResult.success ? 'sent' : 'link_generated',
        detail: waResult,
      });

      console.log(`[NOTIF] 🛒 Order created WA → ${order.reference} (${isCash ? 'cash' : 'stripe'}) → ${phone} | ${waResult.success ? '✅' : '⚠️'}`);
    }

    // ── SMS fallback (Africa's Talking) ──
    if (phone) {
      const smsText = cashSmsText || STATUS_SMS.ordered(order.reference);
      sendSMS(phone, smsText, order.payment_mode === 'cash_relais' ? 'cash_relais_confirm' : 'confirmation', order.id)
        .catch(e => console.error('[NOTIF-SMS]', e.message));
    }

    // ── Email ──
    if (email) {
      sendOrderEmail({ ...order, customer_email: email, relay_name: relais?.name }, 'confirmed')
        .catch(e => console.error('[NOTIF-EMAIL]', e.message));
    }
  } catch (err) {
    console.error(`[NOTIF] ❌ notifyOrderCreated(${order.reference}):`, err.message);
    // Fallback to legacy SMS if WhatsApp fails completely
    if (phone) {
      const smsText = cashSmsText || STATUS_SMS.ordered(order.reference);
      sendSMS(phone, smsText, 'fallback', order.id).catch(() => {});
    }
  }
}

function notifyParcelStatus(parcel, status) {
  if (parcel.user_phone && STATUS_SMS[status]) {
    sendSMS(parcel.user_phone, STATUS_SMS[status](parcel.reference, parcel.relais_name), `parcel_${status}`, parcel.parent_id)
      .catch(e => console.error('[NOTIF-SMS]', e.message));
  }
}

function notifyCancellation(order, refundInfo) {
  const phone = order.user_phone;
  if (phone) {
    let smsText = refundInfo?.method === 'stripe'
      ? `Komerce : ${order.reference} annulée. Remboursement ${refundInfo.amountEur.toFixed(2)}EUR en cours.`
      : `Komerce : ${order.reference} annulée.`;
    sendSMS(phone, smsText, 'cancellation', order.id).catch(e => console.error('[NOTIF-SMS]', e.message));
  }
  sendOrderEmail({ ...order, refund_info: refundInfo ? 'Voir détails' : null }, 'cancelled')
    .catch(e => console.error('[NOTIF-EMAIL]', e.message));
}

function sendCashReminder(order) {
  sendOrderEmail(order, 'cash_reminder').catch(e => console.error('[NOTIF-EMAIL]', e.message));
}

function getCashReminderWA(order) {
  const phone = order.user_phone || order.phone;
  if (!phone) return null;
  return getWhatsAppLink(phone, `Rappel : votre colis ${order.reference} vous attend au relais. Montant : ${(order.total_kmf||0).toLocaleString()} KMF 💰`);
}

module.exports = {
  // New COLIS-FIRST API
  notifyParcelScan,
  notifyPaymentConfirmed,
  notifyParcelCreated,
  sendWhatsApp,
  sendWhatsAppTwilio,
  logNotification,
  WA_MESSAGES,
  
  // Legacy exports
  notifyStatusChange,
  notifyOrderCreated,
  notifyParcelStatus,
  notifyCancellation,
  sendCashReminder,
  getCashReminderWA,
  getWhatsAppLink,
  STATUS_SMS,
};

