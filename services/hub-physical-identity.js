/**
 * @komerce-arch
 * @role          hub-physical-identity
 * @domain        logistics
 * @layer         service
 * @criticality   critical
 * @inputs        caller_owned_transaction_executor, purchase_order_identity, physical_unit_operation
 * @outputs       immutable_purchase_allocation, physical_unit, custody_events, governed_incident, transactional_outbox_event
 * @depends       services/outbox-producer.js, services/incident-write-service.js
 * @used-by       HUB-001 internal logistics boundary
 * @db-read       purchase_orders, orders, order_items, incidents, hub_purchase_allocations, hub_physical_units, hub_physical_unit_placements, hub_custody_events
 * @db-write      hub_purchase_allocations, hub_physical_units, hub_physical_unit_placements, hub_custody_events
 * @db-write-via:incident-write-service incidents
 * @db-write-via:outbox-producer outbox_events
 * @db-txn        caller_owned_transaction_required
 * @doctrine      HUB-001 Physical Identity, Allocation & Custody; F2_INCIDENT_GOVERNANCE_CONTRACT; F3_PROOF_REVALIDATION_CONTRACT
 * @impact-areas  logistics, purchasing, market, incident-management
 * @version       2026-09
 */

'use strict';

const crypto = require('crypto');
const { reportPhysicalOutcome, VALID_OUTCOME_TYPES } = require('./outbox-producer');
const {
  createHubPhysicalReconciliationIncident,
  resolveUpstreamTruthIncident,
} = require('./incident-write-service');

const UNIT_TYPES = new Set(['SUPPLIER_PACKAGE', 'HANDLING_UNIT', 'MARKET_PARCEL']);
const UNIT_STATES = new Set([
  'RECEIVED', 'IDENTIFIED', 'QUALITY_CHECKED', 'LOCATED', 'ALLOCATED',
  'PICKED', 'PACKED', 'DISPATCHED', 'QUARANTINED', 'SUPERSEDED',
]);
const CONTENT_MUTABLE_STATES = new Set([
  'RECEIVED', 'IDENTIFIED', 'QUALITY_CHECKED', 'LOCATED', 'ALLOCATED', 'PICKED',
]);
const PHYSICAL_OPERATIONS = new Set(['SPLIT', 'MERGE', 'REPACK']);

const HUB_QUARANTINE_SUBTYPE_BY_REASON = Object.freeze({
  HUB_PURCHASE_ORDER_UNRESOLVABLE: 'hub_purchase_identity_conflict',
  HUB_PURCHASE_ORDER_CANCELLED: 'hub_purchase_identity_conflict',
  HUB_PURCHASE_IDENTITY_INCOMPLETE: 'hub_purchase_identity_conflict',
  HUB_PURCHASE_ORDER_ITEM_MISMATCH: 'hub_purchase_identity_conflict',
  HUB_PURCHASE_SKU_MISMATCH: 'hub_purchase_identity_conflict',
  HUB_SUPPLIER_IDENTITY_UNRESOLVABLE: 'hub_purchase_identity_conflict',
  HUB_INBOUND_TAG_CONTENT_MISMATCH: 'hub_purchase_identity_conflict',
  HUB_ALLOCATION_SNAPSHOT_DRIFT: 'hub_purchase_identity_conflict',
  HUB_PURCHASE_QUANTITY_INVALID: 'hub_purchase_quantity_conflict',
  HUB_ALLOCATION_OVERRECEIVED: 'hub_purchase_quantity_conflict',
  HUB_DESTINATION_UNRESOLVABLE: 'hub_destination_conflict',
});

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
    purchase_line_id: row.purchase_line_id || null,
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

