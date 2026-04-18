/**
 * KOMERCE — Notification Service v5.1
 *
 * 4 moments de notification uniquement :
 * ┌─────────────────────────┬──────────────────┬────────────────────┐
 * │ Moment                  │ Cash             │ Stripe             │
 * ├─────────────────────────┼──────────────────┼────────────────────┤
 * │ 1. Création commande    │ Récap + code     │ — (skip)           │
 * │ 2. Paiement confirmé    │ Facture          │ Récap + facture    │
 * │ 3. Expédié (shipped)    │ WhatsApp         │ WhatsApp           │
 * │ 4. Disponible (avail.)  │ WhatsApp         │ WhatsApp           │
 * └─────────────────────────┴──────────────────┴────────────────────┘
 *
 * Canal principal : WhatsApp via Twilio
 * Email : shipped + available + cancelled uniquement
 *
 * Mode test/dev :
 * - on évite de spammer les numéros locaux +269
 * - support des tableaux de numéros (local + diaspora)
 */

'use strict';

// ─── Simulation Mode Guard ──────────────────────────────────
function isSimulation() {
  return !!global.__SIMULATION_ACTIVE;
}

const { sendSMS }        = require('../utils/sms');
const { sendOrderEmail } = require('../utils/email');
const db                 = require('../db');

// ─── Config ─────────────────────────────────────────────────

const BREVO_KEY      = process.env.BREVO_API_KEY || '';
const TWILIO_SID     = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_TOKEN   = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_WA_FROM = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
const BASE_URL       = process.env.BASE_URL || 'https://komerce-backend-production.up.railway.app';
const META_WA_TOKEN           = process.env.META_WA_TOKEN || '';
const META_WA_PHONE_NUMBER_ID = process.env.META_WA_PHONE_NUMBER_ID || '';
const META_WA_GRAPH_VERSION   = process.env.META_WA_GRAPH_VERSION || 'v23.0';

// Statuts qui déclenchent un email (en complément du WhatsApp)
const EMAIL_STATUSES = new Set(['shipped', 'available', 'cancelled']);

// Statuts qui déclenchent une notif WhatsApp au scan colis
const WA_SCAN_STATUSES = new Set(['shipped', 'available']);

// ─── Helpers environnement test ─────────────────────────────

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function normalizePhone(phone) {
  if (!phone) return null;
  const clean = String(phone).replace(/[^0-9+]/g, '');
  return clean.length >= 8 ? clean : null;
}

function isComorosPhone(phone) {
  const p = normalizePhone(phone);
  return !!p && p.startsWith('+269');
}

// Autorisations explicites possibles en dev/test
// Exemples:
// NOTIF_TEST_ALLOW_PHONES=+33611111111,+2691234567
function getAllowedTestPhones() {
  const raw = process.env.NOTIF_TEST_ALLOW_PHONES || '';
  if (!raw.trim()) return new Set();
  return new Set(
    raw
      .split(',')
      .map(s => normalizePhone(s.trim()))
      .filter(Boolean)
  );
}

/**
 * Filtre de sécurité pour tests/dev :
 * - en prod : on laisse tout passer
 * - en simulation : getUniquePhones() gère déjà la préférence diaspora
 * - en dev/test : on bloque les +269 sauf whitelist explicite
 */
function filterTestPhones(phones, context = 'unknown') {
  const list = Array.isArray(phones) ? phones : [phones];
  const normalized = [...new Set(list.map(normalizePhone).filter(Boolean))];

  if (isProduction()) {
    return normalized;
  }

  const allowed = getAllowedTestPhones();
  const kept = [];

  for (const phone of normalized) {
    if (allowed.has(phone)) {
      console.log(`[NOTIF-TEST] ✅ whitelisted → ${phone} (${context})`);
      kept.push(phone);
      continue;
    }

    if (isComorosPhone(phone)) {
      console.log(`[NOTIF-TEST] 🚫 local +269 bloqué en test/dev → ${phone} (${context})`);
      continue;
    }

    kept.push(phone);
  }

  return kept;
}
function getMetaWhatsAppUrl() {
  return `https://graph.facebook.com/${META_WA_GRAPH_VERSION}/${META_WA_PHONE_NUMBER_ID}/messages`;
}

function normalizeMetaPhone(phone) {
  if (!phone) return null;
  return String(phone).replace(/[^\d]/g, '');
}

// ─── WhatsApp message templates ─────────────────────────────

