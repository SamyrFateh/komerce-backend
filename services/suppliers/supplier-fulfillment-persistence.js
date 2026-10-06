/**
 * @komerce-arch
 * @role          supplier-fulfillment-persistence
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        supplier execution order + exact supplier unit + canonical FULFILLMENT reconciliation result
 * @outputs       durable idempotent supplier_execution_fulfillments fact
 * @depends       services/suppliers/supplier-reconciliation-contract.js
 * @used-by       services/suppliers/supplier-fulfillment-runtime.js
 * @db-read       supplier_execution_orders, supplier_execution_fulfillments
 * @db-write      supplier_execution_fulfillments, supplier_execution_events
 * @db-txn        caller_owned_transaction
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_FULFILLMENT_FACT.md
 * @impact-areas  purchasing, supplier-integration, reconciliation
 */
'use strict';

const { SCOPE, validateResult } = require('./supplier-reconciliation-contract');

function text(value) {
  const v = String(value || '').trim();
  return v || null;
}

function bounded(value, max = 300) {
  const v = text(value);
  return v ? v.slice(0, max) : null;
}

function positiveInt(value, code) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(code);
  return n;
}

function observedInt(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function canonicalStatus(verdict) {
  return String(verdict || '').trim().toLowerCase();
}

function buildExecutionKey({ supplierExecutionOrderId, supplierUnitRef } = {}) {
  const orderId = text(supplierExecutionOrderId);
  const unit = text(supplierUnitRef);
  if (!orderId) throw new Error('SUPPLIER_EXECUTION_ORDER_ID_REQUIRED');
  if (!unit) throw new Error('SUPPLIER_FULFILLMENT_UNIT_REF_REQUIRED');
  return `fulfillment:${orderId}:${unit}`;
}

function boundedFacts(result, supplierUnitRef) {
  const observed = result?.observed || {};
  const evidence = result?.evidence || {};
  return {
    supplier_unit_ref: text(supplierUnitRef),
    external_ref: text(result?.external_ref),
    reason: bounded(result?.reason, 200),
    provider_sub_status: bounded(observed.provider_sub_status, 100),
    request_id: bounded(evidence.request_id, 200),
    cj_order_code: bounded(evidence.cj_order_code, 200),
    shipment_order_id: bounded(evidence.shipment_order_id, 200),
    child_order_count: Number.isSafeInteger(Number(evidence.child_order_count))
      ? Number(evidence.child_order_count)
      : null,
    order_status: bounded(evidence.order_status, 100),
    sandbox: evidence.sandbox === true,
  };
}

async function persistSupplierFulfillment(client, {
  supplierExecutionOrderId,
  supplierUnitRef,
  reconciliationResult,
  fulfillmentExecutionKey = null,
} = {}) {
  if (!client || typeof client.query !== 'function') {
    throw new Error('SUPPLIER_FULFILLMENT_DB_CLIENT_REQUIRED');
  }

  const checked = validateResult(reconciliationResult);
  if (!checked.ok) throw new Error(checked.reason);
  if (reconciliationResult.scope !== SCOPE.FULFILLMENT) {
    throw new Error('SUPPLIER_FULFILLMENT_SCOPE_REQUIRED');
  }

  const executionOrderId = text(supplierExecutionOrderId);
  const unitRef = text(supplierUnitRef);
  if (!executionOrderId) throw new Error('SUPPLIER_EXECUTION_ORDER_ID_REQUIRED');
  if (!unitRef) throw new Error('SUPPLIER_FULFILLMENT_UNIT_REF_REQUIRED');

  const expectedQuantity = positiveInt(
    reconciliationResult.expected?.quantity,
    'SUPPLIER_FULFILLMENT_EXPECTED_QUANTITY_INVALID'
  );
  const provider = checked.provider;
  const key = text(fulfillmentExecutionKey) || buildExecutionKey({
    supplierExecutionOrderId: executionOrderId,
    supplierUnitRef: unitRef,
  });

  const { rows: orderRows } = await client.query(`
    SELECT id, purchase_order_id, provider, supplier_order_id
      FROM supplier_execution_orders
     WHERE id = $1
     FOR SHARE
  `, [executionOrderId]);
  const executionOrder = orderRows[0];
  if (!executionOrder) throw new Error('SUPPLIER_EXECUTION_ORDER_NOT_FOUND');
  if (String(executionOrder.provider).toLowerCase() !== provider) {
    throw new Error('SUPPLIER_FULFILLMENT_PROVIDER_MISMATCH');
  }

  const externalRef = text(reconciliationResult.external_ref);
  if (externalRef && externalRef !== String(executionOrder.supplier_order_id)) {
    throw new Error('SUPPLIER_FULFILLMENT_EXTERNAL_REF_MISMATCH');
  }

  const observed = reconciliationResult.observed || {};
  const evidence = reconciliationResult.evidence || {};
  const evidenceSource = bounded(evidence.proof_source, 100);
  const evidenceRef = bounded(evidence.proof_ref, 300);
  const facts = boundedFacts(reconciliationResult, unitRef);

  let existing = null;
  const { rows: keyRows } = await client.query(`
    SELECT *
      FROM supplier_execution_fulfillments
     WHERE provider = $1 AND fulfillment_execution_key = $2
     FOR UPDATE
  `, [provider, key]);
  existing = keyRows[0] || null;

  if (!existing && evidenceSource && evidenceRef) {
    const { rows: evidenceRows } = await client.query(`
      SELECT *
        FROM supplier_execution_fulfillments
       WHERE provider = $1
         AND evidence_source = $2
         AND evidence_ref = $3
       FOR UPDATE
    `, [provider, evidenceSource, evidenceRef]);
    existing = evidenceRows[0] || null;
  }

  if (existing) {
    if (String(existing.supplier_execution_order_id) !== executionOrderId) {
      throw new Error('SUPPLIER_FULFILLMENT_REBIND_REFUSED');
    }
    if (String(existing.fulfillment_execution_key) !== key) {
      throw new Error('SUPPLIER_FULFILLMENT_EVIDENCE_REBIND_REFUSED');
    }
    if (Number(existing.expected_quantity) !== expectedQuantity) {
      throw new Error('SUPPLIER_FULFILLMENT_EXPECTED_QUANTITY_REBIND_REFUSED');
    }
    if (text(existing.facts?.supplier_unit_ref) !== unitRef) {
      throw new Error('SUPPLIER_FULFILLMENT_UNIT_REBIND_REFUSED');
    }

    const { rows } = await client.query(`
      UPDATE supplier_execution_fulfillments
         SET observed_quantity = $1,
             provider_status = $2,
             carrier = $3,
             tracking_number = $4,
             tracking_url = $5,
             shipped_at = $6,
             delivered_at = $7,
             reconciliation_status = $8,
             evidence_source = $9,
             evidence_ref = $10,
             facts = $11::jsonb,
             updated_at = NOW()
       WHERE id = $12
       RETURNING *
    `, [
      observedInt(observed.quantity),
      bounded(observed.provider_status, 100),
      bounded(observed.carrier, 200),
      bounded(observed.tracking_number, 300),
      bounded(observed.tracking_url, 1000),
      observed.shipped_at || null,
      observed.delivered_at || null,
      canonicalStatus(reconciliationResult.verdict),
      evidenceSource,
      evidenceRef,
      JSON.stringify(facts),
      existing.id,
    ]);
    existing = rows[0];
  } else {
    const { rows } = await client.query(`
      INSERT INTO supplier_execution_fulfillments
        (supplier_execution_order_id, provider, fulfillment_execution_key,
         expected_quantity, observed_quantity, provider_status, carrier,
         tracking_number, tracking_url, shipped_at, delivered_at,
         reconciliation_status, evidence_source, evidence_ref, facts)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
      RETURNING *
    `, [
      executionOrderId,
      provider,
      key,
      expectedQuantity,
      observedInt(observed.quantity),
      bounded(observed.provider_status, 100),
      bounded(observed.carrier, 200),
      bounded(observed.tracking_number, 300),
      bounded(observed.tracking_url, 1000),
      observed.shipped_at || null,
      observed.delivered_at || null,
      canonicalStatus(reconciliationResult.verdict),
      evidenceSource,
      evidenceRef,
      JSON.stringify(facts),
    ]);
    existing = rows[0];
  }

  await client.query(`
    INSERT INTO supplier_execution_events
      (purchase_order_id, provider, supplier_execution_order_id,
       operation, outcome, facts)
    VALUES ($1,$2,$3,'reconcile_fulfillment','observed',$4::jsonb)
  `, [
    executionOrder.purchase_order_id,
    provider,
    executionOrderId,
    JSON.stringify({
      fulfillment_execution_key: key,
      supplier_unit_ref: unitRef,
      reconciliation_status: canonicalStatus(reconciliationResult.verdict),
      ...(evidenceSource ? { evidence_source: evidenceSource } : {}),
      ...(evidenceRef ? { evidence_ref: evidenceRef } : {}),
    }),
  ]);

  return existing;
}

module.exports = {
  buildExecutionKey,
  persistSupplierFulfillment,
};