// PO regroupée : la quantité reçue est répartie sur les lignes de la PO portant le product_sku_id déclaré,
// non annulées et non soldées, par ordre de commande (orders.created_at) puis id de ligne. Chaque ligne servie
// reçoit son propre instantané d'allocation (ligne + order_items + orders).
async function resolveGroupedLineEntries(db, content) {
  if (!content.product_sku_id) {
    fail('HUB_PURCHASE_SKU_MISMATCH', 'product_sku_id obligatoire pour une Purchase Order regroupée');
  }
  const { rows } = await db.query(
    `SELECT pl.id AS purchase_line_id,
            po.id AS purchase_order_id,
            oi.order_id,
            pl.order_item_id,
            pl.product_sku_id,
            pl.supplier_id,
            pl.supplier_unit_ref,
            pl.supplier_order_identity,
            purchase_line_effective_quantity(pl.cancelled_at, pl.settled_quantity, pl.confirmed_quantity, pl.quantity)
              AS quantity,
            po.status AS po_status,
            oi.order_id AS item_order_id,
            oi.sku_id AS item_sku_id,
            o.market_id,
            o.relais_id,
            COALESCE((
              SELECT SUM(p.quantity)::integer
                FROM hub_physical_unit_placements p
                JOIN hub_purchase_allocations a ON a.id = p.allocation_id
               WHERE a.purchase_line_id = pl.id AND p.operation_type = 'RECEIVE'
            ), 0) AS received
       FROM purchase_lines pl
       JOIN purchase_orders po ON po.id = pl.purchase_order_id
       JOIN order_items oi ON oi.id = pl.order_item_id
       JOIN orders o ON o.id = oi.order_id
      WHERE pl.purchase_order_id = $1
        AND pl.product_sku_id = $2
        AND pl.cancelled_at IS NULL
      ORDER BY o.created_at ASC, pl.id ASC
      FOR SHARE OF pl, po`,
    [content.purchase_order_id, content.product_sku_id]
  );
  if (rows.length === 0) {
    fail('HUB_PURCHASE_SKU_MISMATCH', 'Aucune ligne d’achat ouverte pour ce product_sku_id dans la Purchase Order');
  }

  const entries = [];
  let left = Number(content.quantity);
  for (const row of rows) {
    if (left <= 0) break;
    const remaining = Number(row.quantity) - Number(row.received);
    if (remaining <= 0) continue;
    const share = Math.min(left, remaining);
    entries.push({
      content: { ...content, quantity: share },
      snapshot: snapshotFromRow(row),
    });
    left -= share;
  }
  if (left > 0) {
    fail('HUB_ALLOCATION_OVERRECEIVED', 'Quantité physique supérieure à la quantité restant à recevoir sur les lignes');
  }
  return entries;
}

// Un contenu déclaré → une ou plusieurs entrées {content, snapshot} (une par allocation).
//   - PO historique : une entrée, allocation au niveau PO (comportement inchangé) ;
//   - PO regroupée (order_id NULL) : une entrée par ligne servie.
async function resolveContentEntries(executor, content) {
  const db = requireExecutor(executor);
  const { rows: [header] } = await db.query(
    'SELECT id, order_id, status FROM purchase_orders WHERE id = $1',
    [content.purchase_order_id]
  );
  if (header && header.order_id === null) {
    if (header.status === 'cancelled') fail('HUB_PURCHASE_ORDER_CANCELLED', 'Purchase Order annulée');
    return resolveGroupedLineEntries(db, content);
  }

  const snapshot = await resolvePurchaseSnapshot(db, content.purchase_order_id);
  if (content.product_sku_id && String(content.product_sku_id) !== String(snapshot.product_sku_id)) {
    fail('HUB_PURCHASE_SKU_MISMATCH', 'product_sku_id déclaré différent du SKU de la Purchase Order');
  }
  if (content.quantity > snapshot.quantity) {
    fail('HUB_ALLOCATION_OVERRECEIVED', 'Quantité physique supérieure à la quantité achetée');
  }
  return [{ content, snapshot }];
}

async function findExistingAllocation(db, snapshot) {
  if (snapshot.purchase_line_id) {
    const { rows: [existing] } = await db.query(
      'SELECT * FROM hub_purchase_allocations WHERE purchase_line_id = $1 FOR SHARE',
      [snapshot.purchase_line_id]
    );
    return existing || null;
  }
  const { rows: [existing] } = await db.query(
    'SELECT * FROM hub_purchase_allocations WHERE purchase_order_id = $1 AND purchase_line_id IS NULL FOR SHARE',
    [snapshot.purchase_order_id]
  );
  return existing || null;
}

