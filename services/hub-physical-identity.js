/**
 * @komerce-arch
 * @role          hub-physical-identity
 * @domain        logistics
 * @layer         service
 * @criticality   critical
 * @inputs        caller_owned_transaction_executor, purchase_order_identity, physical_unit_operation
 * @outputs       immutable_purchase_allocation, physical_unit, custody_events, transactional_outbox_event
 * @depends       services/outbox-producer.js
 * @used-by       HUB-001 internal logistics boundary
 * @db-read       purchase_orders, orders, order_items, hub_purchase_allocations, hub_physical_units, hub_physical_unit_placements
 * @db-write      hub_purchase_allocations, hub_physical_units, hub_physical_unit_placements, hub_custody_events
 * @db-write-via:outbox-producer outbox_events
 * @db-txn        caller_owned_transaction_required
 * @doctrine      HUB-001 Physical Identity, Allocation & Custody
 * @impact-areas  logistics, purchasing, market
 * @version       2026-09
 */

'use strict';

const crypto = require('crypto');
const { reportPhysicalOutcome, VALID_OUTCOME_TYPES } = require('./outbox-producer');

const UNIT_TYPES = new Set(['SUPPLIER_PACKAGE', 'HANDLING_UNIT', 'MARKET_PARCEL']);
const UNIT_STATES = new Set([
  'RECEIVED', 'IDENTIFIED', 'QUALITY_CHECKED', 'LOCATED', 'ALLOCATED',
  'PICKED', 'PACKED', 'DISPATCHED', 'QUARANTINED', 'SUPERSEDED',
]);
const CONTENT_MUTABLE_STATES = new Set([
  'RECEIVED', 'IDENTIFIED', 'QUALITY_CHECKED', 'LOCATED', 'ALLOCATED', 'PICKED',
]);
const PHYSICAL_OPERATIONS = new Set(['SPLIT', 'MERGE', 'REPACK']);

class HubPhysicalError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'HubPhysicalError';
    this.code = code;
  }
}

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('hub-physical-identity: caller-owned executor.query requis');
  }
  return executor;
}