const WA_MESSAGES = {
  // ① Création commande CASH (1er message)
  order_created_cash: (d) =>
    `🛒 *Commande enregistrée !*\n\n` +
    `Bonjour ${d.customerName},\n` +
    `Votre commande *${d.orderRef}* a bien été enregistrée.\n\n` +
    `${d.itemsText}\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `💰 *Total : ${Number(d.totalKmf).toLocaleString()} KMF*\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `🏪 *Relais : ${d.relaisName || 'votre relais'}*\n` +
    `🔑 *Code de paiement : ${d.cashCode}*\n\n` +
    `📋 *Prochaine étape :*\n` +
    `Rendez-vous au relais pour payer en espèces.\n` +
    `Présentez votre code *${d.cashCode}* ou la référence *${d.orderRef}*.\n\n` +
    `⏰ Vous avez 36h pour régler.\n\n` +
    `📍 Suivre ma commande :\n${d.trackingUrl}\n\n` +
    `— Komerce 🛒`,

  // ② Facture (cash: 2ème message | stripe: 1er message)
  invoice: (d) =>
    `🧾 *FACTURE ${d.invoiceNum}*\n\n` +
    `Bonjour ${d.customerName},\n\n` +
    `${d.itemsText}\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `💰 *TOTAL : ${Number(d.totalKmf).toLocaleString()} KMF*\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `✅ Paiement : ${d.paymentLabel}\n` +
    `Réf commande : ${d.orderRef}\n\n` +
    `📍 Suivre ma commande :\n${d.trackingUrl}\n\n` +
    `Merci pour votre confiance ! 🙏\n` +
    `— Komerce`,

  // ③ Colis expédié
  shipped: (d) =>
    `✈️ *Colis expédié !*\n\n` +
    `Bonjour ${d.customerName},\n` +
    `Votre colis pour la commande *${d.orderRef}* a été expédié` +
    `${d.island ? ' vers *' + d.island + '*' : ''} !\n\n` +
    `Vous serez notifié(e) dès qu'il sera disponible au relais.\n\n` +
    `📍 Suivre ma commande :\n${d.trackingUrl}\n\n` +
    `— Komerce 🛒`,

  // ④ Colis disponible au relais
  available: (d) =>
    `📍 *Colis disponible !*\n\n` +
    `Bonjour ${d.customerName},\n` +
    `Votre colis pour la commande *${d.orderRef}* est disponible :\n` +
    `📍 *${d.relaisName || d.island || ''}*\n\n` +
    `🔑 Code de retrait : *${d.pickupCode || '—'}*\n\n` +
    `Présentez ce code pour récupérer votre colis.\n\n` +
    `— Komerce 🛒`,
};

// ─── SMS templates (fallback) ───────────────────────────────

const STATUS_SMS = {
  shipped:   (ref) => `Komerce : ${ref} — votre colis a été expédié ! ✈️`,
  available: (ref, relais) => `Komerce : ${ref} disponible au relais ${relais || ''}. Venez le récupérer ! 📍`,
};

// ─── WhatsApp wa.me link generator ──────────────────────────

function getWhatsAppLink(phone, text) {
  if (!phone) return null;
  const clean = phone.replace(/[^0-9]/g, '');
  return `https://wa.me/${clean}?text=${encodeURIComponent(text)}`;
}

// ─── WhatsApp send via META(PRINCIPAL) ───────────────────

async function sendWhatsAppMeta(phone, text) {
  if (!META_WA_TOKEN || !META_WA_PHONE_NUMBER_ID) {
    return { success: false, provider: 'meta', reason: 'no_config' };
  }
  if (!phone) {
    return { success: false, provider: 'meta', reason: 'no_phone' };
  }

  const to = normalizeMetaPhone(phone);
  if (!to) {
    return { success: false, provider: 'meta', reason: 'invalid_phone' };
  }

  try {
    const resp = await fetch(getMetaWhatsAppUrl(), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${META_WA_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: {
          preview_url: false,
          body: text
        }
      })
    });

    const data = await resp.json().catch(() => ({}));

    if (resp.ok && data?.messages?.[0]?.id) {
      const msgId = data.messages[0].id;
      console.log(`[WA-META] ✅ → ${phone} (ID: ${msgId})`);
      return {
        success: true,
        provider: 'meta',
        message_id: msgId,
        raw: data
      };
    }

    console.error(`[WA-META] ❌ ${resp.status}:`, data?.error?.message || JSON.stringify(data).substring(0, 300));
    return {
      success: false,
      provider: 'meta',
      reason: data?.error?.message || 'api_error',
      code: data?.error?.code || null,
      raw: data
    };
  } catch (err) {
    console.error('[WA-META] ❌', err.message);
    return {
      success: false,
      provider: 'meta',
      reason: 'exception',
      detail: err.message
    };
  
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

  let result = await sendWhatsAppMeta(phone, text);

  const waLink = getWhatsAppLink(phone, text);

  if (!result.success) {
    console.log(`[WA] ⚠️ Meta failed — wa.me link: ${waLink?.substring(0, 60)}...`);
    return { success: false, provider: 'link', link: waLink, apiResult: result };
  }

  result.link = waLink;
  return result;

}

