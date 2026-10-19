/**
 * @komerce-arch-lite
 * @role          rct1-checkout-reference-guard
 * @domain        orders
 * @layer         service
 * @owner         backend-core
 * @purpose       Serialiser les checkouts RCT1 et refuser une reference deja creee.
 * @db-read       orders
 * @db-write      none
 * @db-txn        caller_transaction_preserved
 * @impact-areas  orders, recette
 */
'use strict';
// Totaux produit attendus (hors transport commercial), independants du resultat observe.
const EXPECTED_PRODUCT_TOTAL_KMF = Object.freeze({ 'RCT1-E1': 15000, 'RCT1-F': 15000, 'RCT1-C': 15000, 'RCT1-C2': 15000, 'RCT1-I3': 40000, 'RCT1-G': Number(process.env.RCT1_P3_PRICE_KMF) > 0 ? Math.round(Number(process.env.RCT1_P3_PRICE_KMF)) : 6000 });
const ALLOWED = new Set(Object.keys(EXPECTED_PRODUCT_TOTAL_KMF));
function expectedProductTotalKmf(reference) { return EXPECTED_PRODUCT_TOTAL_KMF[reference] ?? null; }
async function reserveRct1OrderReference(client, reference) {
  if (!ALLOWED.has(reference)) throw Error('RCT1_REFERENCE_NOT_ALLOWED');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [reference]);
  const { rows } = await client.query('SELECT id, reference, simulation_scope FROM orders WHERE reference=$1', [reference]);
  if (rows.length) {
    if (rows[0].simulation_scope !== 'RCT1') throw Error('RCT1_REFERENCE_COLLIDES_WITH_REAL_ORDER');
    return { already: true, order: rows[0] };
  }
  return { already: false };
}
module.exports = { reserveRct1OrderReference, expectedProductTotalKmf, isAllowedRct1Reference: (r) => ALLOWED.has(r) };
