/**
 * @komerce-arch
 * @role          catalog-promotion-orchestrator
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        product_id, normalized_source_contract (V2 validé)
 * @outputs       catalog_media_rows, product_variants_rows, product_skus_rows, product_sku_media_rows, product_content_profile_row, product_content_sections_rows, product_attributes_rows
 * @depends       services/catalog-promotion/axes.js, services/catalog-promotion/sku.js, services/catalog-promotion/sku-media.js, services/catalog-promotion/content.js, services/suppliers/normalized-product.js
 * @used-by       routes/sourcing-scanner.js (POST /candidates/:id/import-product)
 * @db-read       product_skus
 * @db-write      catalog_media, product_attributes, product_content_profile, product_content_sections, product_sku_media, product_skus, product_variants
 * @db-txn        caller_owned
 * @doctrine      PDC-8 (tous lots), DOCTRINE_INGESTION_CATALOGUE.md, docs/doctrine/DOCTRINE_CATALOGUE.md §5
 * @impact-areas  catalog
 * @version       2026-07 — fiche produit enrichie : promotion idempotente du contenu
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
const {
  mapContentToProfileRow,
  mapContentToSectionRows,
  mapContentToAttributeRows,
} = require('./catalog-promotion/content');
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

  // Fiche produit enrichie : projection à blanc (aucune écriture) pour faire échouer tôt une
  // incohérence de contenu (section_key dupliqué/réservé, type de section invalide, attribut
  // dupliqué) — même invariant "valider avant d'écrire" que le reste de cette fonction.
  try { mapContentToProfileRow(contract); } catch (e) { errors.push(e.message); }
  try { mapContentToSectionRows(contract); } catch (e) { errors.push(e.message); }
  try { mapContentToAttributeRows(contract); } catch (e) { errors.push(e.message); }

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
 * Upsert idempotent du profil éditorial 1:1 (Lot Content — fiche produit enrichie).
 *
 * OVERRIDE MANUEL (DOCTRINE_CATALOGUE.md §5, "le pipeline est la source, jamais la fiche") : la
 * clause `WHERE product_content_profile.source <> 'MANUAL'` fait qu'une ligne déjà retouchée à la
 * main (source='MANUAL') n'est JAMAIS écrasée par une re-promotion fournisseur — ON CONFLICT DO
 * UPDATE ne s'applique tout simplement pas, sans logique de lecture préalable en JS.
 *
 * @returns {Promise<boolean>} true si la ligne a été (créée ou) mise à jour, false si un override
 *   manuel existant a été préservé (aucune écriture appliquée).
 */
async function promoteContentProfile(client, productId, profileRow) {
  const { rows } = await client.query(
    `INSERT INTO product_content_profile (product_id, brand, short_description, source, enrichment_version, reviewed)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (product_id) DO UPDATE SET
       brand = EXCLUDED.brand,
       short_description = EXCLUDED.short_description,
       source = EXCLUDED.source,
       enrichment_version = EXCLUDED.enrichment_version,
       reviewed = EXCLUDED.reviewed,
       updated_at = now()
     WHERE product_content_profile.source <> 'MANUAL'
     RETURNING id`,
    [productId, profileRow.brand, profileRow.short_description, profileRow.source, profileRow.enrichment_version, profileRow.reviewed]
  );
  return rows.length > 0;
}

/**
 * Upsert idempotent des sections éditoriales + materials/care/warilings (section_key réservés)
 * vers product_content_sections. Même principe de préservation d'override manuel que le profil
 * (clause WHERE source <> 'MANUAL' sur le DO UPDATE).
 *
 * RÉJOUABILITÉ : une section absente de CE replay (et non MANUAL) est désactivée, jamais
 * supprimée — même doctrine que la désactivation SKU (Lot 4). Une section qui réapparaît à un
 * appel suivant est réactivée par le DO UPDATE (is_active = true), sans jamais dupliquer la ligne
 * grâce à la contrainte UNIQUE(product_id, section_key).
 *
 * @returns {Promise<{upserted: number, deactivated: number}>}
 */