// ─── Get unique phone numbers (local + diaspora) ────────────

function getUniquePhones(localPhone, diasporaPhone) {
  const phones = [];
  const seen = new Set();

  // En simulation : only diaspora phone
  const phonesToCheck = isSimulation() ? [diasporaPhone] : [localPhone, diasporaPhone];

  for (const p of phonesToCheck) {
    const clean = normalizePhone(p);
    if (!clean) continue;

    if (!seen.has(clean)) {
      seen.add(clean);
      phones.push(clean);
    }
  }

  if (isSimulation()) {
    console.log(`[SIM] 📱 Phones filtered: local=${localPhone || 'none'} (SKIPPED) | diaspora=${diasporaPhone || 'none'} → sending to: [${phones.join(', ')}]`);
  }

  return phones;
}

// ─── Normalize callers: string or array ─────────────────────

function resolvePhones(inputPhone, diasporaPhone = null, context = 'unknown') {
  let phones = [];

  if (Array.isArray(inputPhone)) {
    phones = [...new Set(inputPhone.map(normalizePhone).filter(Boolean))];
  } else {
    phones = getUniquePhones(inputPhone, diasporaPhone);
  }

  return filterTestPhones(phones, context);
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
// ① CRÉATION COMMANDE
// Cash → récap + code paiement + instructions (WhatsApp)
// Stripe → SKIP (facture envoyée via notifyPaymentConfirmed)
// ═══════════════════════════════════════════════════════════════

async function notifyOrderCreated(order, phone, email, emailItems, relais, cashSmsText) {
  if (order.payment_mode !== 'cash_relais') {
    console.log(`[NOTIF] ⏭️ Order created ${order.reference} (${order.payment_mode}) — skip, attente paiement Stripe`);
    return;
  }

  try {
    const trackingUrl = `${BASE_URL}/suivi.html`;
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

    let diasporaPhone = null;
    if (order.user_id && !Array.isArray(phone)) {
      try {
        const { rows: [userRow] } = await db.query(
          'SELECT whatsapp_phone FROM users WHERE id = $1',
          [order.user_id]
        );
        if (userRow?.whatsapp_phone) diasporaPhone = userRow.whatsapp_phone;
      } catch (_) {
        // ignore
      }
    }

    const allPhones = resolvePhones(phone, diasporaPhone, 'order_created_cash');

    if (allPhones.length === 0) {
      console.log(`[NOTIF] ⏭️ No allowed test phones for order ${order.reference}`);
      return;
    }

    for (const ph of allPhones) {
      const waText = WA_MESSAGES.order_created_cash(d);
      const waResult = await sendWhatsApp(ph, waText);

      await logNotification({
        orderRef: order.reference,
        channel: 'whatsapp',
        event: 'order_created_cash',
        recipient: ph,
        status: waResult.success ? 'sent' : 'link_generated',
        detail: waResult,
      });

      console.log(`[NOTIF] 🛒 Cash order WA → ${order.reference} → ${ph} | ${waResult.success ? '✅' : '⚠️'}`);
    }
  } catch (err) {
    console.error(`[NOTIF] ❌ notifyOrderCreated(${order.reference}):`, err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// ② PAIEMENT CONFIRMÉ
// Cash → facture WhatsApp
// Stripe → récap + facture WhatsApp
// ═══════════════════════════════════════════════════════════════

async function notifyPaymentConfirmed(orderId, orderRef) {
  try {
    const { rows: [order] } = await db.query(`
      SELECT o.id, o.reference, o.total_kmf, o.payment_mode,
  o.tracking_phone,
  rec.phone AS recipient_phone,
  u.full_name AS customer_name,
  u.phone AS user_phone,
  u.whatsapp_phone AS user_whatsapp_phone,
  u.email AS customer_email,
  r.name AS relais_name
FROM orders o
LEFT JOIN users u ON u.id = o.user_id
LEFT JOIN recipients rec ON rec.id = o.recipient_id
LEFT JOIN relais r ON r.id = o.relais_id
WHERE o.id = $1::uuid
    `, [orderId]);

    if (!order) {
      console.error(`[NOTIF] ❌ notifyPaymentConfirmed — order ${orderRef} not found`);
      return null;
    }

    const allPhones = [...new Set([
  order.recipient_phone || order.user_phone || null,
  order.tracking_phone || order.user_whatsapp_phone || null,
].filter(Boolean))];
console.log('[DEBUG][PAYMENT-CONFIRMED] recipient_phone =', order.recipient_phone);
console.log('[DEBUG][PAYMENT-CONFIRMED] tracking_phone =', order.tracking_phone);
console.log('[DEBUG][PAYMENT-CONFIRMED] allPhones =', allPhones);

    const { rows: items } = await db.query(`
      SELECT oi.quantity, oi.price_kmf, p.name AS product_name
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1::uuid
    `, [orderId]);

    const { v4: uuidv4 } = require('uuid');
    const year = new Date().getFullYear();
    let invNum = null;

    try {
      const { rows: [{ max_seq }] } = await db.query(
        `SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM 'INV-\\d{4}-(\\d+)') AS INT)), 0) AS max_seq
         FROM invoices WHERE invoice_number LIKE $1`,
        [`INV-${year}-%`]
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
        uuidv4(),
        invNum,
        orderId,
        order.customer_name,
        allPhones[0] || null,
        order.relais_name,
        JSON.stringify(itemsSnapshot),
        order.total_kmf,
        order.total_kmf,
        order.payment_mode,
      ]);

      console.log(`🧾 Invoice ${invNum} created for ${orderRef}`);
    } catch (invErr) {
      console.error(`[INVOICE] ⚠️ ${invErr.message}`);
    }

    const results = { whatsapp: [], email: null };

    const itemsText = items.map(i =>
      `• ${i.product_name || 'Article'} ×${i.quantity} — ${Number(i.price_kmf).toLocaleString()} KMF`
    ).join('\n');

    const payLabel = order.payment_mode === 'cash_relais' ? 'Cash au relais ✅' : 'Carte en ligne ✅';
    const trackingUrl = `${BASE_URL}/suivi.html`;

    const d = {
      customerName: order.customer_name || 'Client',
      orderRef: order.reference,
      totalKmf: order.total_kmf,
      invoiceNum: invNum || order.reference,
      itemsText,
      paymentLabel: payLabel,
      trackingUrl,
    };

    for (const phone of allPhones) {
      const waText = WA_MESSAGES.invoice(d);
      const waResult = await sendWhatsApp(phone, waText);
      results.whatsapp.push(waResult);

      await logNotification({
        orderRef: order.reference,
        channel: 'whatsapp',
        event: 'payment_confirmed_invoice',
        recipient: phone,
        status: waResult.success ? 'sent' : 'link_generated',
        detail: { ...waResult, invoice: invNum },
      });
    }

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
        channel: 'email',
        event: 'payment_confirmed',
        recipient: order.customer_email,
        status: results.email?.sent ? 'sent' : 'skipped',
        detail: results.email,
      });
    }

    console.log(`[NOTIF] 💰 Payment confirmed → ${orderRef} | WA:${results.whatsapp.length} | Invoice:${invNum}`);
    return { ...results, invoice: invNum };
  } catch (err) {
    console.error(`[NOTIF] ❌ notifyPaymentConfirmed(${orderRef}):`, err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// ③④ SCAN COLIS — shipped + available seulement
// ═══════════════════════════════════════════════════════════════

async function notifyParcelScan(parcelId, parcelRef, newStatus, extraData = {}) {
  if (!WA_SCAN_STATUSES.has(newStatus)) {
    console.log(`[NOTIF] ⏭️ Scan ${newStatus} → ${parcelRef} — pas de notification`);
    return null;
  }

  try {
    const { rows } = await db.query(`
      SELECT 
        p.reference AS parcel_ref, p.pickup_code, p.destination_island,
        r.name AS relais_name, r.island AS relais_island,
        o.reference AS order_ref, o.total_kmf,
        o.payment_mode, o.payment_status,
        COALESCE(u.full_name, p.recipient_name) AS customer_name,
        u.phone AS local_phone,
        u.whatsapp_phone AS diaspora_phone,
        COALESCE(u.phone, p.recipient_phone) AS fallback_phone,
        u.email AS customer_email,
        o.id AS order_id
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

    const results = { whatsapp: [], email: [] };
    const trackingUrl = `${BASE_URL}/suivi.html`;

    for (const row of rows) {
      const d = {
        customerName: row.customer_name || 'Client',
        parcelRef: row.parcel_ref,
        orderRef: row.order_ref,
        totalKmf: row.total_kmf,
        island: row.relais_island || row.destination_island,
        relaisName: row.relais_name,
        pickupCode: row.pickup_code,
        trackingUrl,
      };

      const allPhones = resolvePhones(
        row.local_phone || row.fallback_phone,
        row.diaspora_phone,
        `scan_${newStatus}`
      );

      const waTemplate = WA_MESSAGES[newStatus];
      if (waTemplate && allPhones.length > 0) {
        const waText = waTemplate(d);
        for (const phone of allPhones) {
          const waResult = await sendWhatsApp(phone, waText);
          results.whatsapp.push(waResult);

          await logNotification({
            parcelRef: row.parcel_ref,
            orderRef: row.order_ref,
            channel: 'whatsapp',
            event: `scan_${newStatus}`,
            recipient: phone,
            status: waResult.success ? 'sent' : 'link_generated',
            detail: waResult,
          });
        }
      }

      if (EMAIL_STATUSES.has(newStatus) && row.customer_email) {
        const emailData = {
          reference: row.order_ref || row.parcel_ref,
          customer_name: row.customer_name,
          customer_email: row.customer_email,
          total_kmf: row.total_kmf,
          payment_mode: row.payment_mode,
          relay_name: row.relais_name,
          cash_ref_code: row.pickup_code,
        };
        const emailResult = await sendOrderEmail(emailData, newStatus);
        results.email.push(emailResult);

        await logNotification({
          parcelRef: row.parcel_ref,
          orderRef: row.order_ref,
          channel: 'email',
          event: `scan_${newStatus}`,
          recipient: row.customer_email,
          status: emailResult?.sent ? 'sent' : 'skipped',
          detail: emailResult,
        });
      }
    }

    console.log(`[NOTIF] 📬 Scan ${newStatus} → ${parcelRef} | WA:${results.whatsapp.length} Email:${results.email.length}`);
    return results;
  } catch (err) {
    console.error(`[NOTIF] ❌ notifyParcelScan(${parcelRef}, ${newStatus}):`, err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// Legacy exports
// ═══════════════════════════════════════════════════════════════

function notifyStatusChange(order, status) {
  console.log(`[NOTIF] ⏭️ notifyStatusChange(${order?.reference}, ${status}) — no-op v5`);
}

function notifyParcelStatus(parcel, status) {
  console.log(`[NOTIF] ⏭️ notifyParcelStatus(${parcel?.reference}, ${status}) — no-op v5`);
}

async function notifyParcelCreated(parcelRef, orderId, orderRef) {
  console.log(`[NOTIF] ⏭️ notifyParcelCreated(${parcelRef}) — no-op v5`);
  return null;
}

function notifyCancellation(order, refundInfo) {
  const email = order.customer_email;
  if (email) {
    sendOrderEmail({ ...order, refund_info: refundInfo ? 'Voir détails' : null }, 'cancelled')
      .catch(e => console.error('[NOTIF-EMAIL]', e.message));
  }
}

function sendCashReminder(order) {
  sendOrderEmail(order, 'cash_reminder').catch(e => console.error('[NOTIF-EMAIL]', e.message));
}

function getCashReminderWA(order) {
  const phone = order.user_phone || order.phone;
  if (!phone) return null;
  return getWhatsAppLink(
    phone,
    `Rappel : votre colis ${order.reference} vous attend au relais. Montant : ${(order.total_kmf || 0).toLocaleString()} KMF 💰`
  );
}

module.exports = {
  notifyParcelScan,
  notifyPaymentConfirmed,
  notifyOrderCreated,
  sendWhatsApp,
  sendWhatsAppMeta,
  logNotification,
  WA_MESSAGES,

  notifyStatusChange,
  notifyParcelStatus,
  notifyParcelCreated,
  notifyCancellation,
  sendCashReminder,
  getCashReminderWA,
  getWhatsAppLink,
  STATUS_SMS,
};