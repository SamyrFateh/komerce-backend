/**
 * @komerce-arch
 * @role          orders-display-snapshot
 * @domain        orders
 * @layer         service
 * @criticality   medium
 * @inputs        totalKmf, displayMarketCode, relaisMarketId
 * @outputs       { amount, currency, meta }
 * @depends       utils/currency.js
 * @db-read       none
 * @db-write      none
 * @doctrine      GAP_ANALYSIS_CURRENCY_BOUNDARY.md — FREEZE FINAL 22-08-2026, P3
 * @impact-areas  orders, checkout
 * @version       2026-08
 *
 * TROISIÈME VÉRITÉ, distincte de deux systèmes existants, jamais mélangée :
 *   orders.total_kmf/total_eur = Payment Boundary (finance_config) —
 *     jamais lu ni écrit ici.
 *   currency_parities          = Currency Boundary (P1) — consommée via
 *     utils/currency.js, jamais dupliquée ici.
 *   display_total_amount/currency (ce module) = ce que le client a VU/
 *     confirmé, figé une fois, jamais une source de paiement.
 *
 * Extrait de routes/orders/create.js pour rester testable sans dépendre
 * des ~15 autres services que cette route orchestre (wallet, loyalty,
 * transport, etc.) — même logique, séparée pour être vérifiable seule.
 */
'use strict';

const currencyBoundary = require('../utils/currency');
const log = require('../utils/logger').child({ module: 'order-display-snapshot' });

/**
 * Résout le snapshot display pour une commande — invariants 3/4 du freeze :
 *   3. Le serveur calcule LUI-MÊME le montant via projectAmount() ;
 *      displayMarketCode n'est qu'un indice de contexte, jamais un montant.
 *   4. Ne suppose JAMAIS silencieusement que relaisMarketId (le marché du
 *      relais choisi) est le marché de navigation du client — le code
 *      client, s'il est valide, fait TOUJOURS foi en premier ; le relais
 *      n'est qu'un repli si aucun code n'a été fourni ou qu'il est invalide.
 *
 * Ne throw JAMAIS — un échec de résolution retourne un snapshot vide
 * ({ amount: null, currency: null, meta: null }), jamais une exception qui
 * bloquerait la création de la commande. C'est une donnée d'audit/
 * confirmation, pas une donnée de paiement.
 *
 * @param {object} params
 * @param {number} params.totalKmf - montant final en KMF (après remises/wallet)
 * @param {string|null} [params.displayMarketCode] - code marché fourni par le client (ex. 'CM')
 * @param {string|null} [params.relaisMarketId] - market_id du relais choisi (repli)
 * @returns {Promise<{amount: number|null, currency: string|null, meta: object|null}>}
 */
async function resolveDisplaySnapshot({ totalKmf, displayMarketCode = null, relaisMarketId = null }) {
  try {
    let resolved = null;
    let source = null;

    if (displayMarketCode) {
      try {
        resolved = await currencyBoundary.getMarketCurrencyByCode(displayMarketCode);
        source = 'display_market_code';
      } catch (e) {
        log.warn({ displayMarketCode, err: e.message },
          '[order-display-snapshot] code marché invalide — repli relais');
      }
    }

    if (!resolved && relaisMarketId) {
      resolved = await currencyBoundary.getMarketCurrency(relaisMarketId);
      source = 'relais_fallback';
    }

    if (!resolved) {
      // Ni code client valide, ni relais avec market_id : snapshot vide,
      // honnête plutôt qu'une devise par défaut inventée. Jamais bloquant.
      return { amount: null, currency: null, meta: null };
    }

    const projected = await currencyBoundary.projectAmount(totalKmf, 'KMF', resolved.currency);

    return {
      amount: currencyBoundary.roundToMinorUnit(projected, resolved.minor_unit),
      currency: resolved.currency,
      meta: {
        source,
        requested_code: displayMarketCode || null,
        resolved_currency: resolved.currency,
        base_amount: totalKmf,
        base_currency: 'KMF',
        computed_at: new Date().toISOString(),
      },
    };
  } catch (err) {
    log.error({ err: err.message }, '[order-display-snapshot] échec résolution — snapshot vide, commande non bloquée');
    return { amount: null, currency: null, meta: null };
  }
}

module.exports = { resolveDisplaySnapshot };
