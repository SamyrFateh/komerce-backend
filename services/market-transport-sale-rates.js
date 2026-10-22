/**
 * @komerce-arch
 * @role          market-transport-sale-rates
 * @domain        logistics
 * @layer         service
 * @criticality   critical
 * @inputs        client, market_id
 * @outputs       market_transport_sale_rates
 * @depends       none
 * @used-by       services/order-checkout-service.js
 * @db-read       market_transport_sale_rates
 * @db-write      none
 * @db-txn        none
 * @doctrine      fail_closed, no_country_branch, attested_cost_is_not_a_sale_price
 * @impact-areas  checkout, transport, market
 * @version       2026-10
 */
'use strict';

const RATE_KEYS = Object.freeze(['SEA_KMF_PER_KG_COMMERCIAL', 'AIR_KMF_PER_KG_TAXABLE']);

// Tarifs de vente transport actifs d'un Market, ou {} s'il n'en a aucun.
async function loadMarketTransportSaleRates(client, marketId) {
  if (!marketId) return {};
  const { rows } = await client.query(
    `SELECT rate_key, rate_kmf_per_kg
       FROM market_transport_sale_rates
      WHERE market_id = $1::uuid
        AND revoked_at IS NULL
        AND valid_from <= now()`,
    [marketId]
  );
  const out = {};
  for (const row of rows) {
    if (RATE_KEYS.includes(row.rate_key) && Number(row.rate_kmf_per_kg) > 0) {
      out[row.rate_key] = Number(row.rate_kmf_per_kg);
    }
  }
  return out;
}

module.exports = { RATE_KEYS, loadMarketTransportSaleRates };