function allocationMatches(existing, snapshot) {
  return String(existing.purchase_order_id) === String(snapshot.purchase_order_id)
    && String(existing.purchase_line_id || '') === String(snapshot.purchase_line_id || '')
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
  // Les deux formes ont chacune leur index unique partiel : le prédicat doit figurer dans ON CONFLICT.
  const conflictTarget = snapshot.purchase_line_id
    ? 'ON CONFLICT (purchase_line_id) WHERE purchase_line_id IS NOT NULL DO NOTHING'
    : 'ON CONFLICT (purchase_order_id) WHERE purchase_line_id IS NULL DO NOTHING';
  const { rows } = await db.query(
    `INSERT INTO hub_purchase_allocations (
       purchase_order_id, purchase_line_id, order_id, order_item_id, product_sku_id, supplier_id,
       supplier_unit_ref, supplier_order_identity, quantity, market_id, destination_ref
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)
     ${conflictTarget}
     RETURNING *`,
    [
      snapshot.purchase_order_id,
      snapshot.purchase_line_id || null,
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

  const existing = await findExistingAllocation(db, snapshot);
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

function manifestEntry(c) {
  return c.product_sku_id
    ? { purchase_order_id: c.purchase_order_id, product_sku_id: c.product_sku_id, quantity: c.quantity }
    : { purchase_order_id: c.purchase_order_id, quantity: c.quantity };
}

function quarantineSubtypeForReason(reasonCode) {
  const subtype = HUB_QUARANTINE_SUBTYPE_BY_REASON[reasonCode];
  if (!subtype) fail('HUB_QUARANTINE_REASON_UNMAPPED', `Aucune autorité F2 pour ${reasonCode}`);
  return subtype;
}

async function createQuarantinedInbound(executor, {
  reference,
  externalRef,
  actorId,
  locationRef,
  reasonCode,
  reason,
  contents,
  purchaseOrderId = null,
}) {
  const db = requireExecutor(executor);
  const manifest = contents.map(manifestEntry);
  const unit = await createPhysicalUnit(db, {
    reference,
    unitType: 'SUPPLIER_PACKAGE',
    externalRef,
    actorId,
    locationRef,
    initialState: 'QUARANTINED',
    details: { reason_code: reasonCode, reason, manifest },
  });

  const subtype = quarantineSubtypeForReason(reasonCode);
  let context = null;
  if (purchaseOrderId) {
    const { rows: [row] } = await db.query(
      'SELECT id, order_id, order_item_id FROM purchase_orders WHERE id = $1',
      [purchaseOrderId]
    );
    context = row || null;
  }

  const incident = await createHubPhysicalReconciliationIncident(db, {
    physicalUnitId: unit.id,
    subtype,
    reasonCode,
    message: reason,
    purchaseOrderId: purchaseOrderId || null,
    orderId: context && context.order_id,
    orderItemId: context && context.order_item_id,
    details: { manifest, physical_unit_reference: unit.reference },
  });

  await insertCustodyEvent(db, {
    physicalUnitId: unit.id,
    eventType: 'QUARANTINE',
    fromState: 'QUARANTINED',
    toState: 'QUARANTINED',
    actorId,
    locationRef,
    details: { incident_id: incident.id, reason_code: reasonCode, incident_subtype: subtype },
  });

  return { quarantined: true, reason_code: reasonCode, unit, incident };
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
    const productSkuId = item.product_sku_id ? String(item.product_sku_id) : null;
    const key = `${String(item.purchase_order_id)}|${productSkuId || ''}`;
    const entry = grouped.get(key) || { purchase_order_id: String(item.purchase_order_id), product_sku_id: productSkuId, quantity: 0 };
    entry.quantity += quantity;
    grouped.set(key, entry);
  }
  return [...grouped.values()].map((entry) => (entry.product_sku_id
    ? entry
    : { purchase_order_id: entry.purchase_order_id, quantity: entry.quantity }));
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
  for (const content of normalized) {
    try {
      resolved.push(...await resolveContentEntries(db, content));
    } catch (error) {
      if (!(error instanceof HubPhysicalError)) throw error;
      return createQuarantinedInbound(db, {
        reference, externalRef, actorId, locationRef,
        reasonCode: error.code,
        reason: error.message,
        contents: normalized,
        purchaseOrderId: content.purchase_order_id,
      });
    }
  }

  const allocations = [];
  for (const entry of resolved) {
    let allocation;
    try {
      allocation = await persistPurchaseAllocation(db, entry.snapshot);
    } catch (error) {
      if (!(error instanceof HubPhysicalError)) throw error;
      return createQuarantinedInbound(db, {
        reference, externalRef, actorId, locationRef,
        reasonCode: error.code,
        reason: error.message,
        contents: normalized,
        purchaseOrderId: entry.content.purchase_order_id,
      });
    }
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
        purchaseOrderId: entry.content.purchase_order_id,
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
      details: { purchase_order_id: item.allocation.purchase_order_id, purchase_line_id: item.allocation.purchase_line_id || null },
    });
  }

  return {
    quarantined: false,
    unit,
    allocations: allocations.map(({ allocation, quantity }) => ({ allocation, quantity })),
    operation_id: operationId,
  };
}


