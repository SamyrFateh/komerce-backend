/**
 * @komerce-arch
 * @role          currency-boundary
 * @domain        market
 * @layer         util
 * @criticality   medium
 * @inputs        amount, market_id
 * @outputs       formatted_amount_string
 * @depends       db, markets (M0)
 * @db-write      none
 * @db-read       markets
 * @used-by       non câblé — M5 livre l'outil, ne migre pas les affichages *_kmf existants
 * @doctrine      KOMERCE_MARKET_LAYER_FREEZE.md — minor_unit consommé ICI uniquement,
 *                jamais re-dérivé ailleurs (routes, services, boutique)
 * @impact-areas  market, economic-engine
 * @version       2026-08
 *
 * DISTINCT de public/boutique/js/b-utils.js#fmt() : ce fichier-là convertit un
 * montant KMF vers un taux de change d'affichage (diaspora EUR), détecté par
 * fuseau horaire — un montant KMF unique, présenté différemment. Ce module-ci
 * porte la devise RÉELLE d'un marché (celle dans laquelle la commande existe),
 * pas une conversion d'affichage. Les deux ne se substituent pas l'un à l'autre.
 *
 * CONVENTION DE STOCKAGE : ce module formate un montant déjà exprimé dans
 * l'unité affichée (12500 → "12 500 KMF", 42.5 → "42,50 €") — jamais en
 * sous-unité entière (centimes). Cohérent avec les colonnes `*_kmf`
 * existantes (minor_unit=0, donc aucune ambiguïté possible aujourd'hui). Le
 * jour où un marché à minor_unit > 0 a ses propres colonnes de montant, la
 * convention de STOCKAGE (entier sous-unité vs décimal) sera à trancher à ce
 * moment-là — ce module ne préjuge que du FORMATAGE.
 */
'use strict';

const db = require('../db');

const MARKET_CACHE_TTL = 5 * 60 * 1000; // 5 min — markets change rarement (M0 : ouverture = 1 INSERT)
let _cache = new Map();

/**
 * Résout { currency, minor_unit } pour un market_id, avec cache court.
 * @param {string} marketId
 * @returns {Promise<{currency: string, minor_unit: number}>}
 * @throws si le marché n'existe pas — jamais de valeur par défaut silencieuse
 */
async function getMarketCurrency(marketId) {
  const cached = _cache.get(marketId);
  if (cached && Date.now() - cached.ts < MARKET_CACHE_TTL) {
    return { currency: cached.currency, minor_unit: cached.minor_unit };
  }

  const { rows } = await db.query(
    `SELECT currency, minor_unit FROM markets WHERE id = $1`,
    [marketId]
  );
  if (!rows.length) {
    throw new Error(`getMarketCurrency: marché introuvable (${marketId})`);
  }

  const { currency, minor_unit } = rows[0];
  _cache.set(marketId, { currency, minor_unit, ts: Date.now() });
  return { currency, minor_unit };
}

/**
 * Invalide le cache — pour un marché précis, ou tout si aucun argument.
 * @param {string} [marketId]
 */
function invalidateMarketCurrencyCache(marketId) {
  if (marketId) _cache.delete(marketId);
  else _cache.clear();
}

/**
 * Symbole/libellé d'une devise. EUR affiche '€', les autres affichent leur
 * code ISO tel quel (KMF, XAF) — pas de table de symboles inventée pour des
 * devises qui n'existent pas encore dans markets.
 */
function currencySymbol(currency) {
  return currency === 'EUR' ? '€' : String(currency || '');
}

/**
 * Formate un montant selon une devise/minor_unit déjà résolus (pas de
 * lookup DB ici — fonction pure, testable sans mock).
 *
 * Piège pour qui écrit un test ou une comparaison de chaîne sur le résultat :
 * Intl.NumberFormat('fr-FR') insère U+202F (espace fine insécable) comme
 * séparateur de milliers, pas une espace ASCII normale (U+0020) — visuellement
 * identique, différent en octets. Cohérent avec utils/email.js et
 * utils/pickup-receipt-html.js, qui produisent déjà ce caractère aujourd'hui
 * en production sans normalisation — ce module ne diverge pas de l'existant.
 *
 * @param {number} amount
 * @param {{currency: string, minor_unit: number}} market
 * @returns {string}
 */
function formatAmount(amount, { currency, minor_unit }) {
  const n = Number(amount) || 0;
  const formatted = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: minor_unit,
    maximumFractionDigits: minor_unit,
  }).format(n);
  return `${formatted} ${currencySymbol(currency)}`;
}

/**
 * Résout puis formate en un seul appel — pratique pour l'appelant qui n'a
 * qu'un market_id sous la main.
 * @param {number} amount
 * @param {string} marketId
 * @returns {Promise<string>}
 */
async function formatAmountForMarket(amount, marketId) {
  const market = await getMarketCurrency(marketId);
  return formatAmount(amount, market);
}

module.exports = {
  getMarketCurrency,
  invalidateMarketCurrencyCache,
  currencySymbol,
  formatAmount,
  formatAmountForMarket,
};
