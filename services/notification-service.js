/**
 * KOMERCE — Notification Service v2
 *
 * Wrapper unifié : SMS (Africa's Talking) + Email (Brevo) + WhatsApp (liens)
 * Toutes les notifications sortantes passent par ce module.
 *
 * v2.0 — Ajout emails Brevo + liens WhatsApp sur TOUS les changements de statut
 */

'use strict';

const { sendSMS }               = require('../utils/sms');
const {
  sendOrderConfirmation,
  sendStatusEmail,
  getWhatsAppLink,
  sendCashReminder,
  getCashReminderWA,
} = require('../utils/email');

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
 * Envoie SMS + Email + génère lien WhatsApp pour un changement de statut.
 * @param {Object} order  - Commande { id, reference, user_phone, user_email, relais_name, customer_name, ... }
 * @param {string} status - Nouveau statut
 * @returns {Object|undefined} { email, whatsapp_link } si applicable
 */
function notifyStatusChange(order, status) {
  const results = {};

  // 1. SMS (existant — Africa's Talking ou mode dev)
  const smsPhone = order.user_phone;
  if (smsPhone && STATUS_SMS[status]) {
    sendSMS(smsPhone, STATUS_SMS[status](order.reference, order.relais_name), status, order.id)
      .catch(e => console.error('[NOTIF-SMS]', e.message));
  }

  // 2. Email via Brevo (nouveau)
  sendStatusEmail(order, status)
    .then(r => {
      if (r && r.sent) console.log(`[NOTIF-EMAIL] ✅ ${status} → ${order.user_email || order.customer_email}`);
    })
    .catch(e => console.error('[NOTIF-EMAIL]', e.message));

  // 3. WhatsApp link (nouveau — log pour CT/Agent)
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

  // Email via Brevo (template amélioré)
  if (email) {
    sendOrderConfirmation(
      { reference: order.reference, total_kmf: order.total_kmf, relais_name: relais?.name },
      email,
      emailItems
    ).catch(e => console.error('[NOTIF-EMAIL]', e.message));
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
 * Notification d'annulation.
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

  // Email annulation via Brevo
  let refund_info_text = null;
  if (refundInfo) {
    refund_info_text = refundInfo.method === 'stripe'
      ? `Remboursement de ${refundInfo.amountEur.toFixed(2)}€ en cours (2-5 jours ouvrés Stripe).`
      : `Crédit boutique de ${Number(refundInfo.amountKmf).toLocaleString('fr-FR')} KMF crédité sur votre compte.`;
  }
  sendStatusEmail({ ...order, refund_info: refund_info_text }, 'cancelled')
    .catch(e => console.error('[NOTIF-EMAIL]', e.message));
}

module.exports = {
  notifyStatusChange,
  notifyOrderCreated,
  notifyParcelStatus,
  notifyCancellation,
  STATUS_SMS,
  PARCEL_SMS,
};