async function receiveSupplierPackageArrival(executor, {
  reference,
  externalRef = null,
  actorId = null,
  locationRef = null,
  expectedPurchaseOrderId = null,
  inboundTag = null,
}) {
  const db = requireExecutor(executor);
  const unit = await createPhysicalUnit(db, {
    reference,
    unitType: 'SUPPLIER_PACKAGE',
    externalRef,
    actorId,
    locationRef,
    initialState: 'RECEIVED',
    details: {
      inbound_arrival_only: true,
      reconciliation_pending: true,
      expected_purchase_order_id: expectedPurchaseOrderId || null,
      inbound_tag: inboundTag || null,
    },
  });
  return {
    quarantined: false,
    unit,
    reconciliation_pending: true,
    expected_purchase_order_id: expectedPurchaseOrderId || null,
    inbound_tag: inboundTag || null,
  };
}

async function quarantineExistingInbound(executor, {
  unit,
  actorId = null,
  locationRef = null,
  reasonCode,
  reason,
  contents,
  purchaseOrderId = null,
}) {
  const db = requireExecutor(executor);
  const manifest = contents.map(manifestEntry);
  const subtype = quarantineSubtypeForReason(reasonCode);

  const { rows: [quarantined] } = await db.query(
    `UPDATE hub_physical_units
        SET state='QUARANTINED',
            current_location_ref=COALESCE($2,current_location_ref),
            updated_at=now()
      WHERE id=$1
      RETURNING *`,
    [unit.id, locationRef]
  );

  let context = null;
  if (purchaseOrderId) {
    const { rows: [row] } = await db.query(
      'SELECT id, order_id, order_item_id FROM purchase_orders WHERE id = $1',
      [purchaseOrderId]
    );
    context = row || null;
  }

  const incident = await createHubPhysicalReconciliationIncident(db, {
    physicalUnitId: unit.id,
    subtype,
    reasonCode,
    message: reason,
    purchaseOrderId: purchaseOrderId || null,
    orderId: context && context.order_id,
    orderItemId: context && context.order_item_id,
    details: { manifest, physical_unit_reference: unit.reference },
  });

  await insertCustodyEvent(db, {
    physicalUnitId: unit.id,
    eventType: 'QUARANTINE',
    fromState: unit.state,
    toState: 'QUARANTINED',
    actorId,
    locationRef,
    details: { incident_id: incident.id, reason_code: reasonCode, incident_subtype: subtype, manifest },
  });

  return { quarantined: true, reason_code: reasonCode, unit: quarantined, incident };
}

