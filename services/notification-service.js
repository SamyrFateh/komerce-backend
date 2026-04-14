/**
 * KOMERCE — Notification Service v3.0 (COLIS-FIRST)
 *
 * Wrapper unifié : WhatsApp (principal) + Email (Brevo) + SMS (Africa's Talking)
 * + Logging en DB (notification_log)
 *
 * v3.0 — WhatsApp via Brevo API (principal) + wa.me fallback
 *         Câblé aux scans colis + actions commandes
 *         Logging complet en notification_log
 */

'use strict';

const { sendSMS }        = require('../utils/sms');
const { sendOrderEmail } = require('../utils/email');
const db                 = require('../db');

// ─── Config ─────────────────────────────────────────────────

const BREVO_KEY    = process.env.BREVO_API_KEY || '';
const WA_PROVIDER  = (process.env.WHATSAPP_PROVIDER || 'brevo').toLowerCase();
// For Meta Cloud API
const WA_TOKEN     = process.env.WHATSAPP_TOKEN || '';
const WA_PHONE_ID  = process.env.WHATSAPP_PHONE_ID || '';

// Statuts pour lesquels on envoie un EMAIL
const EMAIL_STATUSES = new Set(['confirmed', 'shipped', 'available', 'collected', 'cancelled']);

// ─── SMS templates ──────────────────────────────────────────

const STATUS_SMS = {
  ordered:     (ref) => `Komerce : Commande ${ref} lancée ! Votre article est en cours de traitement.`,
  preparation: (ref) => `Komerce : Commande ${ref} — colis reçu au Hub, contrôle qualité en cours.`,
  shipped:     (ref) => `Komerce : Commande ${ref} — votre colis est prêt, remis au transitaire.`,
  in_transit:  (ref) => `Komerce : Commande ${ref} — votre colis est embarqué ! 🚢`,
  available:   (ref, relais) => `Komerce : Commande ${ref} disponible au relais ${relais || ''}. Venez le récupérer !`,
  collected:   (ref) => `Komerce : Commande ${ref} remise. Merci de votre confiance ! 🎉`,
};

// ─── WhatsApp message templates ─────────────────────────────

const WA_MESSAGES = {
  payment_confirmed: (d) =>
    `✅ *Paiement confirmé*\n\nBonjour ${d.customerName},\nVotre commande *${d.orderRef}* (${Number(d.totalKmf).toLocaleString()} KMF) est confirmée.\n\nVotre colis sera préparé très bientôt !\n— Komerce 🛒`,

  preparation: (d) =>
    `📦 *Colis en préparation*\n\nBonjour ${d.customerName},\nVotre colis *${d.parcelRef}* est en cours de préparation au hub.\n\n— Komerce 🛒`,

  shipped: (d) =>
    `✈️ *Colis expédié*\n\nBonjour ${d.customerName},\nVotre colis *${d.parcelRef}* a été expédié vers *${d.island || 'les Comores'}*.\n\nVous serez notifié(e) dès son arrivée au relais.\n— Komerce 🛒`,

  in_transit: (d) =>
    `🚢 *Colis en transit*\n\nBonjour ${d.customerName},\nVotre colis *${d.parcelRef}* est en route !\n\n— Komerce 🛒`,

  available: (d) =>
    `📍 *Colis disponible !*\n\nBonjour ${d.customerName},\nVotre colis *${d.parcelRef}* est disponible au relais :\n📍 *${d.relaisName || d.island || ''}*\n\n🔑 Code de retrait : *${d.pickupCode || '—'}*\n\nPrésentez ce code pour récupérer votre colis.\n— Komerce 🛒`,

  collected: (d) =>
    `✅ *Colis remis*\n\nBonjour ${d.customerName},\nVotre colis *${d.parcelRef}* vous a été remis avec succès.\n\nMerci pour votre confiance ! 🙏\n— Komerce 🛒`,

  parcel_created: (d) =>
    `📦 *Colis créé*\n\nBonjour ${d.customerName},\nUn colis *${d.parcelRef}* a été créé pour votre commande *${d.orderRef}*.\n\nIl est maintenant en préparation !\n— Komerce 🛒`,

  incident: (d) =>
    `🚨 *Incident signalé*\n\nBonjour ${d.customerName},\nUn incident a été signalé sur votre colis *${d.parcelRef}*.\n\nNotre équipe traite le problème.\n— Komerce 🛒`,
};

