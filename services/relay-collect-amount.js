/**
 * relay-collect-amount — montant À ENCAISSER affiché à l'agent relais,
 * dans la devise DU MARCHÉ (jamais le pivot interne KMF pour CM/CG).
 *
 * Vérités distinctes, jamais mélangées :
 *   orders.total_kmf                      = pivot interne (Payment Boundary)
 *   orders.display_total_amount/currency  = ce que le client a vu (fixé à la commande)
 *   markets.currency                      = devise d'encaissement du marché
 *
 * Règle fail-closed : pour un marché non-KMF, le montant n'est affiché que si
 * le snapshot est dans la devise du marché. Sinon `available:false` — l'UI
 * n'invente ni conversion ni repli KMF.
 *
 * @used-by services/relay-dashboard-queries.js
 */
'use strict';

function resolveCollectAmount({ total_kmf, display_total_amount, display_currency, market_currency }) {
  const marketCurrency = market_currency ? String(market_currency).toUpperCase() : 'KMF';
  if (marketCurrency === 'KMF') {
    return { amount: Math.round(Number(total_kmf) || 0), currency: 'KMF', available: true };
  }
  if (display_total_amount != null && display_currency
      && String(display_currency).toUpperCase() === marketCurrency
      && Number.isFinite(Number(display_total_amount))) {
    return { amount: Number(display_total_amount), currency: marketCurrency, available: true };
  }
  return { amount: null, currency: marketCurrency, available: false };
}

module.exports = { resolveCollectAmount };