async function reconcileSupplierPackageContents(executor, {
  unitId,
  contents,
  actorId = null,
  locationRef = null,
}) {
  const db = requireExecutor(executor);
  const normalized = normalizeInboundContents(contents);

  const { rows: [unit] } = await db.query(
    'SELECT * FROM hub_physical_units WHERE id=$1 FOR UPDATE',
    [unitId]
  );
  if (!unit) fail('HUB_PHYSICAL_UNIT_NOT_FOUND');
  if (unit.unit_type !== 'SUPPLIER_PACKAGE') fail('HUB_RECONCILE_SUPPLIER_PACKAGE_REQUIRED');
  if (unit.state !== 'RECEIVED') fail('HUB_RECONCILE_STATE_INVALID', 'La réconciliation contenu exige un colis RECEIVED');
  if (unit.outcome_type) fail('HUB_RECONCILE_OUTCOME_TERMINAL');

  const { rows: [existing] } = await db.query(
    `SELECT COUNT(*)::integer AS count
       FROM hub_physical_unit_placements
      WHERE physical_unit_id=$1 AND removed_at IS NULL`,
    [unitId]
  );
  if (Number(existing.count) > 0) fail('HUB_RECONCILE_ALREADY_DONE');

  const { rows: [creationEvent] } = await db.query(
    `SELECT details
       FROM hub_custody_events
      WHERE physical_unit_id=$1
        AND event_type='STATE_TRANSITION'
        AND details->>'creation'='true'
      ORDER BY created_at ASC, id ASC
      LIMIT 1`,
    [unitId]
  );
  const expectedPurchaseOrderId = creationEvent?.details?.expected_purchase_order_id || null;
  if (expectedPurchaseOrderId && !normalized.some((item) => String(item.purchase_order_id) === String(expectedPurchaseOrderId))) {
    return quarantineExistingInbound(db, {
      unit, actorId, locationRef,
      reasonCode: 'HUB_INBOUND_TAG_CONTENT_MISMATCH',
      reason: 'Le contenu constaté ne contient pas la Purchase Order annoncée par le tag KOM-IN',
      contents: normalized,
      purchaseOrderId: expectedPurchaseOrderId,
    });
  }

  const resolved = [];
  for (const content of normalized) {
    try {
      resolved.push(...await resolveContentEntries(db, content));
    } catch (error) {
      if (!(error instanceof HubPhysicalError)) throw error;
      return quarantineExistingInbound(db, {
        unit, actorId, locationRef,
        reasonCode: error.code,
        reason: error.message,
        contents: normalized,
        purchaseOrderId: content.purchase_order_id,
      });
    }
  }

  const allocations = [];
  for (const entry of resolved) {
    let allocation;
    try {
      allocation = await persistPurchaseAllocation(db, entry.snapshot);
    } catch (error) {
      if (!(error instanceof HubPhysicalError)) throw error;
      return quarantineExistingInbound(db, {
        unit, actorId, locationRef,
        reasonCode: error.code,
        reason: error.message,
        contents: normalized,
        purchaseOrderId: entry.content.purchase_order_id,
      });
    }

    const { rows: [placed] } = await db.query(
      `SELECT COALESCE(SUM(quantity), 0)::integer AS quantity
         FROM hub_physical_unit_placements
        WHERE allocation_id = $1 AND removed_at IS NULL`,
      [allocation.id]
    );
    if (Number(placed.quantity) + entry.content.quantity > Number(allocation.quantity)) {
      return quarantineExistingInbound(db, {
        unit, actorId, locationRef,
        reasonCode: 'HUB_ALLOCATION_OVERRECEIVED',
        reason: 'La quantité déjà placée + reçue dépasse la quantité achetée',
        contents: normalized,
        purchaseOrderId: entry.content.purchase_order_id,
      });
    }
    allocations.push({ allocation, quantity: entry.content.quantity });
  }

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
      details: { purchase_order_id: item.allocation.purchase_order_id, purchase_line_id: item.allocation.purchase_line_id || null, reconciliation_on_opening: true },
    });
  }

  const transitioned = await transitionPhysicalUnit(db, {
    unitId: unit.id,
    toState: 'IDENTIFIED',
    actorId,
    locationRef,
    details: { content_reconciled: true, operation_id: operationId },
  });

  return {
    quarantined: false,
    unit: transitioned.unit,
    allocations: allocations.map(({ allocation, quantity }) => ({ allocation, quantity })),
    operation_id: operationId,
    reconciliation_pending: false,
  };
}

