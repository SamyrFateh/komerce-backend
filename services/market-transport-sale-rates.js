/**
 * @komerce-arch
 * @role          market-transport-sale-rates
 * @domain        logistics
 * @layer         service
 * @criticality   critical
 * @inputs        client, market_id
 * @outputs       market_transport_sale_rates
 * @depends       utils/currency.js, services/fx-chain-service.js
 * @used-by       services/order-checkout-service.js
 * @db-read       market_transport_sale_rates, markets
 * @db-write      none
 * @db-txn        none
 * @doctrine      fail_closed, no_country_branch, attested_cost_is_not_a_sale_price
 * @impact-areas  checkout, transport, market
 * @version       2026-10
 */
'use strict';

const { projectAmount } = require('../utils/currency');
const { resolveChain } = require('./fx-chain-service');

const RATE_KEYS = Object.freeze(['SEA_KMF_PER_KG_COMMERCIAL', 'AIR_KMF_PER_KG_TAXABLE']);
const BASE_CURRENCY = 'KMF';

function conversionUnavailable(cause) {
  const err = new Error('Aucune conversion gouvernée du tarif de transport de ce marché vers la base KMF : commande refusée.');
  err.code = 'MARKET_TRANSPORT_TARIFF_MISSING';
  err.statusCode = 409;
  err.cause = cause;
  return err;
}

// Tarif par kg exprimé en `currency` → KMF de base, par la seule voie gouvernée :
// KMF tel quel ; devises à parité fixe vers EUR (XAF, EUR) via currency_parities ; DJF via la chaîne
// EUR→USD→DJF (taux approuvé et frais requis). Toute autre voie ou toute indisponibilité = refus.
async function rateToKmfPerKg(rate, currency, { client } = {}) {
  const ccy = String(currency || '').trim().toUpperCase();
  if (ccy === BASE_CURRENCY) return rate;
  try {
    if (ccy === 'DJF') {
      const chain = await resolveChain({ client });
      return await projectAmount(rate / chain.eur_to_djf, 'EUR', BASE_CURRENCY);
    }
    return await projectAmount(rate, ccy, BASE_CURRENCY);
  } catch (err) {
    throw conversionUnavailable(err);
  }
}

// Tarifs de vente transport actifs d'un Market, en KMF de base par kg, ou {} s'il n'en a aucun.
// Une ligne dont la devise diffère de celle du marché est ignorée (fail-closed).
async function loadMarketTransportSaleRates(client, marketId) {
  if (!marketId) return {};
  const { rows } = await client.query(
    `SELECT r.rate_key, r.rate_per_kg, r.currency
       FROM market_transport_sale_rates r
       JOIN markets m ON m.id = r.market_id AND UPPER(btrim(m.currency)) = r.currency
      WHERE r.market_id = $1::uuid
        AND r.revoked_at IS NULL
        AND r.valid_from <= now()`,
    [marketId]
  );
  const out = {};
  for (const row of rows) {
    const rate = Number(row.rate_per_kg);
    if (RATE_KEYS.includes(row.rate_key) && rate > 0) {
      out[row.rate_key] = await rateToKmfPerKg(rate, row.currency, { client });
    }
  }
  return out;
}

module.exports = { RATE_KEYS, loadMarketTransportSaleRates, rateToKmfPerKg };
