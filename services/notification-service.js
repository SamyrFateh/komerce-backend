/**
 * KOMERCE — Notification Service v2.2
 *
 * Wrapper unifié : SMS (Africa's Talking) + Email (Brevo) + WhatsApp (liens)
 * Toutes les notifications sortantes passent par ce module.
 *
 * v2.2 — Emails uniquement aux étapes clés (confirmed, shipped, available, cancelled)
 *        SMS/WA restent à chaque transition.
 */

'use strict';

const { sendSMS }        = require('../utils/sms');
const { sendOrderEmail } = require('../utils/email');

// Statuts pour lesquels on envoie un EMAIL (les moments importants)
const EMAIL_STATUSES = new Set(['confirmed', 'shipped', 'available', 'cancelled']);

// SMS templates (inchangés depuis v1)
const STATUS_SMS = {
  ordered:     (ref) => `Komerce : Commande ${ref} lancée ! Votre article est en cours de traitement.`,
  preparation: (ref) => `Komerce : Commande ${ref} — colis reçu au Hub, contrôle qualité en cours.`,
  shipped:     (ref) => `Komerce : Commande ${ref} — votre colis est prêt, remis au transitaire à Dubai.`,
  in_transit:  (ref) => `Komerce : Commande ${ref} — votre colis est embarqué sur le bateau ! 🚢 Arrivée estimée 3–5 semaines.`,
  available:   (ref, relais) => `Komerce : Commande ${ref} disponible au relais ${relais || ''}. Venez le récupérer !`,
  collected:   (ref) => `Komerce : Commande ${ref} remise. Merci de votre confiance ! 🎉`,
};

const PARCEL_SMS = {
  shipped:   (ref) => `Komerce : Colis ${ref} expedie. Vous serez notifie a l'arrivee.`,
  available: (ref, relais) => `Komerce : Colis ${ref} disponible au relais ${relais || ''}. Venez le recuperer !`,
  collected: (ref) => `Komerce : Colis ${ref} remis. Merci ! 🎉`,
};

/**
 * Generate a WhatsApp link for a status update.
 */
function getWhatsAppLink(order, status) {
  const phone = order.user_phone || order.phone;
  if (!phone) return null;

  const cleanPhone = phone.replace(/[^0-9]/g, '');
  const ref = order.reference || '???';

  const messages = {
    ordered:     `Bonjour ! Votre commande ${ref} a été passée auprès de nos fournisseurs. Nous vous tenons informé ! 🛍️`,
    preparation: `Bonjour ! Votre commande ${ref} est en préparation à Dubai 📦`,
    shipped:     `Bonjour ! Votre colis ${ref} a été remis au transitaire à Dubai ✈️`,
    in_transit:  `Bonjour ! Votre colis ${ref} est en route vers les Comores 🚢`,
    available:   `Bonjour ! Votre colis ${ref} est disponible au relais ${order.relais_name || ''}. Venez le récupérer ! 🎉`,
    collected:   `Merci d'avoir récupéré votre commande ${ref} ! À bientôt sur Komerce 🙏`,
    cancelled:   `Votre commande ${ref} a été annulée. N'hésitez pas à nous contacter pour toute question.`,
  };

  const msg = messages[status];
  if (!msg) return null;

  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
}

/**
 * Envoie SMS + Email (si étape clé) + génère lien WhatsApp pour un changement de statut.
 */
function notifyStatusChange(order, status) {
  const results = {};

  // 1. SMS — toujours (Africa's Talking ou mode dev)
  const smsPhone = order.user_phone;
  if (smsPhone && STATUS_SMS[status]) {
    sendSMS(smsPhone, STATUS_SMS[status](order.reference, order.relais_name), status, order.id)
      .catch(e => console.error('[NOTIF-SMS]', e.message));
  }

  // 2. Email via Brevo — UNIQUEMENT aux étapes clés
  if (EMAIL_STATUSES.has(status)) {
    sendOrderEmail(order, status)
      .then(r => {
        if (r && r.sent) console.log(`[NOTIF-EMAIL] ✅ ${status} → ${order.customer_email || order.user_email}`);
      })
      .catch(e => console.error('[NOTIF-EMAIL]', e.message));
  } else {
    console.log(`[NOTIF-EMAIL] ⏭️ ${status} — pas d'email (étape intermédiaire)`);
  }

  // 3. WhatsApp link (log pour CT/Agent)
  const waLink = getWhatsAppLink(order, status);
  if (waLink) {
    console.log(`[NOTIF-WA] 📱 Lien WhatsApp ${status} : ${waLink.substring(0, 80)}...`);
    results.whatsapp_link = waLink;
  }

  return results;
}

