/**
 * @komerce-arch
 * @role          catalog-promotion-orchestrator
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        product_id, normalized_source_contract (V2 validé)
 * @outputs       catalog_media_rows, product_variants_rows, product_skus_rows, product_sku_media_rows
 * @depends       services/catalog-promotion/axes.js, services/catalog-promotion/sku.js, services/catalog-promotion/sku-media.js, services/suppliers/normalized-product.js
 * @used-by       routes/sourcing-scanner.js (POST /candidates/:id/import-product)
 * @db-read       product_skus
 * @db-write      catalog_media, product_sku_media, product_skus, product_variants
 * @db-txn        caller_owned
 * @doctrine      PDC-8 (tous lots), DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  catalog
 * @version       2026-07
 */

/**
 * KOMERCE — PDC-8 Lot 6 : orchestration transactionnelle de la promotion
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Assemble les 3 fonctions pures déjà livrées (Lots 3/4/5) et l'upsert
 * média (Lot 2, schéma seul jusqu'ici) en une seule opération atomique.
 *
 * PROPRIÉTÉ DE TRANSACTION : ce module NE FAIT JAMAIS BEGIN/COMMIT/ROLLBACK.
 * Il reçoit un `client` déjà engagé dans une transaction ouverte par
 * l'appelant (routes/sourcing-scanner.js). C'est l'appelant qui décide du
 * commit final (après mise à jour du candidat) et du rollback en cas
 * d'erreur, à n'importe quelle étape.
 *
 * IDEMPOTENCE : chaque écriture s'appuie sur une contrainte UNIQUE réelle
 * (ux_catalog_media_source_identity, product_variants_unique_value,
 * ux_product_skus_supplier_identity, ux_product_sku_media_pair) — une
 * re-promotion du même produit ne duplique jamais une ligne.
 *
 * V1 LEGACY : normalized_source_contract absent/null → aucune promotion,
 * pas une erreur (produit legacy, cf. PDC-8 §PÉRIMÈTRE).
 */

'use strict';

const { mapOptionAxesToDescriptiveRows } = require('./catalog-promotion/axes');
const { planSkuReconciliation } = require('./catalog-promotion/sku');
const { resolveSkuMediaLinks } = require('./catalog-promotion/sku-media');
const { _validateRichStructureV2: validateRichStructureV2 } = require('./suppliers/normalized-product');

/**
 * Validation pré-promotion. Ne réutilise PAS validateNormalizedProduct (le
 * schéma V2 exige raw_payload, intentionnellement absent du snapshot
 * normalized_source_contract). Réutilise le validateur de structure riche
 * (axes/media/sellable_units) et ajoute les vérifications propres à la
 * promotion (PDC-8 §PROMOTION) :
 *   - schema_version doit être exactement '2' (une promotion V1 n'existe
 *     pas : l'appelant ne doit même pas invoquer promoteCatalog pour du V1) ;
 *   - sellable_units fourni explicitement vide = intention SKU sans rien
 *     d'exploitable → rejeté ; absent/null = produit V1 sans SKU, valide ;
 *   - purchase_price, quand présent, doit être un nombre strictement positif
 *     (les contraintes de type ont déjà été vérifiées à l'ingestion, mais la
 *     promotion revalide explicitement par prudence contre un snapshot
 *     corrompu ou modifié hors pipeline) ;
 *   - stock_available, quand présent, doit être un entier >= 0.
 *
 * @param {object} contract normalized_source_contract snapshot
 * @throws {Error} status 422 si invalide, message listant toutes les erreurs
 */
function validateForPromotion(contract) {
  const errors = [];

  if (String(contract.schema_version) !== '2') {
    errors.push(`schema_version doit être "2" pour la promotion (reçu: ${JSON.stringify(contract.schema_version)})`);
  }

  errors.push(...validateRichStructureV2(contract));

  if (Array.isArray(contract.sellable_units) && contract.sellable_units.length === 0) {
    errors.push('sellable_units fourni vide — aucune sellable_unit exploitable');
  }

  for (let i = 0; i < (contract.sellable_units || []).length; i++) {
    const unit = contract.sellable_units[i];
    if (unit.purchase_price !== undefined && unit.purchase_price !== null) {
      if (typeof unit.purchase_price !== 'number' || !(unit.purchase_price > 0)) {
        errors.push(`sellable_units[${i}].purchase_price doit être un nombre positif`);
      }
    }
    if (unit.stock_available !== undefined && unit.stock_available !== null) {
      if (typeof unit.stock_available !== 'number' || !Number.isInteger(unit.stock_available) || unit.stock_available < 0) {
        errors.push(`sellable_units[${i}].stock_available doit être un entier >= 0`);
      }
    }
  }

  if (errors.length > 0) {
    const e = new Error(`normalized_source_contract invalide pour promotion : ${errors.join(' ; ')}`);
    e.status = 422;
    throw e;
  }
}

