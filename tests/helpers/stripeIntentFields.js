'use strict';

/**
 * Champs d'un PaymentIntent conformes au contrat du webhook (montant EUR en centimes, devise, métadonnées
 * komerce) pour une commande existante — évite de dupliquer le calcul dans chaque test e2e.
 */
async function stripeIntentFieldsForOrder(db, orderId) {
  const { rows: [o] } = await db.query('SELECT id, reference, total_eur FROM orders WHERE id = $1', [orderId]);
  if (!o) throw new Error(`stripeIntentFieldsForOrder: commande introuvable (${orderId})`);
  return {
    amount: Math.round(parseFloat(o.total_eur) * 100),
    currency: 'eur',
    metadata: { order_id: String(o.id), order_reference: String(o.reference), komerce: 'true' },
  };
}

module.exports = { stripeIntentFieldsForOrder };
