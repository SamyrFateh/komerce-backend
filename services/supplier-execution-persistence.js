/**
 * @komerce-arch
 * @role          supplier-execution-persistence
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        canonical provider execution facts + purchase_order/purchase_line ids
 * @outputs       persisted supplier_execution_* facts
 * @depends       none
 * @used-by       services/purchasing-trigger-service.js
 * @db-read       supplier_execution_orders
 * @db-write      supplier_execution_orders, supplier_execution_order_lines, supplier_execution_events
 * @db-txn        caller_owned_transaction
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_EXECUTION_PERSISTENCE.md
 * @impact-areas  purchasing, supplier-integration
 * @version       2026-10
 */
'use strict';

function text(value) {
  const v = String(value || '').trim();
  return v || null;
}

function bounded(value, max = 300) {
  const v = text(value);
  return v ? v.slice(0, max) : null;
}

async function persistSupplierOrderExecution(client, {
  purchaseOrderId,
  purchaseLineId = null,
  quantity = null,
  provider,
  supplierOrderId,
  supplierOrderCode = null,
  providerStatus = null,
  executionRecovery = null,
} = {}) {
  const poId = text(purchaseOrderId);
  const p = text(provider)?.toLowerCase();
  const orderId = text(supplierOrderId);
  if (!poId) throw new Error('PURCHASE_ORDER_ID_REQUIRED');
  if (!p) throw new Error('SUPPLIER_EXECUTION_PROVIDER_REQUIRED');
  if (!orderId) throw new Error('SUPPLIER_ORDER_ID_REQUIRED');

  const facts = {
    ...(executionRecovery ? { execution_recovery: bounded(executionRecovery, 100) } : {}),
  };

  const { rows: inserted } = await client.query(`
    INSERT INTO supplier_execution_orders
      (purchase_order_id, provider, supplier_order_id, supplier_order_code, provider_status, provider_facts)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb)
    ON CONFLICT (provider, supplier_order_id) DO NOTHING
    RETURNING id, purchase_order_id, provider, supplier_order_id
  `, [
    poId, p, orderId, text(supplierOrderCode), text(providerStatus), JSON.stringify(facts),
  ]);

  let row = inserted[0];
  if (!row) {
    const { rows } = await client.query(`
      SELECT id, purchase_order_id, provider, supplier_order_id
        FROM supplier_execution_orders
       WHERE provider = $1 AND supplier_order_id = $2
       FOR UPDATE
    `, [p, orderId]);
    row = rows[0];
    if (!row) throw new Error('SUPPLIER_EXECUTION_ORDER_NOT_FOUND_AFTER_CONFLICT');
    if (String(row.purchase_order_id) !== poId) {
      throw new Error('SUPPLIER_EXECUTION_ORDER_REBIND_REFUSED');
    }
  }

  const lineId = text(purchaseLineId);
  if (lineId) {
    const q = Number(quantity);
    if (!Number.isSafeInteger(q) || q < 1) throw new Error('SUPPLIER_EXECUTION_QUANTITY_INVALID');
    await client.query(`
      INSERT INTO supplier_execution_order_lines
        (supplier_execution_order_id, purchase_line_id, quantity)
      VALUES ($1,$2,$3)
      ON CONFLICT (supplier_execution_order_id, purchase_line_id)
      DO UPDATE SET quantity = EXCLUDED.quantity
    `, [row.id, lineId, q]);
  }

  await client.query(`
    INSERT INTO supplier_execution_events
      (purchase_order_id, provider, supplier_execution_order_id, operation, outcome, facts)
    VALUES ($1,$2,$3,'create_order','observed',$4::jsonb)
  `, [
    poId,
    p,
    row.id,
    JSON.stringify({
      supplier_order_id: orderId,
      ...(supplierOrderCode ? { supplier_order_code: bounded(supplierOrderCode, 200) } : {}),
      ...(providerStatus ? { provider_status: bounded(providerStatus, 100) } : {}),
      ...(executionRecovery ? { execution_recovery: bounded(executionRecovery, 100) } : {}),
    }),
  ]);

  return row;
}


async function recordSupplierCreateAmbiguity(executor, {
  purchaseOrderId,
  provider,
  evidence = {},
  replayBlocked = true,
} = {}) {
  const q = executor && typeof executor.query === 'function' ? executor : require('../db');
  const poId = text(purchaseOrderId);
  const p = text(provider)?.toLowerCase();
  if (!poId) throw new Error('PURCHASE_ORDER_ID_REQUIRED');
  if (!p) throw new Error('SUPPLIER_EXECUTION_PROVIDER_REQUIRED');

  const providerCode = evidence.provider_code == null ? null : bounded(evidence.provider_code, 100);
  const providerMessage = evidence.provider_message == null ? null : bounded(evidence.provider_message, 300);
  const facts = {
    replay_blocked: replayBlocked === true,
    supports_idempotent_replay: replayBlocked !== true,
    ...(evidence.error_name ? { error_name: bounded(evidence.error_name, 100) } : {}),
  };

  await q.query(`
    INSERT INTO supplier_execution_events
      (purchase_order_id, provider, operation, outcome, provider_code, provider_message, facts)
    VALUES ($1,$2,'create_order','ambiguous',$3,$4,$5::jsonb)
  `, [poId, p, providerCode, providerMessage, JSON.stringify(facts)]);
}

async function hasBlockingSupplierCreateAmbiguity(executor, {
  purchaseOrderId,
  provider,
} = {}) {
  const q = executor && typeof executor.query === 'function' ? executor : require('../db');
  const poId = text(purchaseOrderId);
  const p = text(provider)?.toLowerCase();
  if (!poId || !p) return false;
  const { rows } = await q.query(`
    SELECT outcome, facts
      FROM supplier_execution_events
     WHERE purchase_order_id = $1
       AND provider = $2
       AND operation = 'create_order'
     ORDER BY created_at DESC, id DESC
     LIMIT 1
  `, [poId, p]);
  const row = rows[0];
  if (!row || row.outcome !== 'ambiguous') return false;
  return row.facts?.replay_blocked === true;
}

module.exports = { persistSupplierOrderExecution, recordSupplierCreateAmbiguity, hasBlockingSupplierCreateAmbiguity };