/**
 * Upsert idempotent de contract.media[] vers catalog_media.
 *
 * Identité stable : (product_id, source_media_id) quand connu — une
 * re-promotion met à jour LA MÊME ligne. Un média sans source_media_id
 * (source pauvre) est simplement inséré à chaque appel : aucune contrainte
 * d'unicité ne s'applique (index partiel), duplication honnête documentée
 * en migration 106, pas un bug de ce module.
 *
 * @returns {Promise<Map<string, string>>} source_media_id -> media_id (les
 *   médias sans source_media_id ne peuvent pas être référencés par
 *   media_refs et n'apparaissent donc pas dans cette map).
 */
async function promoteMedia(client, productId, media) {
  const mediaBySourceId = new Map();

  for (const m of media || []) {
    const { rows } = await client.query(
      `INSERT INTO catalog_media (product_id, source_media_id, url, role, alt, option_values, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (product_id, source_media_id) WHERE source_media_id IS NOT NULL
       DO UPDATE SET
         url = EXCLUDED.url,
         role = EXCLUDED.role,
         alt = EXCLUDED.alt,
         option_values = EXCLUDED.option_values,
         display_order = EXCLUDED.display_order,
         updated_at = now()
       RETURNING id, source_media_id`,
      [
        productId,
        m.supplier_media_id || null,
        m.url,
        m.role || 'PRODUCT',
        m.alt || null,
        m.option_values ? JSON.stringify(m.option_values) : null,
        m.display_order ?? null,
      ]
    );
    const row = rows[0];
    if (row.source_media_id) {
      mediaBySourceId.set(row.source_media_id, row.id);
    }
  }

  return mediaBySourceId;
}

/**
 * Upsert idempotent des lignes descriptives d'axes (Lot 3) vers
 * product_variants. S'appuie sur la contrainte UNIQUE réelle
 * (product_id, variant_type, variant_value) pour l'idempotence
 * inter-appels (re-promotion) — mapOptionAxesToDescriptiveRows ne
 * dédoublonne qu'au sein d'un même appel.
 */
async function promoteAxes(client, productId, optionAxes) {
  const rows = mapOptionAxesToDescriptiveRows(optionAxes);

  for (const row of rows) {
    await client.query(
      `INSERT INTO product_variants (product_id, variant_type, variant_value, display_name, display_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (product_id, variant_type, variant_value)
       DO UPDATE SET display_name = EXCLUDED.display_name`,
      [productId, row.variant_type, row.variant_value, row.display_name, row.display_order]
    );
  }

  return rows;
}

/**
 * Exécute le plan de réconciliation SKU (Lot 4) en DB.
 *
 * Doctrine stock (PDC-8 §STOCK) : quand stockKnown est faux (source ne
 * rapporte pas stock_available pour ce SKU), on n'écrase JAMAIS un stock
 * réel existant par 0 — la colonne reste intouchée pour un update/réactivation.
 * Pour une création, il n'y a pas de valeur existante à préserver : 0 est le
 * seul état sûr (non vendable tant que le stock n'est pas positivement connu).
 *
 * Doctrine prix (PDC-8 §MAPPING V2 → CANONIQUE §SKU) : price_kmf n'est
 * jamais fixé par ce plan, ni en création ni en mise à jour.
 *
 * @returns {Promise<Map<string, string>>} supplier_sku -> sku_id (product_skus.id)
 */
