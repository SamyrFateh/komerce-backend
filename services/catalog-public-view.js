/**
 * @komerce-arch
 * @role          catalog-public-view
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        product_db_row
 * @outputs       public_product_view
 * @depends       (none)
 * @used-by       routes/products.js
 * @db-read       markets, product_market_exposure, product_market_price_drafts, product_skus, product_variants
 * @db-write      (none)
 * @db-txn        (none)
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md, only_LOCAL_ACTIVE_is_buyer_effective, visible_means_sellable
 * @impact-areas  catalog, product-discovery, modal, market-autonomy, checkout
 * @version       2026-09-business-truth
 */

'use strict';

const PUBLIC_CATALOG_EXCLUDED_REF_PREFIXES = Object.freeze([
  'SHOWCASE-V2-',
]);

const PUBLIC_PRODUCT_FIELDS = [
  'id',
  'product_ref',
  'sku',
  'name',
  'description',
  'category',
  'subcategory',
  'price_aed',
  'price_kmf',
  'price_eur',
  'weight_kg',
  'dimensions_cm',
  'stock',
  'image_url',
  'images',
  'badge',
  'emoji',
  'fragility',
  'promo_pct',
  'is_available',
  'customs_risk_coeff',
  'has_couture',
  'sourcing_source',
  'requires_secure_transport',
  'unsold_price_kmf',
  'unsold_channel',
  'has_variants',
  'created_at',
];

function assertSqlAlias(alias) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) {
    throw new Error(`Alias SQL catalogue invalide: ${alias}`);
  }
  return alias;
}

function isSyntheticPublicMediaUrl(value) {
  const url = String(value || '').trim();
  return /^data:image\//i.test(url);
}

function isExcludedPublicProductRef(value) {
  const ref = String(value || '').trim().toUpperCase();
  if (!ref) return true;
  return PUBLIC_CATALOG_EXCLUDED_REF_PREFIXES.some((prefix) => ref.startsWith(prefix));
}

function supplierOrderIdentitySql(skuAlias) {
  const s = assertSqlAlias(skuAlias);
  return `(
    COALESCE(${s}.source, 'MANUAL') <> 'SUPPLIER'
    OR (
      NULLIF(BTRIM(${s}.supplier_sku), '') IS NOT NULL
      AND NULLIF(BTRIM(${s}.supplier_unit_ref), '') IS NOT NULL
      AND ${s}.supplier_order_identity IS NOT NULL
      AND jsonb_typeof(${s}.supplier_order_identity) = 'object'
      AND COALESCE(${s}.supplier_order_identity->>'provider', '')
          ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
      AND COALESCE(${s}.supplier_order_identity->>'version', '')
          ~ '^[1-9][0-9]*$'
      AND jsonb_typeof(${s}.supplier_order_identity->'payload') = 'object'
      AND ${s}.supplier_order_identity->'payload' <> '{}'::jsonb
    )
  )`;
}

function sellableSkuSql(skuAlias) {
  const s = assertSqlAlias(skuAlias);
  return `(
    ${s}.is_active = TRUE
    AND ${s}.stock > 0
    AND (${s}.price_kmf IS NULL OR ${s}.price_kmf > 0)
    AND ${supplierOrderIdentitySql(s)}
  )`;
}

/**
 * Gate statique de vendabilité utilisé AVANT d'exposer un produit à un client.
 *
 * La boutique ne promet pas un produit si Komerce ne connaît aucune unité
 * réellement vendable. Pour un produit SKU, toutes les unités actives qui ont
 * encore du stock doivent être statiquement commandables : on n'affiche jamais
 * une option AVAILABLE dont l'identité fournisseur est incomplète. Les SKU à
 * stock nul peuvent rester dans la fiche comme OUT_OF_STOCK.
 *
 * Le preflight fournisseur dynamique reste exécuté au checkout : ce gate ne
 * remplace pas la revalidation prix/stock/fret au moment du paiement.
 */
