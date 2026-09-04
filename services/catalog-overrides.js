/**
 * @komerce-arch
 * @role          catalog-field-overrides
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        product_id, field_name, field_value, reason, admin_user
 * @outputs       override_row, applied_product_row
 * @depends       db.js, services/catalog-enrichment.js
 * @used-by       services/product-admin-service.js, services/catalog-approval.js
 * @db-read       catalog_field_overrides, products
 * @db-write      catalog_field_overrides, products
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md
 * @impact-areas  catalog, admin-dashboard
 * @version       2026-09
 */

'use strict';

/**
 * KOMERCE — Overrides tracés, module partagé.
 *
 * La vérité fournisseur reste dans name_source / description_source /
 * source_locale. Les corrections client sont des overrides rejouables.
 * Lorsqu'une source étrangère connector_raw reçoit une préparation humaine
 * complète (titre + description si la source en porte une), la présentation
 * client devient `content_source='manual'` : la source ne change pas, mais le
 * garde de publication sait que le contenu affiché n'est plus la donnée brute.
 */

const OVERRIDABLE_FIELDS = ['name', 'description', 'category', 'fragility', 'emoji'];

function isFrenchLocale(locale) {
  const value = String(locale || '').trim().toLowerCase().replace('_', '-');
  return value === 'fr' || value.startsWith('fr-');
}

/**
 * Les fiches pipeline restent sous régime override, y compris après une
 * préparation humaine. Le legacy `manual` sans lignage source reste éditable
 * comme auparavant.
 */
function isPipelineSourced(product) {
  if (!product) return false;
  if (product.content_source === 'connector_raw' || product.content_source === 'ai_enriched') return true;
  if (product.content_source === 'manual' && (product.name_source || product.description_source)) return true;
  return false;
}

function manualPreparationComplete(product, overridden) {
  if (!product || product.content_source !== 'connector_raw' || isFrenchLocale(product.source_locale)) return false;
  if (!overridden.includes('name')) return false;
  const sourceHasDescription = Boolean(String(product.description_source || '').trim());
  return !sourceHasDescription || overridden.includes('description');
}

async function upsertOverride(q, { productId, fieldName, fieldValue, reason = null, setBy = null }) {
  if (!OVERRIDABLE_FIELDS.includes(fieldName)) {
    const err = new Error(`Champ non retouchable par override: "${fieldName}"`);
    err.code = 'OVERRIDE_FIELD_NOT_ALLOWED';
    throw err;
  }

  const { rows: [override] } = await q.query(
    `INSERT INTO catalog_field_overrides (product_id, field_name, field_value, reason, set_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (product_id, field_name)
     DO UPDATE SET field_value = EXCLUDED.field_value,
                    reason      = EXCLUDED.reason,
                    set_by      = EXCLUDED.set_by,
                    updated_at  = NOW()
     RETURNING *`,
    [productId, fieldName, String(fieldValue), reason, setBy]
  );

  const safeColumn = OVERRIDABLE_FIELDS.find((f) => f === fieldName);
  const { rows: [product] } = await q.query(
    `UPDATE products SET ${safeColumn} = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [fieldValue, productId]
  );

  return { override, product };
}

async function upsertOverrides(q, productId, fields, { reason = null, setBy = null } = {}) {
  const entries = Object.entries(fields || {});
  const unknown = entries.map(([f]) => f).filter((f) => !OVERRIDABLE_FIELDS.includes(f));
  if (unknown.length) {
    const err = new Error(`Champs non retouchables par override: ${unknown.join(', ')}`);
    err.code = 'OVERRIDE_FIELD_NOT_ALLOWED';
    throw err;
  }

  let product = null;
  const overridden = [];
  for (const [fieldName, fieldValue] of entries) {
    const result = await upsertOverride(q, { productId, fieldName, fieldValue, reason, setBy });
    product = result.product;
    overridden.push(fieldName);
  }

  if (manualPreparationComplete(product, overridden)) {
    const { rows: [prepared] } = await q.query(
      `UPDATE products
          SET content_source='manual',
              enrichment_version=NULL,
              enrichment_confidence=NULL,
              needs_review=FALSE,
              updated_at=NOW()
        WHERE id=$1
        RETURNING *`,
      [productId]
    );
    product = prepared;
  }

  return { overridden, product };
}

module.exports = {
  OVERRIDABLE_FIELDS,
  isPipelineSourced,
  upsertOverride,
  upsertOverrides,
  _isFrenchLocale: isFrenchLocale,
  _manualPreparationComplete: manualPreparationComplete,
};