async function promoteSkus(client, productId, sellableUnits) {
  const { rows: existingSkus } = await client.query(
    `SELECT id, supplier_sku, source, variant_combo, stock, is_active
       FROM product_skus
      WHERE product_id = $1`,
    [productId]
  );

  const plan = planSkuReconciliation(existingSkus, sellableUnits || []);
  const skuIdBySupplierSku = new Map();

  for (const item of plan.toCreate) {
    const { rows } = await client.query(
      `INSERT INTO product_skus (product_id, supplier_sku, source, variant_combo, stock, is_active)
       VALUES ($1, $2, 'SUPPLIER', $3, $4, true)
       RETURNING id, supplier_sku`,
      [productId, item.supplier_sku, item.variant_combo ? JSON.stringify(item.variant_combo) : null, item.stock]
    );
    skuIdBySupplierSku.set(rows[0].supplier_sku, rows[0].id);
  }

  for (const item of plan.toUpdate) {
    await client.query(
      `UPDATE product_skus
          SET variant_combo = $1,
              stock = CASE WHEN $2::boolean THEN $3 ELSE stock END,
              updated_at = now()
        WHERE id = $4`,
      [item.variant_combo ? JSON.stringify(item.variant_combo) : null, item.stockKnown, item.stock, item.id]
    );
    skuIdBySupplierSku.set(item.supplier_sku, item.id);
  }

  for (const item of plan.toReactivate) {
    await client.query(
      `UPDATE product_skus
          SET is_active = true,
              variant_combo = $1,
              stock = CASE WHEN $2::boolean THEN $3 ELSE stock END,
              updated_at = now()
        WHERE id = $4`,
      [item.variant_combo ? JSON.stringify(item.variant_combo) : null, item.stockKnown, item.stock, item.id]
    );
    skuIdBySupplierSku.set(item.supplier_sku, item.id);
  }

  for (const item of plan.toDeactivate) {
    await client.query(
      `UPDATE product_skus SET is_active = false, updated_at = now() WHERE id = $1`,
      [item.id]
    );
  }

  return skuIdBySupplierSku;
}

/**
 * Exécute le plan de couture SKU ↔ Media (Lot 5) en DB. Idempotent via la
 * contrainte UNIQUE (sku_id, media_id) — ON CONFLICT DO NOTHING.
 */
async function promoteSkuMedia(client, sellableUnits, skuIdBySupplierSku, mediaBySourceId) {
  const sellableUnitsResolved = (sellableUnits || [])
    .filter((u) => skuIdBySupplierSku.has(u.supplier_sku))
    .map((u) => ({ sku_id: skuIdBySupplierSku.get(u.supplier_sku), media_refs: u.media_refs }));

  const links = resolveSkuMediaLinks(sellableUnitsResolved, mediaBySourceId);

  for (const link of links) {
    await client.query(
      `INSERT INTO product_sku_media (sku_id, media_id)
       VALUES ($1, $2)
       ON CONFLICT (sku_id, media_id) DO NOTHING`,
      [link.sku_id, link.media_id]
    );
  }

  return links;
}

/**
 * Point d'entrée Lot 6. Promeut un normalized_source_contract V2 validé
 * vers le catalogue canonique (catalog_media, product_variants,
 * product_skus, product_sku_media), dans la transaction déjà ouverte par
 * l'appelant sur `client`.
 *
 * @param {import('pg').PoolClient} client client déjà en transaction (BEGIN
 *   exécuté par l'appelant)
 * @param {{ productId: string, normalizedSourceContract: object|null }} params
 * @returns {Promise<{ promoted: boolean, reason?: string, media?: number, variants?: number, skus?: object, skuMediaLinks?: number }>}
 */
async function promoteCatalog(client, { productId, normalizedSourceContract }) {
  if (!productId) {
    const e = new Error('productId requis'); e.status = 422; throw e;
  }

  if (!normalizedSourceContract) {
    // Produit V1 legacy — aucune structure riche à promouvoir. Pas une erreur.
    return { promoted: false, reason: 'v1_legacy' };
  }

  validateForPromotion(normalizedSourceContract);

  const mediaBySourceId = await promoteMedia(client, productId, normalizedSourceContract.media);
  const variantRows = await promoteAxes(client, productId, normalizedSourceContract.option_axes);
  const skuIdBySupplierSku = await promoteSkus(client, productId, normalizedSourceContract.sellable_units);
  const skuMediaLinks = await promoteSkuMedia(
    client,
    normalizedSourceContract.sellable_units,
    skuIdBySupplierSku,
    mediaBySourceId
  );

  return {
    promoted: true,
    media: mediaBySourceId.size,
    variants: variantRows.length,
    skus: { count: skuIdBySupplierSku.size },
    skuMediaLinks: skuMediaLinks.length,
  };
}

module.exports = {
  validateForPromotion,
  promoteCatalog,
};