async function revalidateQuarantinedInbound(executor, {
  unitId,
  incidentId,
  actorId = null,
  locationRef = null,
  notes = null,
}) {
  const db = requireExecutor(executor);
  const { rows: [unit] } = await db.query(
    'SELECT * FROM hub_physical_units WHERE id = $1 FOR UPDATE',
    [unitId]
  );
  if (!unit) fail('HUB_PHYSICAL_UNIT_NOT_FOUND');
  if (unit.unit_type !== 'SUPPLIER_PACKAGE' || unit.state !== 'QUARANTINED' || unit.outcome_type) {
    fail('HUB_QUARANTINE_REVALIDATION_NOT_ALLOWED');
  }

  const { rows: [quarantineEvent] } = await db.query(`
    SELECT details
      FROM hub_custody_events
     WHERE physical_unit_id = $1
       AND event_type = 'QUARANTINE'
       AND details ? 'manifest'
     ORDER BY created_at DESC, id DESC
     LIMIT 1
  `, [unitId]);
  const manifest = quarantineEvent && quarantineEvent.details && quarantineEvent.details.manifest;
  if (!Array.isArray(manifest) || manifest.length === 0) fail('HUB_QUARANTINE_MANIFEST_MISSING');

  let resolvedEntries = [];
  const resolution = await resolveUpstreamTruthIncident(db, {
    incidentId,
    resolvedBy: actorId,
    notes,
    revalidate: async (sameDb, { incident }) => {
      if (!incident.details || String(incident.details.physical_unit_id) !== String(unitId)) return false;
      const next = [];
      try {
        for (const content of manifest) {
          for (const entry of await resolveContentEntries(sameDb, content)) {
            const existing = await findExistingAllocation(sameDb, entry.snapshot);
            if (existing && !allocationMatches(existing, entry.snapshot)) return false;

            if (existing) {
              const { rows: [placed] } = await sameDb.query(
                `SELECT COALESCE(SUM(quantity),0)::integer AS quantity
                   FROM hub_physical_unit_placements
                  WHERE allocation_id = $1 AND removed_at IS NULL`,
                [existing.id]
              );
              if (Number(placed.quantity) + Number(entry.content.quantity) > Number(entry.snapshot.quantity)) return false;
            }
            next.push(entry);
          }
        }
      } catch (error) {
        if (error instanceof HubPhysicalError) return false;
        throw error;
      }
      resolvedEntries = next;
      return true;
    },
  });

  if (!resolution.resolved) {
    return { resolved: false, reason: resolution.reason, incident_id: incidentId, unit_id: unitId };
  }

  const { rows: [released] } = await db.query(`
    UPDATE hub_physical_units
       SET state = 'RECEIVED',
           current_location_ref = COALESCE($2, current_location_ref),
           updated_at = now()
     WHERE id = $1
     RETURNING *
  `, [unitId, locationRef]);

  await insertCustodyEvent(db, {
    physicalUnitId: unitId,
    eventType: 'STATE_TRANSITION',
    fromState: 'QUARANTINED',
    toState: 'RECEIVED',
    actorId,
    locationRef: locationRef || released.current_location_ref,
    details: { incident_id: incidentId, revalidated: true },
  });

  const operationId = crypto.randomUUID();
  const allocations = [];
  for (const entry of resolvedEntries) {
    const allocation = await persistPurchaseAllocation(db, entry.snapshot);
    await db.query(
      `INSERT INTO hub_physical_unit_placements (
         physical_unit_id, allocation_id, quantity, operation_id, operation_type, created_by
       ) VALUES ($1,$2,$3,$4,'RECEIVE',$5)`,
      [unitId, allocation.id, entry.content.quantity, operationId, actorId]
    );
    await insertCustodyEvent(db, {
      physicalUnitId: unitId,
      eventType: 'PLACEMENT_IN',
      allocationId: allocation.id,
      quantity: entry.content.quantity,
      operationId,
      operationType: 'RECEIVE',
      actorId,
      locationRef: locationRef || released.current_location_ref,
      details: { purchase_order_id: allocation.purchase_order_id, purchase_line_id: allocation.purchase_line_id || null, revalidated: true },
    });
    allocations.push({ allocation, quantity: entry.content.quantity });
  }

  return {
    resolved: true,
    unit: released,
    incident: resolution.incident,
    allocations,
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
  if (before.state === 'QUARANTINED') {
    fail('HUB_QUARANTINE_REVALIDATION_REQUIRED', 'Utiliser revalidateQuarantinedInbound après résolution F3.');
  }

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
  HUB_QUARANTINE_SUBTYPE_BY_REASON,
  resolvePurchaseSnapshot,
  snapshotPurchaseAllocation,
  createPhysicalUnit,
  receiveSupplierPackage,
  receiveSupplierPackageArrival,
  reconcileSupplierPackageContents,
  revalidateQuarantinedInbound,
  transitionPhysicalUnit,
  moveAllocationQuantity,
  recordPhysicalUnitOutcome,
};