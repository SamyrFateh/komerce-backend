/**
 * @komerce-arch
 * @role          catalog-promotion-orchestrator
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        product_id, normalized_source_contract (V2 validé)
 * @outputs       catalog_media_rows, product_variants_rows, product_skus_rows, product_sku_media_rows, product_content_profile_row, product_content_sections_rows, product_attributes_rows
 * @depends       services/catalog-promotion/axes.js, services/catalog-promotion/sku.js, services/catalog-promotion/sku-media.js, services/catalog-promotion/content.js, services/suppliers/normalized-product.js, services/suppliers/supplier-order-identity.js
 * @used-by       routes/sourcing-scanner.js (POST /candidates/:id/import-product)
 * @db-read       product_skus
 * @db-write      catalog_media, product_attributes, product_content_profile, product_content_sections, product_sku_media, product_skus, product_variants
 * @db-txn        caller_owned
 * @doctrine      PDC-8 (tous lots), DOCTRINE_INGESTION_CATALOGUE.md, docs/doctrine/DOCTRINE_CATALOGUE.md §5, docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md
 * @impact-areas  catalog,purchasing
 * @version       2026-09 — Supplier Order Identity auto-suffisante pour refresh
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
const { blockedSupplierIdentity } = require('./suppliers/supplier-order-identity');

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
  try { mapContentToProfileRow(contract); } catch (e) { errors.push(e.message); }
  try { mapContentToSectionRows(contract); } catch (e) { errors.push(e.message); }
  try { mapContentToAttributeRows(contract); } catch (e) { errors.push(e.message); }
  if (errors.length > 0) {
    const e = new Error(`normalized_source_contract invalide pour promotion : ${errors.join(' ; ')}`);
    e.status = 422;
    throw e;
  }
}

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
      [productId, m.supplier_media_id || null, m.url, m.role || 'PRODUCT', m.alt || null,
        m.option_values ? JSON.stringify(m.option_values) : null, m.display_order ?? null]
    );
    const row = rows[0];
    if (row.source_media_id) mediaBySourceId.set(row.source_media_id, row.id);
  }
  return mediaBySourceId;
}

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

function hasIncomingSupplierOrderIdentity(sellableUnits) {
  return (sellableUnits || []).some((unit) => (
    (unit?.supplier_unit_ref !== undefined && unit?.supplier_unit_ref !== null)
    || (unit?.supplier_order_identity !== undefined && unit?.supplier_order_identity !== null)
  ));
}

function normalizeSupplierProductRef(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw blockedSupplierIdentity('supplier_product_id fournisseur invalide pendant la promotion');
  }
  return value.trim();
}

async function persistSupplierProductRef(client, productId, supplierProductRefRaw) {
  const supplierProductRef = normalizeSupplierProductRef(supplierProductRefRaw);
  if (!supplierProductRef) return { applied: false, reason: 'missing_in_contract' };
  const { rows } = await client.query(
    `SELECT id, supplier_product_ref
       FROM product_skus
      WHERE product_id = $1
        AND source = 'SUPPLIER'`,
    [productId]
  );
  const divergent = rows.filter((row) => (
    row.supplier_product_ref != null
    && String(row.supplier_product_ref).trim() !== supplierProductRef
  ));
  if (divergent.length > 0) {
    throw blockedSupplierIdentity(
      `supplier_product_ref divergent pour le produit ${productId}`,
      {
        product_id: productId,
        incoming_supplier_product_ref: supplierProductRef,
        persisted_supplier_product_refs: [...new Set(divergent.map((row) => String(row.supplier_product_ref).trim()))],
      }
    );
  }
  const { rowCount } = await client.query(
    `UPDATE product_skus
        SET supplier_product_ref = $1,
            updated_at = now()
      WHERE product_id = $2
        AND source = 'SUPPLIER'
        AND supplier_product_ref IS NULL`,
    [supplierProductRef, productId]
  );
  return { applied: true, supplier_product_ref: supplierProductRef, updated: rowCount };
}

async function promoteSkus(client, productId, sellableUnits) {
  const { rows: baseExistingSkus } = await client.query(
    `SELECT id, supplier_sku, source, variant_combo, stock, is_active
       FROM product_skus
      WHERE product_id = $1`,
    [productId]
  );
  let existingSkus = baseExistingSkus;
  const identityAwareReplay = hasIncomingSupplierOrderIdentity(sellableUnits);
  if (identityAwareReplay && existingSkus.length > 0) {
    const { rows: identityRows } = await client.query(
      `SELECT id, supplier_unit_ref, supplier_order_identity
         FROM product_skus
        WHERE product_id = $1`,
      [productId]
    );
    const identityById = new Map(identityRows.map((row) => [row.id, row]));
    existingSkus = existingSkus.map((row) => ({ ...row, ...(identityById.get(row.id) || {}) }));
  }
  const plan = planSkuReconciliation(existingSkus, sellableUnits || []);
  const skuIdBySupplierSku = new Map();
  for (const item of plan.toCreate) {
    let rows;
    if (item.supplier_unit_ref || item.supplier_order_identity) {
      ({ rows } = await client.query(
        `INSERT INTO product_skus (
           product_id, supplier_sku, source, supplier_unit_ref,
           supplier_order_identity, variant_combo, stock, is_active
         )
         VALUES ($1, $2, 'SUPPLIER', $3, $4::jsonb, $5, $6, true)
         RETURNING id, supplier_sku`,
        [productId, item.supplier_sku, item.supplier_unit_ref || null,
          item.supplier_order_identity ? JSON.stringify(item.supplier_order_identity) : null,
          item.variant_combo ? JSON.stringify(item.variant_combo) : null, item.stock]
      ));
    } else {
      ({ rows } = await client.query(
        `INSERT INTO product_skus (product_id, supplier_sku, source, variant_combo, stock, is_active)
         VALUES ($1, $2, 'SUPPLIER', $3, $4, true)
         RETURNING id, supplier_sku`,
        [productId, item.supplier_sku, item.variant_combo ? JSON.stringify(item.variant_combo) : null, item.stock]
      ));
    }
    skuIdBySupplierSku.set(rows[0].supplier_sku, rows[0].id);
  }
  for (const item of plan.toUpdate) {
    if (item.supplier_unit_ref || item.supplier_order_identity) {
      await client.query(
        `UPDATE product_skus
            SET supplier_unit_ref = $1,
                supplier_order_identity = $2::jsonb,
                variant_combo = $3,
                stock = CASE WHEN $4::boolean THEN $5 ELSE stock END,
                updated_at = now()
          WHERE id = $6`,
        [item.supplier_unit_ref || null,
          item.supplier_order_identity ? JSON.stringify(item.supplier_order_identity) : null,
          item.variant_combo ? JSON.stringify(item.variant_combo) : null, item.stockKnown, item.stock, item.id]
      );
    } else {
      await client.query(
        `UPDATE product_skus
            SET variant_combo = $1,
                stock = CASE WHEN $2::boolean THEN $3 ELSE stock END,
                updated_at = now()
          WHERE id = $4`,
        [item.variant_combo ? JSON.stringify(item.variant_combo) : null, item.stockKnown, item.stock, item.id]
      );
    }
    skuIdBySupplierSku.set(item.supplier_sku, item.id);
  }
  for (const item of plan.toReactivate) {
    if (item.supplier_unit_ref || item.supplier_order_identity) {
      await client.query(
        `UPDATE product_skus
            SET is_active = true,
                supplier_unit_ref = $1,
                supplier_order_identity = $2::jsonb,
                variant_combo = $3,
                stock = CASE WHEN $4::boolean THEN $5 ELSE stock END,
                updated_at = now()
          WHERE id = $6`,
        [item.supplier_unit_ref || null,
          item.supplier_order_identity ? JSON.stringify(item.supplier_order_identity) : null,
          item.variant_combo ? JSON.stringify(item.variant_combo) : null, item.stockKnown, item.stock, item.id]
      );
    } else {
      await client.query(
        `UPDATE product_skus
            SET is_active = true,
                variant_combo = $1,
                stock = CASE WHEN $2::boolean THEN $3 ELSE stock END,
                updated_at = now()
          WHERE id = $4`,
        [item.variant_combo ? JSON.stringify(item.variant_combo) : null, item.stockKnown, item.stock, item.id]
      );
    }
    skuIdBySupplierSku.set(item.supplier_sku, item.id);
  }
  for (const item of plan.toDeactivate) {
    await client.query(`UPDATE product_skus SET is_active = false, updated_at = now() WHERE id = $1`, [item.id]);
  }
  return skuIdBySupplierSku;
}

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

async function promoteCatalog(client, { productId, normalizedSourceContract }) {
  if (!productId) {
    const e = new Error('productId requis'); e.status = 422; throw e;
  }
  if (!normalizedSourceContract) return { promoted: false, reason: 'v1_legacy' };
  validateForPromotion(normalizedSourceContract);
  const mediaBySourceId = await promoteMedia(client, productId, normalizedSourceContract.media);
  const variantRows = await promoteAxes(client, productId, normalizedSourceContract.option_axes);
  const skuIdBySupplierSku = await promoteSkus(client, productId, normalizedSourceContract.sellable_units);
  await persistSupplierProductRef(client, productId, normalizedSourceContract.supplier_product_id);
  const skuMediaLinks = await promoteSkuMedia(client, normalizedSourceContract.sellable_units, skuIdBySupplierSku, mediaBySourceId);
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
  _persistSupplierProductRef: persistSupplierProductRef,
  _promoteContentProfile: promoteContentProfile,
  _promoteContentSections: promoteContentSections,
  _promoteContentAttributes: promoteContentAttributes,
};
