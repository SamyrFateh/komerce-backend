/**
 * @komerce-arch
 * @role          currency-boundary
 * @domain        market
 * @layer         util
 * @criticality   medium
 * @inputs        amount, market_id, currency
 * @outputs       formatted_amount_string, projected_amount
 * @depends       db, markets (M0), currency_parities (P1)
 * @db-write      none
 * @db-read       markets, currency_parities
 * @used-by       non câblé — M5/P1 livrent l'outil, ne migrent pas les affichages *_kmf existants (P2)
 * @doctrine      GAP_ANALYSIS_CURRENCY_BOUNDARY.md — FREEZE FINAL 22-08-2026.
 *                reference_currency = EUR (cette boundary). economic_engine_base_currency
 *                = KMF (economic-engine, inchangé, jamais touché ici). minor_unit consommé
 *                ICI uniquement, jamais re-dérivé ailleurs (routes, services, boutique).
 * @impact-areas  market, economic-engine
 * @version       2026-08
 *
 * DISTINCT de public/boutique/js/b-utils.js#fmt() : ce fichier-là convertit un
 * montant KMF vers un taux de change d'affichage (diaspora EUR), détecté par
 * fuseau horaire — un montant KMF unique, présenté différemment. Ce module-ci
 * porte la devise RÉELLE d'un marché (celle dans laquelle la commande existe),
 * pas une conversion d'affichage. Les deux ne se substituent pas l'un à l'autre
 * — b-utils.js est appelé à devenir un ADAPTER de cette boundary en P2, jamais
 * l'inverse (freeze, correction d'ownership du 22-08).
 *
 * INVARIANT 9 (freeze) : projectAmount() ne stocke ni ne calcule JAMAIS un axe
 * direct entre deux devises Zone franc (ex. KMF↔XAF) — toujours dérivé via EUR,
 * la reference_currency. currency_parities (P1) ne contient qu'un axe par
 * devise vers EUR, jamais une matrice de paires.
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
let _parityCache = new Map(); // même TTL, séparé de _cache : clé = devise, pas market_id

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

/**
 * Résout eur_rate pour une devise, avec cache court (même TTL que le
 * cache marché — les parités Zone franc ne bougent, par construction,
 * jamais entre deux runs de ce process).
 * @param {string} currency
 * @returns {Promise<number>} unités de currency pour 1 EUR
 * @throws si la devise n'est pas dans currency_parities — jamais un taux
 *   par défaut silencieux. Une devise absente ici est soit une faute de
 *   frappe, soit une devise de sourcing hors périmètre (freeze invariant 5) :
 *   dans les deux cas, une erreur explicite vaut mieux qu'un calcul faux.
 */
async function getCurrencyParity(currency) {
  const cached = _parityCache.get(currency);
  if (cached && Date.now() - cached.ts < MARKET_CACHE_TTL) {
    return cached.eur_rate;
  }

  const { rows } = await db.query(
    `SELECT eur_rate FROM currency_parities WHERE currency = $1`,
    [currency]
  );
  if (!rows.length) {
    throw new Error(
      `getCurrencyParity: devise sans parité fixe enregistrée (${currency}). ` +
      `Si c'est une devise de sourcing (USD/AED/CNY...), elle est hors ` +
      `périmètre par construction (freeze §CURRENCY BOUNDARY, invariant 5).`
    );
  }

  const eur_rate = Number(rows[0].eur_rate);
  _parityCache.set(currency, { eur_rate, ts: Date.now() });
  return eur_rate;
}

/**
 * Invalide le cache de parités — même contrat que invalidateMarketCurrencyCache.
 * @param {string} [currency]
 */
function invalidateCurrencyParityCache(currency) {
  if (currency) _parityCache.delete(currency);
  else _parityCache.clear();
}

/**
 * Projette un montant d'une devise vers une autre, TOUJOURS dérivé via EUR
 * (reference_currency de la boundary) — jamais un axe direct stocké entre
 * deux devises Zone franc (freeze invariant 9). Fonction pure côté calcul
 * (deux lookups de parité, une division, une multiplication) — ne fait
 * AUCUN arrondi : le résultat est un nombre à pleine précision, l'arrondi
 * pour affichage est la responsabilité de formatAmount() (qui connaît
 * minor_unit, que cette fonction-ci ne connaît pas — currency_parities est
 * indexée par devise, pas par marché, plusieurs marchés peuvent partager
 * une devise, ex. CM et CG partagent XAF).
 *
 * fromCurrency === toCurrency est un cas valide, retourne amount tel quel
 * (pas un cas d'erreur, pas un passage par EUR inutile).
 *
 * @param {number} amount
 * @param {string} fromCurrency
 * @param {string} toCurrency
 * @returns {Promise<number>}
 */
async function projectAmount(amount, fromCurrency, toCurrency) {
  const n = Number(amount) || 0;
  if (fromCurrency === toCurrency) return n;

  const [fromRate, toRate] = await Promise.all([
    getCurrencyParity(fromCurrency),
    getCurrencyParity(toCurrency),
  ]);

  const amountInEur = n / fromRate;
  return amountInEur * toRate;
}

/**
 * Projette puis formate en un seul appel pour un market_id cible — le point
 * d'entrée le plus court pour un consommateur qui a un montant dans une
 * devise source et veut l'afficher pour un marché, sans jamais voir la
 * formule (freeze Q6).
 * @param {number} amount
 * @param {string} fromCurrency
 * @param {string} marketId
 * @returns {Promise<string>}
 */
async function projectAndFormatForMarket(amount, fromCurrency, marketId) {
  const market = await getMarketCurrency(marketId);
  const projected = await projectAmount(amount, fromCurrency, market.currency);
  return formatAmount(projected, market);
}

module.exports = {
  getMarketCurrency,
  invalidateMarketCurrencyCache,
  getCurrencyParity,
  invalidateCurrencyParityCache,
  projectAmount,
  projectAndFormatForMarket,
  currencySymbol,
  formatAmount,
  formatAmountForMarket,
};
