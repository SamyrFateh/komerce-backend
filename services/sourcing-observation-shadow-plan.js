/**
 * @komerce-arch
 * @role          sourcing-observation-shadow-plan
 * @domain        sourcing
 * @layer         service
 * @criticality   medium
 * @inputs        normalized_supplier_product_v2_batch, capture_context
 * @outputs       immutable_observation_plan, observed_capabilities
 * @depends       node:crypto
 * @used-by       services/sourcing-observation-shadow-service.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SOURCE_SHADOW_INGESTION.md
 * @impact-areas  sourcing, supplier-import
 * @version       2026-09
 */
'use strict';

const crypto = require('crypto');

const clone = (v) => JSON.parse(JSON.stringify(v ?? {}));
const isV2 = (p) => String(p?.schema_version || '') === '2';

function hasCommercialFacts(c) {
  return c.purchase_price != null || c.stock_available != null || c.min_order_qty != null ||
    c.supplier_delay_days != null || (Array.isArray(c.sellable_units) && c.sellable_units.length > 0);
}

function pick(object, keys) {
  return Object.fromEntries(keys.filter((k) => object[k] !== undefined).map((k) => [k, object[k]]));
}

function buildObservationPlan(products, { captureId, observedAt }) {
  const rows = [];
  let productCount = 0;
  let offerCount = 0;
  let unitCount = 0;
  for (const product of products || []) {
    if (!isV2(product)) continue;
    const { raw_payload: rawPayload, ...contract } = product;
    const productId = crypto.randomUUID();
    rows.push({ id: productId, captureId, grain: 'product', sourceRef: contract.supplier_product_id || null,
      parentId: null, observedAt,
      normalized: pick(contract, ['schema_version','supplier_name','supplier_product_id','product_name','supplier_category','product_url','description','weight_kg','source_locale','dimensions','media','option_axes','brand','highlights','specifications','sections','materials','care','warnings']),
      raw: clone(rawPayload) });
    productCount++;
    let offerId = null;
    if (hasCommercialFacts(contract)) {
      offerId = crypto.randomUUID();
      const offer = pick(contract, ['purchase_price','currency','stock_available','min_order_qty','supplier_delay_days']);
      rows.push({ id: offerId, captureId, grain: 'offer', sourceRef: null, parentId: productId, observedAt, normalized: offer, raw: clone(offer) });
      offerCount++;
    }
    for (const unit of contract.sellable_units || []) {
      rows.push({ id: crypto.randomUUID(), captureId, grain: 'unit', sourceRef: unit.supplier_unit_ref || unit.supplier_sku || null,
        parentId: offerId || productId, observedAt, normalized: clone(unit), raw: clone(unit) });
      unitCount++;
    }
  }
  return { rows, productCount, offerCount, unitCount };
}

function observedProvides(plan) {
  const layers = ['catalog'];
  if (plan.offerCount) layers.push('offers');
  if (plan.unitCount) layers.push('units');
  return layers;
}

module.exports = { isV2, buildObservationPlan, observedProvides, _hasCommercialFacts: hasCommercialFacts };
