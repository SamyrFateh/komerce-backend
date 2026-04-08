/**
 * KOMERCE — Notification Service
 *
 * Wrapper unifié sur utils/sms.js et utils/email.js.
 * Toutes les notifications sortantes passent par ce module.
 */

'use strict';

const { sendSMS }               = require('../utils/sms');
const { sendOrderConfirmation } = require('../utils/email');

// SMS déclenchés par changement de statut — pipeline MVP 7 étapes (v9.0)
// Seuls les statuts visibles client reçoivent un SMS
const STATUS_SMS = {
  ordered:     (ref) => `Komerce : Commande ${ref} lancée ! Votre article est en cours de traitement.`,
  preparation: (ref) => `Komerce : Commande ${ref} — colis reçu au Hub, contrôle qualité en cours.`,
  shipped:     (ref) => `Komerce : Commande ${ref} — votre colis est prêt, remis au transitaire à Dubai.`,
  in_transit:  (ref) => `Komerce : Commande ${ref} — votre colis est embarqué sur le bateau ! 🚢 Arrivée estimée 3–5 semaines.`,
  available:   (ref, relais) => `Komerce : Commande ${ref} disponible au relais ${relais || ''}. Venez le récupérer !`,
  collected:   (ref) => `Komerce : Commande ${ref} remise. Merci de votre confiance ! 🎉`,
};

const PARCEL_SMS = {
  shipped:   (ref) =>
    `Komerce : Colis ${ref} expedie. Vous serez notifie a l'arrivee.`,
  available: (ref, relais) =>
    `Komerce : Colis ${ref} disponible au relais ${relais || ''}. Venez le recuperer !`,
  collected: (ref) =>
    `Komerce : Colis ${ref} remis. Merci ! 🎉`,
};

/**
 * Envoie le SMS correspondant au changement de statut d'une commande.
 * @param {Object} order  - Commande avec { id, reference, user_phone, relais_name }
 * @param {string} status - Nouveau statut
 */
function notifyStatusChange(order, status) {
  const smsPhone = order.user_phone;
  if (smsPhone && STATUS_SMS[status]) {
    sendSMS(smsPhone, STATUS_SMS[status](order.reference, order.relais_name), status, order.id)
      .catch(console.error);
  }
}

/**
 * Envoie SMS + email lors de la création d'une commande.
 * @param {Object}      order       - Commande (id, reference, total_kmf, payment_mode, cash_ref_code)
 * @param {string|null} phone       - Téléphone du client
 * @param {string|null} email       - Email du client
 * @param {Array}       emailItems  - Articles pour l'email [{name, qty, price_kmf}]
 * @param {Object|null} relais      - Relais {name, address}
 * @param {string|null} cashSmsText - Texte SMS custom (cash_relais)
 */
function notifyOrderCreated(order, phone, email, emailItems, relais, cashSmsText) {
  if (phone) {
    const smsText  = cashSmsText || STATUS_SMS.ordered(order.reference);
    const smsType  = order.payment_mode === 'cash_relais' ? 'cash_relais_confirm' : 'confirmation';
    sendSMS(phone, smsText, smsType, order.id).catch(console.error);
  }
  if (email) {
    sendOrderConfirmation(
      { reference: order.reference, total_kmf: order.total_kmf, relais_name: relais?.name },
      email,
      emailItems
    ).catch(err => console.error('[EMAIL] Order confirmation error:', err.message));
  }
}

/**
 * Envoie un SMS lors du changement de statut d'un colis.
 * @param {Object} parcel - Colis avec { reference, user_phone, relais_name, parent_id }
 * @param {string} status - Nouveau statut
 */
function notifyParcelStatus(parcel, status) {
  if (parcel.user_phone && PARCEL_SMS[status]) {
    const smsText = PARCEL_SMS[status](parcel.reference, parcel.relais_name);
    sendSMS(parcel.user_phone, smsText, `parcel_${status}`, parcel.parent_id).catch(console.error);
  }
}

/**
 * Envoie un SMS d'annulation au client.
 * @param {Object}      order      - Commande avec { id, reference, user_phone }
 * @param {Object|null} refundInfo - { method, amountEur, amountKmf } ou null si non payée
 */
function notifyCancellation(order, refundInfo) {
  const userPhone = order.user_phone;
  if (!userPhone) return;

  let smsText;
  if (!refundInfo) {
    smsText = `Komerce : Commande ${order.reference} annulee. Aucun paiement n'a ete preleve.`;
  } else if (refundInfo.method === 'stripe') {
    smsText = `Komerce : Commande ${order.reference} annulee. Remboursement de ${refundInfo.amountEur.toFixed(2)}EUR en cours (2-5 jours ouvres Stripe).`;
  } else {
    smsText = `Komerce : Commande ${order.reference} annulee. Credit boutique de ${Number(refundInfo.amountKmf).toLocaleString('fr-FR')} KMF credite sur votre compte.`;
  }
  sendSMS(userPhone, smsText, 'cancellation', order.id).catch(console.error);
}

module.exports = {
  notifyStatusChange,
  notifyOrderCreated,
  notifyParcelStatus,
  notifyCancellation,
  STATUS_SMS,
  PARCEL_SMS,
};