/**
 * Notifications lors de la création d'une commande.
 */
function notifyOrderCreated(order, phone, email, emailItems, relais, cashSmsText) {
  // SMS
  if (phone) {
    const smsText = cashSmsText || STATUS_SMS.ordered(order.reference);
    const smsType = order.payment_mode === 'cash_relais' ? 'cash_relais_confirm' : 'confirmation';
    sendSMS(phone, smsText, smsType, order.id).catch(e => console.error('[NOTIF-SMS]', e.message));
  }

  // Email confirmation (étape clé → toujours envoyé)
  if (email) {
    const orderWithEmail = { ...order, customer_email: email, relay_name: relais?.name };
    sendOrderEmail(orderWithEmail, 'confirmed')
      .catch(e => console.error('[NOTIF-EMAIL]', e.message));
  }
}

/**
 * Notifications pour les colis (parcels).
 */
function notifyParcelStatus(parcel, status) {
  if (parcel.user_phone && PARCEL_SMS[status]) {
    sendSMS(parcel.user_phone, PARCEL_SMS[status](parcel.reference, parcel.relais_name), `parcel_${status}`, parcel.parent_id)
      .catch(e => console.error('[NOTIF-SMS]', e.message));
  }
}

/**
 * Notification d'annulation (étape clé → email + SMS).
 */
function notifyCancellation(order, refundInfo) {
  const phone = order.user_phone;

  // SMS annulation
  if (phone) {
    let smsText;
    if (!refundInfo) {
      smsText = `Komerce : Commande ${order.reference} annulee. Aucun paiement n'a ete preleve.`;
    } else if (refundInfo.method === 'stripe') {
      smsText = `Komerce : Commande ${order.reference} annulee. Remboursement de ${refundInfo.amountEur.toFixed(2)}EUR en cours (2-5 jours ouvres Stripe).`;
    } else {
      smsText = `Komerce : Commande ${order.reference} annulee. Credit boutique de ${Number(refundInfo.amountKmf).toLocaleString('fr-FR')} KMF credite.`;
    }
    sendSMS(phone, smsText, 'cancellation', order.id).catch(e => console.error('[NOTIF-SMS]', e.message));
  }

  // Email annulation (étape clé → toujours envoyé)
  let refund_info_text = null;
  if (refundInfo) {
    refund_info_text = refundInfo.method === 'stripe'
      ? `Remboursement de ${refundInfo.amountEur.toFixed(2)}€ en cours (2-5 jours ouvrés Stripe).`
      : `Crédit boutique de ${Number(refundInfo.amountKmf).toLocaleString('fr-FR')} KMF crédité sur votre compte.`;
  }
  sendOrderEmail({ ...order, refund_info: refund_info_text }, 'cancelled')
    .catch(e => console.error('[NOTIF-EMAIL]', e.message));
}

/**
 * Cash reminder (email + WhatsApp link).
 */
function sendCashReminder(order) {
  sendOrderEmail(order, 'cash_reminder')
    .catch(e => console.error('[NOTIF-EMAIL] cash_reminder:', e.message));
}

function getCashReminderWA(order) {
  const phone = order.user_phone || order.phone;
  if (!phone) return null;
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(
    `Bonjour ! Rappel : votre colis ${order.reference} vous attend au relais ${order.relais_name||''}. Montant : ${(order.total_kmf||0).toLocaleString()} KMF 💰`
  )}`;
}

module.exports = {
  notifyStatusChange,
  notifyOrderCreated,
  notifyParcelStatus,
  notifyCancellation,
  sendCashReminder,
  getCashReminderWA,
  getWhatsAppLink,
  STATUS_SMS,
  PARCEL_SMS,
};