async function promoteContentSections(client, productId, sectionRows) {
  for (const row of sectionRows) {
    await client.query(
      `INSERT INTO product_content_sections (product_id, section_key, title, section_type, content_json, display_order, source, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       ON CONFLICT (product_id, section_key) DO UPDATE SET
         title = EXCLUDED.title,
         section_type = EXCLUDED.section_type,
         content_json = EXCLUDED.content_json,
         display_order = EXCLUDED.display_order,
         source = EXCLUDED.source,
         is_active = true,
         updated_at = now()
       WHERE product_content_sections.source <> 'MANUAL'`,
      [productId, row.section_key, row.title, row.section_type, JSON.stringify(row.content_json), row.display_order, row.source]
    );
  }

  const keptKeys = sectionRows.map((r) => r.section_key);
  const { rowCount } = await client.query(
    `UPDATE product_content_sections
        SET is_active = false, updated_at = now()
      WHERE product_id = $1
        AND is_active = true
        AND source <> 'MANUAL'
        AND NOT (section_key = ANY($2::text[]))`,
    [productId, keptKeys]
  );

  return { upserted: sectionRows.length, deactivated: rowCount };
}

/**
 * Upsert idempotent des attributs (highlights + specifications) vers product_attributes. Même
 * doctrine d'override manuel et de réjouabilité que promoteContentSections ci-dessus, mais
 * l'identité est un triplet (kind, group_key, attribute_key) : la désactivation des lignes
 * disparues du replay s'appuie sur un anti-join via unnest() plutôt qu'une simple colonne.
 *
 * @returns {Promise<{upserted: number, deactivated: number}>}
 */
async function promoteContentAttributes(client, productId, attributeRows) {
  for (const row of attributeRows) {
    await client.query(
      `INSERT INTO product_attributes (product_id, kind, group_key, attribute_key, label, value_text, unit, display_order, source, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
       ON CONFLICT (product_id, kind, group_key, attribute_key) DO UPDATE SET
         label = EXCLUDED.label,
         value_text = EXCLUDED.value_text,
         unit = EXCLUDED.unit,
         display_order = EXCLUDED.display_order,
         source = EXCLUDED.source,
         is_active = true,
         updated_at = now()
       WHERE product_attributes.source <> 'MANUAL'`,
      [productId, row.kind, row.group_key, row.attribute_key, row.label, row.value_text, row.unit, row.display_order, row.source]
    );
  }

  const kinds = attributeRows.map((r) => r.kind);
  const groups = attributeRows.map((r) => r.group_key);
  const keys = attributeRows.map((r) => r.attribute_key);
  const { rowCount } = await client.query(
    `UPDATE product_attributes pa
        SET is_active = false, updated_at = now()
      WHERE pa.product_id = $1
        AND pa.is_active = true
        AND pa.source <> 'MANUAL'
        AND NOT EXISTS (
          SELECT 1 FROM unnest($2::text[], $3::text[], $4::text[]) AS keep(kind, group_key, attribute_key)
           WHERE keep.kind = pa.kind AND keep.group_key = pa.group_key AND keep.attribute_key = pa.attribute_key
        )`,
    [productId, kinds, groups, keys]
  );

  return { upserted: attributeRows.length, deactivated: rowCount };
}

/**
 * Orchestration Lot Content : profil + sections + attributs, dans cet ordre. Toujours appelée
 * pour un contrat V2 (même sans aucun champ éditorial) afin que la provenance ('SUPPLIER' par
 * défaut) reste tracée sur product_content_profile — un produit pauvre reste honnête, jamais
 * absent de la trace de promotion.
 *
 * @param {{source?: string, enrichmentVersion?: string|null, reviewed?: boolean}} [options]
 */
async function promoteContent(client, productId, contract, options = {}) {
  const profileRow = mapContentToProfileRow(contract, options);
  const sectionRows = mapContentToSectionRows(contract, options);
  const attributeRows = mapContentToAttributeRows(contract, options);

  const profileUpdated = await promoteContentProfile(client, productId, profileRow);
  const sections = await promoteContentSections(client, productId, sectionRows);
  const attributes = await promoteContentAttributes(client, productId, attributeRows);

  return {
    profile: profileUpdated ? 'upserted' : 'preserved_manual_override',
    sections,
    attributes,
  };
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
  const content = await promoteContent(client, productId, normalizedSourceContract, {
    source: 'SUPPLIER',
    enrichmentVersion: normalizedSourceContract._enrichmentVersion || 'promoted',
  });

  return {
    promoted: true,
    media: mediaBySourceId.size,
    variants: variantRows.length,
    skus: { count: skuIdBySupplierSku.size },
    skuMediaLinks: skuMediaLinks.length,
    content,
  };
}

module.exports = {
  validateForPromotion,
  promoteCatalog,
  _promoteContentProfile: promoteContentProfile,
  _promoteContentSections: promoteContentSections,
  _promoteContentAttributes: promoteContentAttributes,
};
