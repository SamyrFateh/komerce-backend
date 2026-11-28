/**
 * @komerce-arch-lite
 * @role          boutique-market-context
 * @domain        catalog
 * @layer         ui-boundary
 * @owner         public/boutique/js/market-context.js
 * @purpose       Unique module frontière frontend : projette les données pays
 *                consommées par le hero, la home et les surfaces de navigation.
 *                Les données pays sont servies depuis le référentiel PostgreSQL.
 * @impact-areas  boutique, hero, home, footer, checkout
 * @version       2026-09
 *
 * DOCTRINE (cf. KOMERCE_MARKET_LAYER_FREEZE.md §3) :
 *   MarketContext = navigation — contextuel, client, commutable, NON autorisant.
 *   Ce module ne connaît PAS requireMarketScope ni operator_market_scopes.
 *   Il ne fait PAS de switch(market) dans les consommateurs — il résout un objet,
 *   les consommateurs le lisent tel quel.
 */
'use strict';

// Loaded synchronously from the public read-only PostgreSQL projection by
// /boutique/js/market-registry.js (script defer ordered before this one).
// NO client-side fallback table: disabled/unknown markets must not reappear.
const MARKET_ROWS = Array.isArray(window.KomerceMarketRegistry)
  ? window.KomerceMarketRegistry : [];
const MARKETS = Object.create(null);
for (const row of MARKET_ROWS) {
  if (!row || !/^[A-Z]{2}$/.test(row.code) || !/^[A-Z]{3}$/.test(row.currency)) continue;
  const t = row.storefront_texts && typeof row.storefront_texts === 'object'
    ? row.storefront_texts : {};
  const name = String(row.name || '').trim();
  if (!name) continue;
  MARKETS[row.code] = Object.freeze({
    code: row.code, name, currency: row.currency, minor_unit: Number(row.minor_unit),
    gentile: t.gentile || ('Komerce — ' + name),
    gentile_short: t.gentile_short || name,
    delivery_line: t.delivery_line || 'Découvrez les produits disponibles',
    payment_label: t.payment_label || 'Paiement selon les moyens disponibles',
    pickup_label: t.pickup_label || 'Retrait relais',
    relay_group_label: t.relay_group_label || 'Zone',
    relay_default_zone: t.relay_default_zone || null,
    seo_title: t.seo_title || ('Komerce — ' + name),
    seo_description: t.seo_description || ('La boutique Komerce ' + name),
    og_title: t.og_title || ('Komerce — ' + name),
    og_description: t.og_description || ('Découvrez les offres Komerce ' + name),
    footer_tagline: t.footer_tagline || ('Découvrez Komerce ' + name),
    free_ship_label: t.free_ship_label || 'Livraison selon offre',
    price_label: t.price_label || ('Prix en ' + row.currency),
    welcome: t.welcome || '',
  });
}

const DEFAULT_MARKET = 'KM';
const hasMarket = code => Object.prototype.hasOwnProperty.call(MARKETS, code);

function getRequestedPathCode() {
  const match = /^\/([a-z]{2})\/?$/i.exec(window.location.pathname || '');
  return match ? match[1].toUpperCase() : null;
}

function getPathMarketCode() {
  const code = getRequestedPathCode();
  return hasMarket(code) ? code : null;
}

function getPreviewMarketOverride() {
  // A requested country is authoritative for navigation even when the
  // registry is missing that country. Never substitute another market.
  const pathMarket = getRequestedPathCode();
  if (pathMarket) {
    if (!hasMarket(pathMarket)) throw new Error('STORE_MARKET_UNAVAILABLE');
    return pathMarket;
  }
  const requested = new URLSearchParams(window.location.search).get('market');
  if (requested !== null) {
    const code = String(requested).trim().toUpperCase();
    if (!hasMarket(code)) throw new Error('STORE_MARKET_UNAVAILABLE');
    return code;
  }
  // Existing consumers use DEFAULT when this method returns null.
  // Only allow that fallback when KM is actually present in the registry.
  if (!hasMarket(DEFAULT_MARKET)) throw new Error('STORE_MARKET_UNAVAILABLE');
  return null;
}

function getMarketContext() {
  return MARKETS[getPreviewMarketOverride() || DEFAULT_MARKET];
}

function getMarket(code) {
  return hasMarket(String(code || '').toUpperCase()) ? MARKETS[String(code).toUpperCase()] : undefined;
}

window.KomerceMarket = {
  get: getMarketContext,
  getByCode: getMarket,
  getPreviewOverride: getPreviewMarketOverride,
  getPathCode: getPathMarketCode,
  DEFAULT: DEFAULT_MARKET,
};
