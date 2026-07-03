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
 * @db-read       (none)
 * @db-write      (none)
 * @db-txn        (none)
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md
 * @impact-areas  catalog, product-discovery, modal
 * @version       2026-07
 */

/**
 * KOMERCE — Frontière publique du catalogue
 * ═══════════════════════════════════════════════════════════════════
 *
 * Doctrine catalogue (DOCTRINE_CATALOGUE.md, invariant catalog.feature.js) :
 * « la boutique ne lit que les champs publiés : les champs de cuisine
 * (name_source, description_source, source_locale, content_source,
 * enrichment_version...) lui sont invisibles ».
 *
 * PRINCIPE : une seule liste de champs publiés, partagée par tous les
 * endpoints qui exposent un produit au client (liste ET détail). Aucun
 * endpoint public ne doit faire `SELECT *` puis `res.json(row)` brut —
 * c'est exactement ce qui laisse fuir les champs de cuisine dès qu'une
 * migration ajoute une colonne (cf. 098_catalog_refinery_foundation.sql).
 *
 * Toute nouvelle colonne de cuisine (raffinerie, overrides...) est donc
 * invisible par défaut : il faut l'ajouter explicitement ici pour
 * qu'elle devienne publique — jamais l'inverse.
 */

'use strict';

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

/**
 * Colonnes SQL préfixées, pour un SELECT explicite (list).
 * @param {string} [alias='p'] alias de table
 * @returns {string}
 */
function publicProductColumns(alias = 'p') {
  return PUBLIC_PRODUCT_FIELDS.map((f) => `${alias}.${f}`).join(',\n         ');
}

/**
 * Projette une ligne produit (potentiellement `SELECT *`, avec champs de
 * cuisine) sur la seule vue publique. `variants`, quand présent, est
 * toujours propagé (ajouté en mémoire par la route, pas une colonne DB).
 *
 * @param {Object} row
 * @returns {Object|null|undefined}
 */
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
  PUBLIC_PRODUCT_FIELDS,
  publicProductColumns,
  toPublicProduct,
};