// ─── WhatsApp wa.me link generator ──────────────────────────

function getWhatsAppLink(phone, text) {
  if (!phone) return null;
  const clean = phone.replace(/[^0-9]/g, '');
  return `https://wa.me/${clean}?text=${encodeURIComponent(text)}`;
}

// ─── WhatsApp send via Brevo API ────────────────────────────

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
    console.error(`[WA-BREVO] ❌ ${resp.status}:`, JSON.stringify(data).substring(0, 200));
    return { success: false, provider: 'brevo', reason: 'api_error', status: resp.status, detail: data.message || data.code };
  } catch (err) {
    console.error('[WA-BREVO] ❌', err.message);
    return { success: false, provider: 'brevo', reason: 'exception', detail: err.message };
  }
}

// ─── WhatsApp send via Meta Cloud API ───────────────────────

async function sendWhatsAppMeta(phone, text) {
  if (!WA_TOKEN || !WA_PHONE_ID) return { success: false, provider: 'meta', reason: 'no_config' };

  try {
    const resp = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WA_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone.replace(/[^0-9]/g, ''),
        type: 'text',
        text: { body: text }
      })
    });
    const data = await resp.json();
    if (resp.ok) {
      console.log(`[WA-META] ✅ → ${phone}`);
      return { success: true, provider: 'meta', messageId: data.messages?.[0]?.id };
    }
    console.error(`[WA-META] ❌ ${resp.status}:`, JSON.stringify(data).substring(0, 200));
    return { success: false, provider: 'meta', reason: 'api_error', detail: data.error?.message };
  } catch (err) {
    console.error('[WA-META] ❌', err.message);
    return { success: false, provider: 'meta', reason: 'exception', detail: err.message };
  }
}

// ─── Unified WhatsApp sender ────────────────────────────────

async function sendWhatsApp(phone, text) {
  if (!phone) return { success: false, reason: 'no_phone' };

  let result;

  // Try primary provider
  if (WA_PROVIDER === 'brevo') {
    result = await sendWhatsAppBrevo(phone, text);
  } else if (WA_PROVIDER === 'meta') {
    result = await sendWhatsAppMeta(phone, text);
  }

  // If primary failed, try fallback
  if (result && !result.success && WA_PROVIDER === 'brevo') {
    result = await sendWhatsAppMeta(phone, text);
  }

  // Always generate wa.me link as last resort
  const waLink = getWhatsAppLink(phone, text);

  if (!result || !result.success) {
    console.log(`[WA] ⚠️ API failed — wa.me link generated: ${waLink?.substring(0, 60)}...`);
    return { success: false, provider: 'link', link: waLink, apiResult: result };
  }

  result.link = waLink;
  return result;
}

// ─── Log notification to DB ─────────────────────────────────

