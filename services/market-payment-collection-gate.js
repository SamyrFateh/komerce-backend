/**
 * @komerce-arch
 * @role          market-payment-collection-gate
 * @domain        payments
 * @layer         service
 * @criticality   critical
 * @inputs        market_id, payment_mode
 * @outputs       allowed_boolean, PAYMENT_MODE_NOT_ALLOWED_FOR_MARKET
 * @depends       none
 * @used-by       services/order-checkout-service.js, routes/payments.js, routes/payments-paypal.js
 * @db-read       market_central_collection_modes
 * @db-write      none
 * @db-txn        reads_in_caller_transaction
 * @doctrine      market_encaisse, fail_closed, no_country_branch
 * @impact-areas  payments, market, checkout
 * @version       2026-10
 */
'use strict';

const CENTRAL_MODES = Object.freeze(['stripe_eur', 'paypal_eur']);

/**
 * Un moyen d'encaissement central (Stripe EUR / PayPal EUR) n'est accepté que si le marché de la
 * commande l'a explicitement autorisé (market_central_collection_modes, non révoqué).
 * Les autres modes (cash_relais, mobile_money) ont leur propre garde et ne passent pas ici.
 *
 * @param {{query:Function}} executor client ou pool
 * @returns {Promise<boolean>}
 */
async function isCentralCollectionAllowed(executor, marketId, paymentMode) {
  if (!CENTRAL_MODES.includes(paymentMode)) return true;
  if (!marketId) return false;
  const { rows } = await executor.query(
    `SELECT 1 FROM market_central_collection_modes
      WHERE market_id = $1::uuid AND payment_mode = $2 AND revoked_at IS NULL
      LIMIT 1`,
    [marketId, paymentMode]
  );
  return rows.length > 0;
}

async function assertCentralCollectionAllowed(executor, marketId, paymentMode) {
  if (await isCentralCollectionAllowed(executor, marketId, paymentMode)) return;
  const err = new Error(
    `Le moyen de paiement ${paymentMode} n'est pas autorisé pour ce marché.`
  );
  err.code = 'PAYMENT_MODE_NOT_ALLOWED_FOR_MARKET';
  err.statusCode = 409;
  throw err;
}

module.exports = { CENTRAL_MODES, isCentralCollectionAllowed, assertCentralCollectionAllowed };
