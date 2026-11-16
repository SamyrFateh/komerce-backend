/**
 * @komerce-arch
 * @role          public-market-storefront-read-model
 * @domain        market
 * @layer         service
 * @criticality   high
 * @inputs        canonical markets lifecycle and storefront_texts
 * @outputs       public active-market storefront projection
 * @db-read       markets
 * @db-write      none
 * @impact-areas  boutique, market, hero, seo, checkout
 * @doctrine      active_markets_only, public_projection_not_authority
 */
'use strict';

// This is deliberately a read model. No market provisioning, payment authorization
// or order-level market validation may depend on a browser-supplied projection.
const PUBLIC_TEXT_KEYS = Object.freeze([
  'gentile', 'gentile_short', 'delivery_line', 'payment_label',
  'pickup_label', 'relay_group_label', 'relay_default_zone', 'seo_title',
  'seo_description', 'og_title', 'og_description', 'footer_tagline',
  'free_ship_label', 'price_label', 'welcome',
]);

function projectPublicMarket(row) {
  const code = String(row.code || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || row.is_active !== true || row.lifecycle_status !== 'ACTIVE') return null;
  const name = String(row.name || '').trim();
  const currency = String(row.currency || '').trim().toUpperCase();
  const minorUnit = Number(row.minor_unit);
  if (!name || !/^[A-Z]{3}$/.test(currency) || !Number.isInteger(minorUnit) || minorUnit < 0 || minorUnit > 4) return null;
  const raw = row.storefront_texts && typeof row.storefront_texts === 'object' && !Array.isArray(row.storefront_texts)
    ? row.storefront_texts : {};
  const texts = {};
  for (const key of PUBLIC_TEXT_KEYS) {
    if (typeof raw[key] === 'string') texts[key] = raw[key].slice(0, 500);
  }
  return { code, name, currency, minor_unit: minorUnit, storefront_texts: texts };
}

async function listPublicMarkets(executor) {
  const { rows } = await executor.query(
    `SELECT code, name, currency, minor_unit, is_active, lifecycle_status, storefront_texts
       FROM markets
      WHERE is_active = TRUE AND lifecycle_status = 'ACTIVE'
      ORDER BY code`
  );
  return rows.map(projectPublicMarket).filter(Boolean);
}

module.exports = { PUBLIC_TEXT_KEYS, projectPublicMarket, listPublicMarkets };
