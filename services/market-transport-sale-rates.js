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
 * @db-read       currency_parities, market_transport_sale_rates, markets
 * @db-write      none
 * @db-txn        none
 * @doctrine      fail_closed, no_country_branch, attested_cost_is_not_a_sale_price
 * @impact-areas  checkout, transport, market
 * @version       2026-10
 */
'use strict';

const { projectAmount, getCurrencyParity } = require('../utils/currency');
const { resolveChain } = require('./fx-chain-service');

const RATE_KEYS = Object.freeze(['SEA_KMF_PER_KG_COMMERCIAL', 'AIR_KMF_PER_KG_TAXABLE']);
const BASE_CURRENCY = 'KMF';
// Écart relatif toléré entre le pivot EUR/KMF de finance_config (paiements) et la parité fixe (prix/transport).
const EUR_KMF_PIVOT_TOLERANCE = 0.001;

function conversionUnavailable(cause) {
  const err = new Error('Aucune conversion gouvernée du tarif de transport de ce marché vers la base KMF : commande refusée.');
  err.code = 'MARKET_TRANSPORT_TARIFF_MISSING';
  err.statusCode = 409;
  err.cause = cause;
  return err;
}

// NB : les clés *_KMF_PER_KG_* sont un nom de contrat hérité ; la valeur stockée est dans la devise du marché.
// Tarif par kg exprimé en `currency` → KMF de base, TOUJOURS via le pivot EUR, avec la preuve de conversion.
// KMF tel quel ; XAF/EUR via currency_parities ; DJF via la chaîne EUR→USD→DJF (taux approuvé et frais requis,
// erreur fx_rate_unavailable propagée telle quelle). Toute autre voie = refus. Pleine précision, aucun arrondi ici.
async function convertRateToKmfPerKg(rate, currency, { client } = {}) {
  const ccy = String(currency || '').trim().toUpperCase();
  if (ccy === BASE_CURRENCY) return { kmf: rate, conversion: { pivot: null, legs: [] } };
  if (ccy === 'DJF') {
    const chain = await resolveChain({ client }); // FxChainUnavailableError (fx_rate_unavailable) propagée
    try {
      const kmfParity = await getCurrencyParity(BASE_CURRENCY);
      const eur = rate / chain.eur_to_djf;
      return {
        kmf: eur * kmfParity,
        conversion: { pivot: 'EUR', eur_amount: eur, legs: [...chain.legs, { kind: 'parity', currency: BASE_CURRENCY, eur_rate: kmfParity }] },
      };
    } catch (err) { throw conversionUnavailable(err); }
  }
  try {
    const [fromParity, kmfParity] = await Promise.all([getCurrencyParity(ccy), getCurrencyParity(BASE_CURRENCY)]);
    const kmf = await projectAmount(rate, ccy, BASE_CURRENCY);
    return {
      kmf,
      conversion: {
        pivot: 'EUR', eur_amount: rate / fromParity,
        legs: [{ kind: 'parity', currency: ccy, eur_rate: fromParity }, { kind: 'parity', currency: BASE_CURRENCY, eur_rate: kmfParity }],
      },
    };
  } catch (err) {
    throw conversionUnavailable(err);
  }
}

async function rateToKmfPerKg(rate, currency, opts) {
  return (await convertRateToKmfPerKg(rate, currency, opts)).kmf;
}

// Tarifs de vente transport actifs d'un Market : { rates (KMF de base par kg), lines (preuves figeables) }.
// Une ligne dont la devise diffère de celle du marché est ignorée (fail-closed).
async function loadMarketTransportSaleTariffs(client, marketId) {
  const out = { rates: {}, lines: [] };
  if (!marketId) return out;
  const { rows } = await client.query(
    `SELECT r.id, r.rate_key, r.rate_per_kg, r.currency, r.evidence_ref
       FROM market_transport_sale_rates r
       JOIN markets m ON m.id = r.market_id AND UPPER(btrim(m.currency)) = r.currency
      WHERE r.market_id = $1::uuid
        AND r.revoked_at IS NULL
        AND r.valid_from <= now()`,
    [marketId]
  );
  for (const row of rows) {
    const rate = Number(row.rate_per_kg);
    if (!RATE_KEYS.includes(row.rate_key) || !(rate > 0)) continue;
    const { kmf, conversion } = await convertRateToKmfPerKg(rate, row.currency, { client });
    out.rates[row.rate_key] = kmf;
    out.lines.push({
      rate_id: row.id, rate_key: row.rate_key, rate_per_kg_local: rate, currency: row.currency,
      evidence_ref: row.evidence_ref, kmf_per_kg: kmf, conversion,
    });
  }
  return out;
}

async function loadMarketTransportSaleRates(client, marketId) {
  return (await loadMarketTransportSaleTariffs(client, marketId)).rates;
}

// Garde-fou paiements : total_eur = total_kmf / finance_config.eur_kmf ; prix et transport passent par la parité
// fixe KMF. Les deux doivent être le même pivot, sinon Stripe/PayPal factureraient un montant ≠ prix local.
async function assertEurKmfPivotConsistent(financeEurKmf) {
  const parity = await getCurrencyParity(BASE_CURRENCY);
  const finance = Number(financeEurKmf);
  if (!(finance > 0) || !(parity > 0) || Math.abs(finance - parity) / parity > EUR_KMF_PIVOT_TOLERANCE) {
    const err = new Error('Pivot EUR/KMF incohérent entre finance_config et currency_parities : commande refusée.');
    err.code = 'EUR_KMF_PIVOT_DIVERGENCE';
    err.statusCode = 409;
    throw err;
  }
}

module.exports = {
  RATE_KEYS, EUR_KMF_PIVOT_TOLERANCE,
  loadMarketTransportSaleRates, loadMarketTransportSaleTariffs,
  convertRateToKmfPerKg, rateToKmfPerKg, assertEurKmfPivotConsistent,
};