async function logNotification({ parcelRef, orderRef, channel, event, recipient, status, detail }) {
  try {
    await db.query(`
      INSERT INTO notification_log (parcel_ref, order_ref, channel, event, recipient, status, detail, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `, [parcelRef || null, orderRef || null, channel, event, recipient, status, JSON.stringify(detail || {})]);
  } catch (err) {
    // Table might not exist yet — don't crash
    if (err.code === '42P01') {
      console.warn('[NOTIF-LOG] ⚠️ Table notification_log inexistante — migration requise');
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
 * Fetches client data from parcel, sends WhatsApp + Email
 */
async function notifyParcelScan(parcelId, parcelRef, newStatus, extraData = {}) {
  try {
    // Fetch parcel + order + client data
    const { rows } = await db.query(`
      SELECT 
        p.reference AS parcel_ref, p.pickup_code, p.destination_island,
        r.name AS relais_name, r.island AS relais_island,
        o.reference AS order_ref, o.total_kmf,
        o.payment_mode, o.payment_status,
        COALESCE(o.customer_name, u.full_name, p.recipient_name) AS customer_name,
        COALESCE(o.customer_phone, u.phone, p.recipient_phone) AS customer_phone,
        COALESCE(o.customer_email, u.email) AS customer_email,
        o.id AS order_id, o.cash_ref_code, o.relais_id AS order_relais_id
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN relais r ON r.id = COALESCE(p.relay_id, p.relais_id, o.relais_id)
      WHERE p.id = $1::uuid
    `, [parcelId]);

    if (!rows.length) {
      console.warn(`[NOTIF] ⚠️ Colis ${parcelRef} introuvable pour notification`);
      return null;
    }

    const results = { whatsapp: [], email: [], sms: [] };

    // Notify each client linked to this parcel
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

      // 1. WhatsApp (PRIMARY)
      const waTemplate = WA_MESSAGES[newStatus];
      if (waTemplate && row.customer_phone) {
        const waText = waTemplate(d);
        const waResult = await sendWhatsApp(row.customer_phone, waText);
        results.whatsapp.push(waResult);
        
        await logNotification({
          parcelRef: row.parcel_ref,
          orderRef: row.order_ref,
          channel: 'whatsapp',
          event: `scan_${newStatus}`,
          recipient: row.customer_phone,
          status: waResult.success ? 'sent' : 'link_generated',
          detail: waResult
        });
      }

      // 2. Email (at key stages only)
      if (EMAIL_STATUSES.has(newStatus) && row.customer_email) {
        const orderData = {
          reference: row.order_ref || row.parcel_ref,
          customer_name: row.customer_name,
          customer_email: row.customer_email,
          total_kmf: row.total_kmf,
          payment_mode: row.payment_mode,
          relay_name: row.relais_name,
          cash_ref_code: row.pickup_code || row.cash_ref_code,
        };
        const emailResult = await sendOrderEmail(orderData, newStatus);
        results.email.push(emailResult);
        
        await logNotification({
          parcelRef: row.parcel_ref,
          orderRef: row.order_ref,
          channel: 'email',
          event: `scan_${newStatus}`,
          recipient: row.customer_email,
          status: emailResult?.sent ? 'sent' : 'skipped',
          detail: emailResult
        });
      }

      // 3. SMS (always)
      if (row.customer_phone && STATUS_SMS[newStatus]) {
        const smsText = STATUS_SMS[newStatus](row.order_ref || row.parcel_ref, row.relais_name);
        sendSMS(row.customer_phone, smsText, `parcel_${newStatus}`, row.order_id)
          .then(r => {
            logNotification({
              parcelRef: row.parcel_ref, orderRef: row.order_ref,
              channel: 'sms', event: `scan_${newStatus}`,
              recipient: row.customer_phone,
              status: 'sent', detail: r
            });
          })
          .catch(e => {
            console.error('[NOTIF-SMS]', e.message);
            logNotification({
              parcelRef: row.parcel_ref, orderRef: row.order_ref,
              channel: 'sms', event: `scan_${newStatus}`,
              recipient: row.customer_phone,
              status: 'failed', detail: { error: e.message }
            });
          });
        results.sms.push({ queued: true });
      }
    }

    console.log(`[NOTIF] 📬 Scan ${newStatus} → ${parcelRef} | WA:${results.whatsapp.length} Email:${results.email.length} SMS:${results.sms.length}`);
    return results;
  } catch (err) {
    console.error(`[NOTIF] ❌ Error notifyParcelScan(${parcelRef}, ${newStatus}):`, err.message);
    return null;
  }
}

/**
 * Called when cash payment is confirmed
 */
async function notifyPaymentConfirmed(orderId, orderRef) {
  try {
    const { rows: [order] } = await db.query(`
      SELECT o.reference, o.total_kmf, o.payment_mode,
        COALESCE(o.customer_name, u.full_name) AS customer_name,
        COALESCE(o.customer_phone, u.phone) AS customer_phone,
        COALESCE(o.customer_email, u.email) AS customer_email
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.id = $1::uuid
    `, [orderId]);

    if (!order) return null;

    const d = {
      customerName: order.customer_name || 'Client',
      orderRef: order.reference,
      totalKmf: order.total_kmf,
    };

    const results = {};

    // WhatsApp
    if (order.customer_phone) {
      const waText = WA_MESSAGES.payment_confirmed(d);
      results.whatsapp = await sendWhatsApp(order.customer_phone, waText);
      await logNotification({
        orderRef: order.reference,
        channel: 'whatsapp', event: 'payment_confirmed',
        recipient: order.customer_phone,
        status: results.whatsapp.success ? 'sent' : 'link_generated',
        detail: results.whatsapp
      });
    }

    // Email
    if (order.customer_email) {
      const emailData = {
        reference: order.reference,
        customer_name: order.customer_name,
        customer_email: order.customer_email,
        total_kmf: order.total_kmf,
        payment_mode: order.payment_mode,
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

    console.log(`[NOTIF] 💰 Payment confirmed → ${orderRef} | ${order.customer_name}`);
    return results;
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
        COALESCE(o.customer_name, u.full_name) AS customer_name,
        COALESCE(o.customer_phone, u.phone) AS customer_phone,
        COALESCE(o.customer_email, u.email) AS customer_email
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

    // WhatsApp
    if (data.customer_phone) {
      const waText = WA_MESSAGES.parcel_created(d);
      const result = await sendWhatsApp(data.customer_phone, waText);
      await logNotification({
        parcelRef, orderRef: data.order_ref,
        channel: 'whatsapp', event: 'parcel_created',
        recipient: data.customer_phone,
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
  const results = {};
  const smsPhone = order.user_phone;
  if (smsPhone && STATUS_SMS[status]) {
    sendSMS(smsPhone, STATUS_SMS[status](order.reference, order.relais_name), status, order.id)
      .catch(e => console.error('[NOTIF-SMS]', e.message));
  }
  if (EMAIL_STATUSES.has(status)) {
    sendOrderEmail(order, status).catch(e => console.error('[NOTIF-EMAIL]', e.message));
  }
  const waLink = getWhatsAppLink(order.user_phone || order.phone, 
    WA_MESSAGES[status] ? WA_MESSAGES[status]({
      customerName: order.customer_name || 'Client',
      parcelRef: order.reference, orderRef: order.reference,
      island: order.relais_island || '', relaisName: order.relais_name || '',
      pickupCode: order.pickup_code || order.cash_ref_code || '',
      totalKmf: order.total_kmf || 0
    }) : `Mise à jour de votre commande ${order.reference}`);
  if (waLink) results.whatsapp_link = waLink;
  return results;
}

function notifyOrderCreated(order, phone, email, emailItems, relais, cashSmsText) {
  if (phone) {
    const smsText = cashSmsText || STATUS_SMS.ordered(order.reference);
    sendSMS(phone, smsText, order.payment_mode === 'cash_relais' ? 'cash_relais_confirm' : 'confirmation', order.id)
      .catch(e => console.error('[NOTIF-SMS]', e.message));
  }
  if (email) {
    sendOrderEmail({ ...order, customer_email: email, relay_name: relais?.name }, 'confirmed')
      .catch(e => console.error('[NOTIF-EMAIL]', e.message));
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