function sellableCatalogUnitSql(alias = 'p') {
  const a = assertSqlAlias(alias);
  return `(
    (
      ${a}.inventory_model = 'SKU'
      AND EXISTS (
        SELECT 1
          FROM product_skus sellable_sku
         WHERE sellable_sku.product_id = ${a}.id
           AND ${sellableSkuSql('sellable_sku')}
      )
      AND NOT EXISTS (
        SELECT 1
          FROM product_skus unsafe_sku
         WHERE unsafe_sku.product_id = ${a}.id
           AND unsafe_sku.is_active = TRUE
           AND unsafe_sku.stock > 0
           AND NOT (
             (unsafe_sku.price_kmf IS NULL OR unsafe_sku.price_kmf > 0)
             AND ${supplierOrderIdentitySql('unsafe_sku')}
           )
      )
    )
    OR
    (
      COALESCE(${a}.inventory_model, 'LEGACY_VARIANTS') <> 'SKU'
      AND (
        (
          COALESCE(${a}.has_variants, FALSE) = FALSE
          AND (${a}.stock IS NULL OR ${a}.stock > 0)
        )
        OR
        (
          COALESCE(${a}.has_variants, FALSE) = TRUE
          AND EXISTS (
            SELECT 1
              FROM product_variants sellable_variant
             WHERE sellable_variant.product_id = ${a}.id
               AND (sellable_variant.stock IS NULL OR sellable_variant.stock > 0)
          )
        )
      )
    )
  )`;
}

/**
 * Prédicat SQL canonique d'exposition Boutique.
 *
 * "Visible" est une vérité commerciale, pas un synonyme de "publié" :
 * un produit visible est actif, disponible, montrable, possède au moins une
 * unité vendable, et — lorsqu'un marché est fourni — est exposé avec un prix
 * LOCAL_ACTIVE sur CE MÊME marché.
 */
function publicCatalogVisibilitySql(alias = 'p', options = {}) {
  const a = assertSqlAlias(alias);
  const excludedRefs = PUBLIC_CATALOG_EXCLUDED_REF_PREFIXES
    .map((prefix) => `${a}.product_ref NOT LIKE '${prefix.replace(/'/g, "''")}%'`)
    .join(' AND ');

  const conditions = [
    `${a}.is_active = TRUE`,
    `${a}.is_available = TRUE`,
    excludedRefs,
    `NULLIF(BTRIM(${a}.image_url), '') IS NOT NULL`,
    `${a}.image_url NOT ILIKE 'data:image/%'`,
    sellableCatalogUnitSql(a),
  ].filter(Boolean);

  if (options.marketCodeParamIndex != null) {
    const idx = Number(options.marketCodeParamIndex);
    if (!Number.isInteger(idx) || idx < 1) {
      throw new Error(`marketCodeParamIndex invalide: ${options.marketCodeParamIndex}`);
    }
    conditions.push(
      `EXISTS (SELECT 1 FROM product_market_exposure pme ` +
      `JOIN markets pme_mkt ON pme_mkt.id = pme.market_id AND pme_mkt.is_active = TRUE ` +
      `WHERE ${a}.id = pme.product_id AND pme_mkt.code = $${idx} ` +
      `AND pme.commercial_exposure = 'ENABLED')`
    );
    conditions.push(
      `EXISTS (SELECT 1 FROM product_market_price_drafts pmpd ` +
      `JOIN markets pmpd_mkt ON pmpd_mkt.id = pmpd.market_id AND pmpd_mkt.is_active = TRUE ` +
      `WHERE ${a}.id = pmpd.product_id AND pmpd_mkt.code = $${idx} ` +
      `AND pmpd.status = 'LOCAL_ACTIVE')`
    );
  }

  return conditions.join(' AND ');
}

function isPublicCatalogProduct(row) {
  if (!row || row.is_active === false || row.is_available === false) return false;
  if (isExcludedPublicProductRef(row.product_ref)) return false;
  const imageUrl = String(row.image_url || '').trim();
  if (!imageUrl || isSyntheticPublicMediaUrl(imageUrl)) return false;
  return true;
}

function publicProductColumns(alias = 'p') {
  return PUBLIC_PRODUCT_FIELDS.map((f) => `${alias}.${f}`).join(',\n         ');
}

function toPublicProduct(row) {
  if (!row) return row;
  const out = {};
  for (const field of PUBLIC_PRODUCT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(row, field)) {
      out[field] = row[field];
    }
  }
  if (Object.prototype.hasOwnProperty.call(row, 'variants')) {
    out.variants = row.variants;
  }
  return out;
}

module.exports = {
  PUBLIC_CATALOG_EXCLUDED_REF_PREFIXES,
  PUBLIC_PRODUCT_FIELDS,
  isSyntheticPublicMediaUrl,
  isExcludedPublicProductRef,
  isPublicCatalogProduct,
  sellableCatalogUnitSql,
  publicCatalogVisibilitySql,
  publicProductColumns,
  toPublicProduct,
};