function fail(code, message) {
  throw new HubPhysicalError(code, message);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isValidSupplierIdentity(identity) {
  return Boolean(
    identity
    && typeof identity === 'object'
    && !Array.isArray(identity)
    && typeof identity.provider === 'string'
    && identity.provider.trim()
    && Number.isInteger(Number(identity.version))
    && Number(identity.version) >= 1
    && identity.payload
    && typeof identity.payload === 'object'
    && !Array.isArray(identity.payload)
    && Object.keys(identity.payload).length > 0
  );
}

function snapshotFromRow(row) {
  if (!row || !row.purchase_order_id) {
    fail('HUB_PURCHASE_ORDER_UNRESOLVABLE', 'Purchase Order introuvable');
  }
  if (row.po_status === 'cancelled') {
    fail('HUB_PURCHASE_ORDER_CANCELLED', 'Purchase Order annulée');
  }
  if (!row.order_item_id || !row.product_sku_id || !row.supplier_id) {
    fail('HUB_PURCHASE_IDENTITY_INCOMPLETE', 'PO sans identité exacte order_item/SKU/supplier');
  }
  if (!row.item_order_id || String(row.item_order_id) !== String(row.order_id)) {
    fail('HUB_PURCHASE_ORDER_ITEM_MISMATCH', 'order_item_id ne correspond pas à la commande de la PO');
  }
  if (row.item_sku_id && String(row.item_sku_id) !== String(row.product_sku_id)) {
    fail('HUB_PURCHASE_SKU_MISMATCH', 'product_sku_id de la PO diffère du SKU vendu');
  }
  if (!row.supplier_unit_ref || !String(row.supplier_unit_ref).trim() || !isValidSupplierIdentity(row.supplier_order_identity)) {
    fail('HUB_SUPPLIER_IDENTITY_UNRESOLVABLE', 'Supplier Order Identity exacte absente ou invalide');
  }
  if (!row.market_id || !row.relais_id) {
    fail('HUB_DESTINATION_UNRESOLVABLE', 'market_id/relais_id autoritatif absent sur la commande');
  }
  const quantity = Number(row.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    fail('HUB_PURCHASE_QUANTITY_INVALID', 'Quantité PO invalide');
  }

  return {
    purchase_order_id: row.purchase_order_id,
    order_id: row.order_id,
    order_item_id: row.order_item_id,
    product_sku_id: row.product_sku_id,
    supplier_id: row.supplier_id,
    supplier_unit_ref: String(row.supplier_unit_ref),
    supplier_order_identity: row.supplier_order_identity,
    quantity,
    market_id: row.market_id,
    destination_ref: `relais:${row.relais_id}`,
  };
}

async function resolvePurchaseSnapshot(executor, purchaseOrderId) {
  const db = requireExecutor(executor);
  const { rows: [row] } = await db.query(
    `SELECT po.id AS purchase_order_id,
            po.order_id,
            po.order_item_id,
            po.product_sku_id,
            po.supplier_id,
            po.supplier_unit_ref,
            po.supplier_order_identity,
            po.qty AS quantity,
            po.status AS po_status,
            oi.order_id AS item_order_id,
            oi.sku_id AS item_sku_id,
            o.market_id,
            o.relais_id
       FROM purchase_orders po
       JOIN orders o ON o.id = po.order_id
       LEFT JOIN order_items oi ON oi.id = po.order_item_id
      WHERE po.id = $1
      FOR SHARE OF po, o`,
    [purchaseOrderId]
  );
  return snapshotFromRow(row);
}

function allocationMatches(existing, snapshot) {
  return String(existing.purchase_order_id) === String(snapshot.purchase_order_id)
    && String(existing.order_id) === String(snapshot.order_id)
    && String(existing.order_item_id) === String(snapshot.order_item_id)
    && String(existing.product_sku_id) === String(snapshot.product_sku_id)
    && String(existing.supplier_id) === String(snapshot.supplier_id)
    && String(existing.supplier_unit_ref) === String(snapshot.supplier_unit_ref)
    && Number(existing.quantity) === Number(snapshot.quantity)
    && String(existing.market_id) === String(snapshot.market_id)
    && String(existing.destination_ref) === String(snapshot.destination_ref)
    && stableJson(existing.supplier_order_identity) === stableJson(snapshot.supplier_order_identity);
}

async function persistPurchaseAllocation(executor, snapshot) {
  const db = requireExecutor(executor);
  const { rows } = await db.query(
    `INSERT INTO hub_purchase_allocations (
       purchase_order_id, order_id, order_item_id, product_sku_id, supplier_id,
       supplier_unit_ref, supplier_order_identity, quantity, market_id, destination_ref
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
     ON CONFLICT (purchase_order_id) DO NOTHING
     RETURNING *`,
    [
      snapshot.purchase_order_id,
      snapshot.order_id,
      snapshot.order_item_id,
      snapshot.product_sku_id,
      snapshot.supplier_id,
      snapshot.supplier_unit_ref,
      JSON.stringify(snapshot.supplier_order_identity),
      snapshot.quantity,
      snapshot.market_id,
      snapshot.destination_ref,
    ]
  );

  if (rows[0]) return rows[0];

  const { rows: [existing] } = await db.query(
    'SELECT * FROM hub_purchase_allocations WHERE purchase_order_id = $1 FOR SHARE',
    [snapshot.purchase_order_id]
  );
  if (!existing || !allocationMatches(existing, snapshot)) {
    fail('HUB_ALLOCATION_SNAPSHOT_DRIFT', 'Allocation existante différente de la vérité d’achat snapshotée');
  }
  return existing;
}

async function snapshotPurchaseAllocation(executor, purchaseOrderId) {
  const snapshot = await resolvePurchaseSnapshot(executor, purchaseOrderId);
  return persistPurchaseAllocation(executor, snapshot);
}

async function insertCustodyEvent(executor, {
  physicalUnitId,
  eventType,
  fromState = null,
  toState = null,
  allocationId = null,
  quantity = null,
  operationId = null,
  operationType = null,
  actorId = null,
  locationRef = null,
  details = {},
}) {
  const db = requireExecutor(executor);
  const { rows: [event] } = await db.query(
    `INSERT INTO hub_custody_events (
       physical_unit_id, event_type, from_state, to_state, allocation_id, quantity,
       operation_id, operation_type, actor_id, location_ref, details
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
     RETURNING *`,
    [
      physicalUnitId, eventType, fromState, toState, allocationId, quantity,
      operationId, operationType, actorId, locationRef, JSON.stringify(details || {}),
    ]
  );
  return event;
}

async function createPhysicalUnit(executor, {
  reference,
  unitType,
  externalRef = null,
  actorId = null,
  locationRef = null,
  initialState = 'RECEIVED',
  details = {},
}) {
  const db = requireExecutor(executor);
  if (!reference || !String(reference).trim()) fail('HUB_PHYSICAL_REFERENCE_REQUIRED');
  if (!UNIT_TYPES.has(unitType)) fail('HUB_PHYSICAL_UNIT_TYPE_INVALID');
  if (!UNIT_STATES.has(initialState)) fail('HUB_PHYSICAL_STATE_INVALID');
  if (!['RECEIVED', 'QUARANTINED'].includes(initialState)) {
    fail('HUB_PHYSICAL_INITIAL_STATE_INVALID', 'Une unité physique doit naître RECEIVED ou QUARANTINED');
  }

  const { rows: [unit] } = await db.query(
    `INSERT INTO hub_physical_units (
       reference, unit_type, state, external_ref, current_location_ref, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [String(reference).trim(), unitType, initialState, externalRef, locationRef, actorId]
  );

  await insertCustodyEvent(db, {
    physicalUnitId: unit.id,
    eventType: initialState === 'QUARANTINED' ? 'QUARANTINE' : 'STATE_TRANSITION',
    fromState: null,
    toState: initialState,
    actorId,
    locationRef,
    details: { creation: true, ...details },
  });
  return unit;
}

async function createQuarantinedInbound(executor, {
  reference,
  externalRef,
  actorId,
  locationRef,
  reasonCode,
  reason,
  contents,
}) {
  const unit = await createPhysicalUnit(executor, {
    reference,
    unitType: 'SUPPLIER_PACKAGE',
    externalRef,
    actorId,
    locationRef,
    initialState: 'QUARANTINED',
    details: {
      reason_code: reasonCode,
      reason,
      manifest: contents.map((c) => ({ purchase_order_id: c.purchase_order_id, quantity: c.quantity })),
    },
  });
  return { quarantined: true, reason_code: reasonCode, unit };
}

function normalizeInboundContents(contents) {
  if (!Array.isArray(contents) || contents.length === 0) {
    fail('HUB_INBOUND_CONTENTS_REQUIRED', 'Le colis fournisseur doit déclarer son contenu');
  }
  const grouped = new Map();
  for (const item of contents) {
    if (!item || !item.purchase_order_id) fail('HUB_PURCHASE_ORDER_REQUIRED');
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) fail('HUB_INBOUND_QUANTITY_INVALID');
    const key = String(item.purchase_order_id);
    grouped.set(key, (grouped.get(key) || 0) + quantity);
  }
  return [...grouped.entries()].map(([purchase_order_id, quantity]) => ({ purchase_order_id, quantity }));
}

async function receiveSupplierPackage(executor, {
  reference,
  externalRef = null,
  actorId = null,
  locationRef = null,
  contents,
}) {
  const db = requireExecutor(executor);
  const normalized = normalizeInboundContents(contents);

  const resolved = [];
  try {
    for (const content of normalized) {
      const snapshot = await resolvePurchaseSnapshot(db, content.purchase_order_id);
      if (content.quantity > snapshot.quantity) {
        fail('HUB_ALLOCATION_OVERRECEIVED', 'Quantité physique supérieure à la quantité achetée');
      }
      resolved.push({ content, snapshot });
    }
  } catch (error) {
    if (!(error instanceof HubPhysicalError)) throw error;
    return createQuarantinedInbound(db, {
      reference, externalRef, actorId, locationRef,
      reasonCode: error.code,
      reason: error.message,
      contents: normalized,
    });
  }

  const allocations = [];
  for (const entry of resolved) {
    const allocation = await persistPurchaseAllocation(db, entry.snapshot);
    const { rows: [placed] } = await db.query(
      `SELECT COALESCE(SUM(quantity), 0)::integer AS quantity
         FROM hub_physical_unit_placements
        WHERE allocation_id = $1 AND removed_at IS NULL`,
      [allocation.id]
    );
    if (Number(placed.quantity) + entry.content.quantity > Number(allocation.quantity)) {
      return createQuarantinedInbound(db, {
        reference, externalRef, actorId, locationRef,
        reasonCode: 'HUB_ALLOCATION_OVERRECEIVED',
        reason: 'La quantité déjà placée + reçue dépasse la quantité achetée',
        contents: normalized,
      });
    }
    allocations.push({ allocation, quantity: entry.content.quantity });
  }

  const unit = await createPhysicalUnit(db, {
    reference,
    unitType: 'SUPPLIER_PACKAGE',
    externalRef,
    actorId,
    locationRef,
    initialState: 'RECEIVED',
    details: { inbound: true },
  });
  const operationId = crypto.randomUUID();

  for (const item of allocations) {
    await db.query(
      `INSERT INTO hub_physical_unit_placements (
         physical_unit_id, allocation_id, quantity, operation_id, operation_type, created_by
       ) VALUES ($1,$2,$3,$4,'RECEIVE',$5)`,
      [unit.id, item.allocation.id, item.quantity, operationId, actorId]
    );
    await insertCustodyEvent(db, {
      physicalUnitId: unit.id,
      eventType: 'PLACEMENT_IN',
      allocationId: item.allocation.id,
      quantity: item.quantity,
      operationId,
      operationType: 'RECEIVE',
      actorId,
      locationRef,
      details: { purchase_order_id: item.allocation.purchase_order_id },
    });
  }

  return {
    quarantined: false,
    unit,
    allocations: allocations.map(({ allocation, quantity }) => ({ allocation, quantity })),
    operation_id: operationId,
  };
}

async function transitionPhysicalUnit(executor, {
  unitId,
  toState,
  actorId = null,
  locationRef = null,
  details = {},
}) {
  const db = requireExecutor(executor);
  if (!UNIT_STATES.has(toState)) fail('HUB_PHYSICAL_STATE_INVALID');

  const { rows: [before] } = await db.query(
    'SELECT * FROM hub_physical_units WHERE id = $1 FOR UPDATE',
    [unitId]
  );
  if (!before) fail('HUB_PHYSICAL_UNIT_NOT_FOUND');
  if (before.state === toState) return { noop: true, unit: before };

  const { rows: [unit] } = await db.query(
    `UPDATE hub_physical_units
        SET state = $2,
            current_location_ref = COALESCE($3, current_location_ref),
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [unitId, toState, locationRef]
  );

  await insertCustodyEvent(db, {
    physicalUnitId: unit.id,
    eventType: toState === 'QUARANTINED' ? 'QUARANTINE' : 'STATE_TRANSITION',
    fromState: before.state,
    toState,
    actorId,
    locationRef: locationRef || unit.current_location_ref,
    details,
  });
  return { noop: false, unit };
}

async function lockUnits(executor, unitIds) {
  const db = requireExecutor(executor);
  const ordered = [...new Set(unitIds.map(String))].sort();
  const { rows } = await db.query(
    `SELECT * FROM hub_physical_units
      WHERE id = ANY($1::uuid[])
      ORDER BY id
      FOR UPDATE`,
    [ordered]
  );
  if (rows.length !== ordered.length) fail('HUB_PHYSICAL_UNIT_NOT_FOUND');
  return new Map(rows.map((row) => [String(row.id), row]));
}

async function moveAllocationQuantity(executor, {
  fromUnitId,
  toUnitId,
  allocationId,
  quantity,
  operationType,
  actorId = null,
  locationRef = null,
}) {
  const db = requireExecutor(executor);
  if (!fromUnitId || !toUnitId || String(fromUnitId) === String(toUnitId)) {
    fail('HUB_PHYSICAL_MOVE_UNITS_INVALID');
  }
  if (!PHYSICAL_OPERATIONS.has(operationType)) fail('HUB_PHYSICAL_OPERATION_INVALID');
  const moveQty = Number(quantity);
  if (!Number.isInteger(moveQty) || moveQty <= 0) fail('HUB_PHYSICAL_MOVE_QUANTITY_INVALID');

  const units = await lockUnits(db, [fromUnitId, toUnitId]);
  const source = units.get(String(fromUnitId));
  const target = units.get(String(toUnitId));
  if (!CONTENT_MUTABLE_STATES.has(source.state) || !CONTENT_MUTABLE_STATES.has(target.state)) {
    fail('HUB_PHYSICAL_UNIT_CONTENT_FROZEN');
  }

  const { rows: [allocation] } = await db.query(
    'SELECT * FROM hub_purchase_allocations WHERE id = $1 FOR UPDATE',
    [allocationId]
  );
  if (!allocation) fail('HUB_PURCHASE_ALLOCATION_NOT_FOUND');

  const { rows: placements } = await db.query(
    `SELECT * FROM hub_physical_unit_placements
      WHERE physical_unit_id = $1
        AND allocation_id = $2
        AND removed_at IS NULL
      ORDER BY placed_at, id
      FOR UPDATE`,
    [fromUnitId, allocationId]
  );
  const available = placements.reduce((sum, row) => sum + Number(row.quantity), 0);
  if (available < moveQty) fail('HUB_PHYSICAL_MOVE_QUANTITY_EXCEEDS_SOURCE');

  const operationId = crypto.randomUUID();
  let remaining = moveQty;
  for (const placement of placements) {
    if (remaining <= 0) break;
    const rowQty = Number(placement.quantity);
    const take = Math.min(rowQty, remaining);
    await db.query(
      'UPDATE hub_physical_unit_placements SET removed_at = clock_timestamp() WHERE id = $1',
      [placement.id]
    );
    if (take < rowQty) {
      await db.query(
        `INSERT INTO hub_physical_unit_placements (
           physical_unit_id, allocation_id, quantity, operation_id, operation_type, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6)`,
        [fromUnitId, allocationId, rowQty - take, operationId, operationType, actorId]
      );
    }
    remaining -= take;
  }

  await db.query(
    `INSERT INTO hub_physical_unit_placements (
       physical_unit_id, allocation_id, quantity, operation_id, operation_type, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6)`,
    [toUnitId, allocationId, moveQty, operationId, operationType, actorId]
  );

  await insertCustodyEvent(db, {
    physicalUnitId: fromUnitId,
    eventType: 'PLACEMENT_OUT',
    allocationId,
    quantity: moveQty,
    operationId,
    operationType,
    actorId,
    locationRef,
    details: { target_unit_id: toUnitId },
  });
  await insertCustodyEvent(db, {
    physicalUnitId: toUnitId,
    eventType: 'PLACEMENT_IN',
    allocationId,
    quantity: moveQty,
    operationId,
    operationType,
    actorId,
    locationRef,
    details: { source_unit_id: fromUnitId },
  });

  const { rows: [left] } = await db.query(
    `SELECT COUNT(*)::integer AS count
       FROM hub_physical_unit_placements
      WHERE physical_unit_id = $1 AND removed_at IS NULL`,
    [fromUnitId]
  );
  let sourceState = source.state;
  if (Number(left.count) === 0) {
    const { rows: [superseded] } = await db.query(
      `UPDATE hub_physical_units SET state = 'SUPERSEDED', updated_at = now()
        WHERE id = $1 RETURNING *`,
      [fromUnitId]
    );
    sourceState = superseded.state;
    await insertCustodyEvent(db, {
      physicalUnitId: fromUnitId,
      eventType: 'STATE_TRANSITION',
      fromState: source.state,
      toState: 'SUPERSEDED',
      operationId,
      operationType,
      actorId,
      locationRef,
      details: { emptied_by_operation: true },
    });
  }

  return {
    operation_id: operationId,
    operation_type: operationType,
    allocation_id: allocationId,
    quantity: moveQty,
    source_state: sourceState,
    target_state: target.state,
  };
}

async function recordPhysicalUnitOutcome(executor, {
  unitId,
  outcomeType,
  actorId = null,
  locationRef = null,
  details = {},
}) {
  const db = requireExecutor(executor);
  if (!VALID_OUTCOME_TYPES.has(outcomeType)) fail('HUB_PHYSICAL_OUTCOME_INVALID');

  const { rows: [before] } = await db.query(
    'SELECT * FROM hub_physical_units WHERE id = $1 FOR UPDATE',
    [unitId]
  );
  if (!before) fail('HUB_PHYSICAL_UNIT_NOT_FOUND');
  if (before.outcome_type) {
    if (before.outcome_type === outcomeType) return { noop: true, unit: before, outbox_event_id: null };
    fail('HUB_PHYSICAL_OUTCOME_IMMUTABLE');
  }

  const { rows: allocationRows } = await db.query(
    `SELECT p.allocation_id, p.quantity, a.purchase_order_id, a.order_item_id, a.market_id
       FROM hub_physical_unit_placements p
       JOIN hub_purchase_allocations a ON a.id = p.allocation_id
      WHERE p.physical_unit_id = $1
        AND p.removed_at IS NULL
      ORDER BY p.allocation_id`,
    [unitId]
  );

  const { rows: [unit] } = await db.query(
    `UPDATE hub_physical_units
        SET state = 'QUARANTINED',
            outcome_type = $2,
            outcome_recorded_at = now(),
            current_location_ref = COALESCE($3, current_location_ref),
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [unitId, outcomeType, locationRef]
  );

  await insertCustodyEvent(db, {
    physicalUnitId: unitId,
    eventType: 'OUTCOME_REPORTED',
    fromState: before.state,
    toState: 'QUARANTINED',
    actorId,
    locationRef: locationRef || unit.current_location_ref,
    details: { outcome_type: outcomeType, ...(details || {}) },
  });

  const outboxEventId = await reportPhysicalOutcome(db, {
    aggregateType: 'physical_unit',
    aggregateId: String(unitId),
    outcomeType,
    details: {
      physical_unit_reference: unit.reference,
      physical_unit_type: unit.unit_type,
      market_id: unit.market_id || null,
      location_ref: unit.current_location_ref || null,
      allocations: allocationRows,
      ...(details || {}),
    },
  });

  return { noop: false, unit, outbox_event_id: outboxEventId };
}

module.exports = {
  HubPhysicalError,
  UNIT_TYPES,
  UNIT_STATES,
  PHYSICAL_OPERATIONS,
  resolvePurchaseSnapshot,
  snapshotPurchaseAllocation,
  createPhysicalUnit,
  receiveSupplierPackage,
  transitionPhysicalUnit,
  moveAllocationQuantity,
  recordPhysicalUnitOutcome,
};
