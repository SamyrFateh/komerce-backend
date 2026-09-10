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
 * @version       2026-09
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

const PUBLIC_CATALOG_EXCLUDED_REF_PREFIXES = Object.freeze([
  // Les 500 SHOWCASE-V2 sont des fixtures de staging. Elles peuvent rester en
  // base pour les harnais/tests mais ne sont jamais des produits vendables
  // destinés à la Boutique publique.
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

/**
 * Un média inline data:image est un fixture/placeholder, pas une photographie
 * produit publiable. Les assets locaux (/images/...) et médias HTTPS restent
 * autorisés : le Golden Product et les fournisseurs réels continuent donc à
 * passer ce gate.
 */
function isSyntheticPublicMediaUrl(value) {
  const url = String(value || '').trim();
  return /^data:image\//i.test(url);
}

function isExcludedPublicProductRef(value) {
  const ref = String(value || '').trim().toUpperCase();
  if (!ref) return true;
  return PUBLIC_CATALOG_EXCLUDED_REF_PREFIXES.some((prefix) => ref.startsWith(prefix));
}

/**
 * Prédicat SQL canonique d'exposition Boutique.
 *
 * On ne désactive ni ne supprime les fixtures : on sépare explicitement
 * données de staging et produits publics au point de lecture. Ceci protège
 * aussi les catégories/comptages, qui doivent refléter le catalogue réellement
 * visible plutôt que les 500 fixtures SHOWCASE-V2.
 *
 * @param {string} [alias='p'] alias SQL de la table products
 * @param {object} [options]
 * @param {number} [options.marketCodeParamIndex] index positionnel (1-based)
 *   du paramètre déjà réservé par l'appelant pour le code marché (ex. 'CM'),
 *   déjà résolu serveur — jamais une confiance aveugle en une valeur brute.
 *   Quand fourni, ajoute EXISTS (product_market_exposure ENABLED pour ce
 *   marché, joint par code) au prédicat — cutover LOT 4 : fail-closed par
 *   marché, absence de ligne = DISABLED. Quand omis (comportement
 *   historique, préservé à l'identique), aucune notion de marché n'entre
 *   dans la visibilité — c'était déjà le cas avant le cutover
 *   product_market_exposure.
 */
function publicCatalogVisibilitySql(alias = 'p', options = {}) {
  const a = assertSqlAlias(alias);
  const excludedRefs = PUBLIC_CATALOG_EXCLUDED_REF_PREFIXES
    .map((prefix) => `${a}.product_ref NOT LIKE '${prefix.replace(/'/g, "''")}%'`)
    .join(' AND ');

  const conditions = [
    `${a}.is_active = TRUE`,
    excludedRefs,
    `NULLIF(BTRIM(${a}.image_url), '') IS NOT NULL`,
    `${a}.image_url NOT ILIKE 'data:image/%'`,
  ].filter(Boolean);

  if (options.marketCodeParamIndex != null) {
    const idx = Number(options.marketCodeParamIndex);
    if (!Number.isInteger(idx) || idx < 1) {
      throw new Error(`marketCodeParamIndex invalide: ${options.marketCodeParamIndex}`);
    }
    conditions.push(
      `EXISTS (SELECT 1 FROM product_market_exposure pme ` +
      `JOIN markets pme_mkt ON pme_mkt.id = pme.market_id ` +
      `WHERE ${a}.id = pme.product_id AND pme_mkt.code = $${idx} ` +
      `AND pme.commercial_exposure = 'ENABLED')`
    );
  }

  return conditions.join(' AND ');
}

/**
 * Même décision hors SQL, utile aux tests/consommateurs qui manipulent déjà
 * une ligne produit en mémoire.
 */
function isPublicCatalogProduct(row) {
  if (!row || row.is_active === false) return false;
  if (isExcludedPublicProductRef(row.product_ref)) return false;
  const imageUrl = String(row.image_url || '').trim();
  if (!imageUrl || isSyntheticPublicMediaUrl(imageUrl)) return false;
  return true;
}

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
  PUBLIC_CATALOG_EXCLUDED_REF_PREFIXES,
  PUBLIC_PRODUCT_FIELDS,
  isSyntheticPublicMediaUrl,
  isExcludedPublicProductRef,
  isPublicCatalogProduct,
  publicCatalogVisibilitySql,
  publicProductColumns,
  toPublicProduct,
};
