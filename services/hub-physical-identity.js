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
 * @db-read       purchase_orders, orders, order_items, incidents, hub_purchase_allocations, hub_physical_units, hub_physical_unit_placements, hub_custody_events, purchase_lines, suppliers, manual_purchase_executions
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
  HUB_PURCHASE_ORDER_NOT_SUBMITTED: 'hub_purchase_identity_conflict',
  HUB_PURCHASE_IDENTITY_INCOMPLETE: 'hub_purchase_identity_conflict',
  HUB_PURCHASE_ORDER_ITEM_MISMATCH: 'hub_purchase_identity_conflict',
  HUB_PURCHASE_SKU_MISMATCH: 'hub_purchase_identity_conflict',
  HUB_SUPPLIER_IDENTITY_UNRESOLVABLE: 'hub_purchase_identity_conflict',
  HUB_INBOUND_TAG_CONTENT_MISMATCH: 'hub_purchase_identity_conflict',
  HUB_INBOUND_SCAN_MISMATCH: 'hub_purchase_identity_conflict',
  HUB_INBOUND_SCAN_UNCONFIRMED: 'hub_purchase_identity_conflict',
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
    fail('HUB_PURCHASE_ORDER_CANCELLED', 'Purchase Order annulÃ©e');
  }
  if (!row.order_item_id || !row.product_sku_id || !row.supplier_id) {
    fail('HUB_PURCHASE_IDENTITY_INCOMPLETE', 'PO sans identitÃ© exacte order_item/SKU/supplier');
  }
  if (!row.item_order_id || String(row.item_order_id) !== String(row.order_id)) {
    fail('HUB_PURCHASE_ORDER_ITEM_MISMATCH', 'order_item_id ne correspond pas Ã  la commande de la PO');
  }
  if (row.item_sku_id && String(row.item_sku_id) !== String(row.product_sku_id)) {
    fail('HUB_PURCHASE_SKU_MISMATCH', 'product_sku_id de la PO diffÃ¨re du SKU vendu');
  }
  if (!row.supplier_unit_ref || !String(row.supplier_unit_ref).trim() || !isValidSupplierIdentity(row.supplier_order_identity)) {
    fail('HUB_SUPPLIER_IDENTITY_UNRESOLVABLE', 'Supplier Order Identity exacte absente ou invalide');
  }
  if (!row.market_id || !row.relais_id) {
    fail('HUB_DESTINATION_UNRESOLVABLE', 'market_id/relais_id autoritatif absent sur la commande');
  }
  const quantity = Number(row.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    fail('HUB_PURCHASE_QUANTITY_INVALID', 'QuantitÃ© PO invalide');
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


/**
 * A confirmed Central Hub MANUAL purchase has no external supplier SKU/SOI.
 * Its *internal* physical provenance is the immutable Purchasing execution
 * evidence, not a fictitious external provider identity.
 *
 * Both original supplier fields must be exactly NULL; a partial/invalid
 * external identity is never silently repaired here.
 * All reads run inside the caller's existing receipt transaction.
 */
async function snapshotFromConfirmedCentralHubExecution(executor, row) {
  const db = requireExecutor(executor);
  if (!row || !row.purchase_line_id
      || row.supplier_unit_ref !== null || row.supplier_order_identity !== null) {
    return snapshotFromRow(row);
  }

  const { rows: [proof] } = await db.query(
    `SELECT s.system_key, po.trigger_mode, po.status AS po_status,
            pl.confirmed_quantity, pl.confirmed_unit_price, pl.confirmed_currency,
            pl.confirmed_at, pl.supplier_unit_ref, pl.supplier_order_identity
       FROM purchase_lines pl
       JOIN purchase_orders po ON po.id = pl.purchase_order_id
       JOIN suppliers s ON s.id = pl.supplier_id
      WHERE pl.id = $1 AND po.id = $2 AND pl.cancelled_at IS NULL`,
    [row.purchase_line_id, row.purchase_order_id]
  );
  const confirmedQty = Number(proof?.confirmed_quantity);
  const confirmedPrice = Number(proof?.confirmed_unit_price);
  if (!proof || proof.system_key !== 'central_hub'
      || !['manual', 'whatsapp'].includes(proof.trigger_mode)
      || !['confirmed', 'hub_received'].includes(proof.po_status)
      || proof.supplier_unit_ref !== null || proof.supplier_order_identity !== null
      || !proof.confirmed_at || !Number.isInteger(confirmedQty) || confirmedQty < 1
      || confirmedQty !== Number(row.quantity)
      || !Number.isFinite(confirmedPrice) || confirmedPrice <= 0
      || !/^[A-Z]{3}$/.test(String(proof.confirmed_currency || ''))) {
    fail('HUB_SUPPLIER_IDENTITY_UNRESOLVABLE',
      'Achat Hub manuel sans identitÃ© fournisseur : confirmation et prix prouvÃ©s obligatoires');
  }

  const { rows: executions } = await db.query(
    `SELECT id, quantity, amount, currency, seller_supplier_id, seller_label, proof_ref
       FROM manual_purchase_executions
      WHERE purchase_order_id = $1 AND purchase_line_id = $2
      ORDER BY id`,
    [row.purchase_order_id, row.purchase_line_id]
  );
  // All seller portions must be durably evidenced and exactly reconcile.
  // Money uses the persisted 4-decimal precision, not floating rounding tolerances.
  const expectedAmount4 = Math.round(confirmedPrice * 10000) * confirmedQty;
  let totalQty = 0;
  let totalAmount4 = 0;
  for (const entry of executions || []) {
    const qty = Number(entry.quantity);
    const amount4 = Math.round(Number(entry.amount) * 10000);
    if (!entry.id || !Number.isInteger(qty) || qty < 1
        || !Number.isSafeInteger(amount4) || amount4 < 0
        || entry.currency !== proof.confirmed_currency
        || !String(entry.proof_ref || '').trim()
        || (!entry.seller_supplier_id && !String(entry.seller_label || '').trim())) {
      fail('HUB_SUPPLIER_IDENTITY_UNRESOLVABLE',
        'Preuve vendeur/quantitÃ©/montant/devise manuelle incomplÃ¨te');
    }
    totalQty += qty;
    totalAmount4 += amount4;
  }
  if (!executions?.length || !Number.isSafeInteger(expectedAmount4)
      || totalQty !== confirmedQty || totalAmount4 !== expectedAmount4) {
    fail('HUB_SUPPLIER_IDENTITY_UNRESOLVABLE',
      'ExÃ©cutions manuelles non rÃ©conciliÃ©es avec la confirmation de la ligne');
  }

  // This reference explicitly identifies *internal Purchasing evidence*.
  // It must never be presented as an actual supplier SKU or external order.
  return snapshotFromRow({
    ...row,
    supplier_unit_ref: 'INTERNAL-MANUAL-PURCHASE:' + row.purchase_line_id,
    supplier_order_identity: {
      provider: 'komerce_manual_purchase_evidence',
      version: 1,
      payload: {
        purchase_order_id: row.purchase_order_id,
        purchase_line_id: row.purchase_line_id,
        execution_ids: executions.map((entry) => String(entry.id)),
      },
    },
  });
}

// PO regroupÃ©e : la quantitÃ© reÃ§ue est rÃ©partie sur les lignes de la PO portant le product_sku_id dÃ©clarÃ©,
// non annulÃ©es et non soldÃ©es, par ordre de commande (orders.created_at) puis id de ligne. Chaque ligne servie
// reÃ§oit son propre instantanÃ© d'allocation (ligne + order_items + orders).
async function resolveGroupedLineEntries(db, content) {
  if (!content.product_sku_id) {
    fail('HUB_PURCHASE_SKU_MISMATCH', 'product_sku_id obligatoire pour une Purchase Order regroupÃ©e');
  }
  // MÃªme ordre de verrouillage que confirmGroupedPurchaseOrder : en-tÃªte PO
  // d'abord, lignes ensuite. Le JOIN FOR UPDATE OF pl / FOR SHARE OF po
  // peut sinon prendre pl avant po et former un deadlock PostgreSQL 40P01
  // quand une confirmation rÃ©duite et une rÃ©ception arrivent ensemble.
  const { rows: [lockedPo] } = await db.query(
    'SELECT id, status FROM purchase_orders WHERE id=$1 FOR SHARE',
    [content.purchase_order_id]
  );
  if (!lockedPo) fail('HUB_PURCHASE_ORDER_UNRESOLVABLE', 'Purchase Order introuvable');
  if (lockedPo.status === 'cancelled') fail('HUB_PURCHASE_ORDER_CANCELLED', 'Purchase Order annulÃ©e');
  if (lockedPo.status === 'draft') fail('HUB_PURCHASE_ORDER_NOT_SUBMITTED', 'Purchase Order regroupÃ©e encore en brouillon');
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
            purchase_line_received_quantity(pl.id) AS received
       FROM purchase_lines pl
       JOIN purchase_orders po ON po.id = pl.purchase_order_id
       JOIN order_items oi ON oi.id = pl.order_item_id
       JOIN orders o ON o.id = oi.order_id
      WHERE pl.purchase_order_id = $1
        AND pl.product_sku_id = $2
        AND pl.cancelled_at IS NULL
      ORDER BY o.created_at ASC, pl.id ASC
      FOR UPDATE OF pl`,
    [content.purchase_order_id, content.product_sku_id]
  );
  // HB-06/HB-07 : le reÃ§u est lu APRÃˆS le verrou des lignes (une rÃ©ception concurrente de la mÃªme variante attend),
  // via l'unique dÃ©finition SQL de la quantitÃ© reÃ§ue (hors quarantaine).
  for (const row of rows) {
    const { rows: [r] } = await db.query('SELECT purchase_line_received_quantity($1) AS received', [row.purchase_line_id]);
    row.received = Number(r?.received || 0);
  }
  if (rows.length === 0) {
    fail('HUB_PURCHASE_SKU_MISMATCH', 'Aucune ligne dâ€™achat ouverte pour ce product_sku_id dans la Purchase Order');
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
      snapshot: await snapshotFromConfirmedCentralHubExecution(db, row),
    });
    left -= share;
  }
  if (left > 0) {
    fail('HUB_ALLOCATION_OVERRECEIVED', 'QuantitÃ© physique supÃ©rieure Ã  la quantitÃ© restant Ã  recevoir sur les lignes');
  }
  return entries;
}

// Un contenu dÃ©clarÃ© â†’ une ou plusieurs entrÃ©es {content, snapshot} (une par allocation).
//   - PO historique : une entrÃ©e, allocation au niveau PO (comportement inchangÃ©) ;
//   - PO regroupÃ©e (order_id NULL) : une entrÃ©e par ligne servie.
async function resolveContentEntries(executor, content) {
  const db = requireExecutor(executor);
  const { rows: [header] } = await db.query(
    // Lock the PO before any purchase_lines rows. Confirmation uses this same order
    // (PO, then lines); reversing it can deadlock a reduced confirmation against
    // a concurrent physical receipt.
    'SELECT id, order_id, status FROM purchase_orders WHERE id = $1 FOR SHARE',
    [content.purchase_order_id]
  );
  if (header && header.order_id === null) {
    if (header.status === 'cancelled') fail('HUB_PURCHASE_ORDER_CANCELLED', 'Purchase Order annulÃ©e');
    // Un brouillon n'a rien engagÃ© auprÃ¨s du fournisseur : rien ne peut en Ãªtre reÃ§u.
    if (header.status === 'draft') fail('HUB_PURCHASE_ORDER_NOT_SUBMITTED', 'Purchase Order regroupÃ©e encore en brouillon');
    return resolveGroupedLineEntries(db, content);
  }

  const snapshot = await resolvePurchaseSnapshot(db, content.purchase_order_id);
  if (content.product_sku_id && String(content.product_sku_id) !== String(snapshot.product_sku_id)) {
    fail('HUB_PURCHASE_SKU_MISMATCH', 'product_sku_id dÃ©clarÃ© diffÃ©rent du SKU de la Purchase Order');
  }
  if (content.quantity > snapshot.quantity) {
    fail('HUB_ALLOCATION_OVERRECEIVED', 'QuantitÃ© physique supÃ©rieure Ã  la quantitÃ© achetÃ©e');
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
  // Les deux formes ont chacune leur index unique partiel : le prÃ©dicat doit figurer dans ON CONFLICT.
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
    fail('HUB_ALLOCATION_SNAPSHOT_DRIFT', 'Allocation existante diffÃ©rente de la vÃ©ritÃ© dâ€™achat snapshotÃ©e');
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
  orderId = null,
  bagPlan = null,
  details = {},
}) {
  const db = requireExecutor(executor);
  if (!reference || !String(reference).trim()) fail('HUB_PHYSICAL_REFERENCE_REQUIRED');
  if (!UNIT_TYPES.has(unitType)) fail('HUB_PHYSICAL_UNIT_TYPE_INVALID');
  if (orderId && unitType !== 'HANDLING_UNIT') fail('HUB_ORDER_BAG_REQUIRES_HANDLING_UNIT');
  if (bagPlan && !orderId) fail('HUB_ORDER_BAG_PLAN_REQUIRES_ORDER');
  if (!UNIT_STATES.has(initialState)) fail('HUB_PHYSICAL_STATE_INVALID');
  if (!['RECEIVED', 'QUARANTINED'].includes(initialState)) {
    fail('HUB_PHYSICAL_INITIAL_STATE_INVALID', 'Une unitÃ© physique doit naÃ®tre RECEIVED ou QUARANTINED');
  }

  const { rows: [unit] } = await db.query(
    `INSERT INTO hub_physical_units (
       reference, unit_type, state, external_ref, current_location_ref, created_by, order_id, bag_plan
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     RETURNING *`,
    [String(reference).trim(), unitType, initialState, externalRef, locationRef, actorId, orderId, bagPlan ? JSON.stringify(bagPlan) : null]
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
    ? { purchase_order_id: c.purchase_order_id, product_sku_id: c.product_sku_id,
        ...(c.evidence_code ? {evidence_code:c.evidence_code}:{}),
        ...(c.evidence_method === 'MANUAL' ? {evidence_method:'MANUAL',evidence_ref:c.evidence_ref}:{}), quantity: c.quantity }
    : { purchase_order_id: c.purchase_order_id, quantity: c.quantity };
}

function quarantineSubtypeForReason(reasonCode) {
  const subtype = HUB_QUARANTINE_SUBTYPE_BY_REASON[reasonCode];
  if (!subtype) fail('HUB_QUARANTINE_REASON_UNMAPPED', `Aucune autoritÃ© F2 pour ${reasonCode}`);
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
    fail('HUB_INBOUND_CONTENTS_REQUIRED', 'Le colis fournisseur doit dÃ©clarer son contenu');
  }
  const grouped = new Map();
  for (const item of contents) {
    if (!item || !item.purchase_order_id) fail('HUB_PURCHASE_ORDER_REQUIRED');
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) fail('HUB_INBOUND_QUANTITY_INVALID');
    const productSkuId = item.product_sku_id ? String(item.product_sku_id) : null;
    const key = `${String(item.purchase_order_id)}|${productSkuId || ''}`;
    const entry = grouped.get(key) || { purchase_order_id: String(item.purchase_order_id), product_sku_id: productSkuId, quantity: 0 };
    const observedCode = item.evidence_code ? String(item.evidence_code).trim().toUpperCase() : null;
    if (observedCode && entry.evidence_code && entry.evidence_code !== observedCode) {
      fail('HUB_INBOUND_EVIDENCE_CONFLICT','Codes physiques incompatibles pour un mÃªme SKU rÃ©ceptionnÃ©');
    }
    if (observedCode) entry.evidence_code = observedCode;
    // Saisie clavier volontaire : mÃªme writer, provenance MANUAL + justification, jamais un SCAN prÃ©sumÃ©.
    if (item.evidence_method === 'MANUAL') {
      const ref = typeof item.evidence_ref === 'string' ? item.evidence_ref.trim() : '';
      if (!productSkuId) fail('HUB_INBOUND_MANUAL_SKU_REQUIRED', 'Mode manuel : variante (SKU) requise');
      if (observedCode) fail('HUB_INBOUND_MANUAL_CODE_FORBIDDEN', 'Mode manuel : aucun code scannÃ© attendu');
      if (ref.length < 6) fail('HUB_INBOUND_MANUAL_EVIDENCE_REQUIRED', 'Mode manuel : justification de 6 caractÃ¨res minimum');
      if (entry.evidence_code) fail('HUB_INBOUND_EVIDENCE_CONFLICT', 'Preuves scan et manuelle incompatibles pour un mÃªme SKU');
      entry.evidence_method = 'MANUAL';
      entry.evidence_ref = ref;
    } else if (entry.evidence_method === 'MANUAL' && observedCode) {
      fail('HUB_INBOUND_EVIDENCE_CONFLICT', 'Preuves scan et manuelle incompatibles pour un mÃªme SKU');
    }
    entry.quantity += quantity;
    grouped.set(key, entry);
  }
  return [...grouped.values()].map((entry) => (entry.product_sku_id
    ? entry
    : { purchase_order_id: entry.purchase_order_id, quantity: entry.quantity }));
}

/**
 * MatiÃ¨re dÃ©jÃ  placÃ©e pour une allocation, hors unitÃ©s ayant un outcome terminal (LOST/STOLEN/DESTROYED/
 * DAMAGED_UNUSABLE) : une unitÃ© perdue ou inutilisable n'est plus de la matiÃ¨re reÃ§ue (cf. v_purchase_line_progress,
 * migration 306), ce qui permet de rÃ©ceptionner son remplacement sans le mettre en quarantaine Ã  tort.
 */
async function placedQuantityExcludingOutcomes(db, allocationId) {
  const { rows: [row] } = await db.query(
    `SELECT COALESCE(SUM(p.quantity), 0)::integer AS quantity
       FROM hub_physical_unit_placements p
       JOIN hub_physical_units u ON u.id = p.physical_unit_id
      WHERE p.allocation_id = $1 AND p.removed_at IS NULL AND u.outcome_type IS NULL`,
    [allocationId]
  );
  return Number(row.quantity);
}

// Un code observÃ© Ã  la rÃ©ception doit rÃ©soudre exactement le SKU de la PO.
async function observedReceiptCode(db, entry) {
  if (entry.content.evidence_method === 'MANUAL') return null; // preuve manuelle : pas de code Ã  rÃ©soudre
  if (!entry.content.evidence_code) return null; // parcours historique, Ã  migrer sous L11
  const physicalCodes = require('./hub-physical-codes');
  let match;
  try {
    match = await physicalCodes.resolvePhysicalCode(db, {
      purchaseOrderId: entry.content.purchase_order_id,
      code: entry.content.evidence_code,
    });
  } catch (error) {
    fail('HUB_INBOUND_SCAN_MISMATCH', 'Code scannÃ© absent ou incompatible avec la PO');
  }
  if (!match.confirmed) fail('HUB_INBOUND_SCAN_UNCONFIRMED', 'Code non confirmÃ© : arbitrage obligatoire');
  if (String(match.product_sku_id) !== String(entry.snapshot.product_sku_id)) {
    fail('HUB_INBOUND_SCAN_MISMATCH', 'Code scannÃ© diffÃ©rent de la variante attendue');
  }
  return match.code;
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
    let evidenceCode = null;
    try {
      evidenceCode = await observedReceiptCode(db, entry);
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
    const placed = { quantity: await placedQuantityExcludingOutcomes(db, allocation.id) };
    if (Number(placed.quantity) + entry.content.quantity > Number(allocation.quantity)) {
      return createQuarantinedInbound(db, {
        reference, externalRef, actorId, locationRef,
        reasonCode: 'HUB_ALLOCATION_OVERRECEIVED',
        reason: 'La quantitÃ© dÃ©jÃ  placÃ©e + reÃ§ue dÃ©passe la quantitÃ© achetÃ©e',
        contents: normalized,
        purchaseOrderId: entry.content.purchase_order_id,
      });
    }
    allocations.push({
      allocation, quantity: entry.content.quantity, evidenceCode,
      evidenceMethod: entry.content.evidence_method === 'MANUAL' ? 'MANUAL' : null,
      evidenceRef: entry.content.evidence_method === 'MANUAL' ? entry.content.evidence_ref : null,
    });
  }

  const unit = await createPhysicalUnit(db, {
    reference,
    unitType: 'SUPPLIER_PACKAGE',
    externalRef,
    actorId,
    locationRef,
    initialState: 'RECEIVm«ëŒ+Š×ž®º+º$zzb¥äTBrÀ¢FWF–Ç3¢²–æ&÷VæC¢G'VRÒÀ¢Ò“°¢6öç7B÷W&F–öä–BÒ7'—Fòç&æFöÕUT”B‚“° ¢f÷"†6öç7B—FVÒöbÆÆö6F–öç2’°¢G'’°¢v—BF"çVW'’€¢”å4U%B”åDò‡V%÷‡—6–6Å÷Væ—E÷Æ6VÖVçG2€¢‡—6–6Å÷Væ—Eö–BÂÆÆö6F–öåö–BÂVçF—G’Â÷W&F–öåö–BÂ÷W&F–öå÷G—RÂ7&VFVEö'’À¢Wf–FVæ6UöÖWF†öBÂWf–FVæ6Uö6öFRÂWf–FVæ6U÷&V`¢’dÅTU2‚CÂC"ÂC2ÂCBÂu$T4T•dRrÂCRÂCbÂCrÂC‚–À¢·Væ—Bæ–BÂ—FVÒæÆÆö6F–öâæ–BÂ—FVÒçVçF—G’Â÷W&F–öä–BÂ7F÷$–BÀ¢—FVÒæWf–FVæ6T6öFRòu44âr¢—FVÒæWf–FVæ6TÖWF†öBÂ—FVÒæWf–FVæ6T6öFRÂ—FVÒæWf–FVæ6U&VeÐ¢“°¢Ò6F6‚†W'"’°¢òò„"Ór¢Æv&FR&6R‡fW'&÷R²ÆföæBFRÂvÆÆö6F–öâ’,:—öæBVæRW'&WW"''WFR²öâÆ&VæBVÚ±î¸Â¸­yêë¢°k¢G§¦*^D');
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
  if (target.unit_type === 'MARKET_PARCEL') {
    const { rows: targetMarkets } = await db.query(
      `SELECT DISTINCT a.market_id FROM hub_physical_unit_placements p
         JOIN hub_purchase_allocations a ON a.id=p.allocation_id
        WHERE p.physical_unit_id=$1 AND p.removed_at IS NULL`, [toUnitId]
    );
    if (targetMarkets.some(row => String(row.market_id) !== String(allocation.market_id))) {
      fail('HUB_BOX_MARKET_MISMATCH');
    }
  }

  let verifiedCode = null;
  if (target.unit_type === 'HANDLING_UNIT' && target.order_id) {
    if (String(target.order_id) !== String(allocation.order_id)) fail('HUB_ORDER_BAG_ALLOCATION_MISMATCH');
    if (evidenceMethod === 'SCAN') {
      const physicalCodes = require('./hub-physical-codes');
      let observation;
      try {
        observation = await physicalCodes.resolvePhysicalCode(db, {
          purchaseOrderId: allocation.purchase_order_id,
          code: evidenceCode,
        });
      } catch (error) {
        fail('HUB_ORDER_BAG_SCAN_INVALID', error.code || 'Code physique inconnu');
      }
      if (!observation.confirmed || String(observation.product_sku_id) !== String(allocation.product_sku_id)) {
        fail('HUB_ORDER_BAG_SCAN_SKU_MISMATCH');
      }
      verifiedCode = observation.code;
    } else if (evidenceMethod === 'MANUAL' && typeof evidenceRef === 'string' && evidenceRef.trim().length >= 6) {
      if (evidenceCode) fail('HUB_ORDER_BAG_MANUAL_CODE_FORBIDDEN');
    } else {
      fail('HUB_ORDER_BAG_DEPOSIT_EVIDENCE_REQUIRED');
    }
  } else if (target.unit_type === 'MARKET_PARCEL' && evidenceMethod) {
    if (evidenceMethod === 'SCAN') {
      const physicalCodes = require('./hub-physical-codes');
      let observation;
      try {
        observation = await physicalCodes.resolvePhysicalCode(db, {
          purchaseOrderId: allocation.purchase_order_id,
          code: evidenceCode,
        });
      } catch (error) {
        fail('HUB_BOX_ITEM_SCAN_INVALID', error.code || 'Code physique inconnu');
      }
      if (!observation.confirmed || String(observation.product_sku_id) !== String(allocation.product_sku_id)) {
        fail('HUB_BOX_ITEM_SCAN_SKU_MISMATCH');
      }
      verifiedCode = observation.code;
    } else if (evidenceMethod === 'MANUAL' && typeof evidenceRef === 'string' && evidenceRef.trim().length >= 6) {
      if (evidenceCode) fail('HUB_BOX_ITEM_MANUAL_CODE_FORBIDDEN');
    } else {
      fail('HUB_BOX_ITEM_EVIDENCE_REQUIRED');
    }
    if (evidenceMethod === 'SCAN' && moveQty !== 1) fail('HUB_BOX_SCAN_ONE_ITEM_PER_OPERATION');
  }

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
           physical_unit_id, allocation_id, quantity, operation_id, operation_type, created_by,
           evidence_method, evidence_code, evidence_ref
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [fromUnitId, allocationId, rowQty - take, operationId, operationType, actorId,
         placement.evidence_method || null, placement.evidence_code || null, placement.evidence_ref || null]
      );
    }
    remaining -= take;
  }

  await db.query(
    `INSERT INTO hub_physical_unit_placements (
       physical_unit_id, allocation_id, quantity, operation_id, operation_type, created_by,
       evidence_method, evidence_code, evidence_ref
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [toUnitId, allocationId, moveQty, operationId, operationType, actorId,
     verifiedCode ? 'SCAN' : evidenceMethod === 'MANUAL' ? 'MANUAL' : null,
     verifiedCode, evidenceMethod === 'MANUAL' ? evidenceRef.trim() : null]
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
    if (before.outcome_type === outcomeType) return { noop: true, unit: before, outbox