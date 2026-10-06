/**
 * @komerce-arch
 * @role          hub-inbound-reconciliation
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        persisted supplier fulfillment id
 * @outputs       canonical inbound verdict comparing supplier fulfillment to physical Hub receipt
 * @depends       supplier_execution_fulfillments, supplier_execution_orders, supplier_execution_order_lines, purchase_lines, hub_purchase_allocations, hub_physical_unit_placements, hub_physical_units, incidents
 * @used-by       future Hub/Control Tower reconciliation surfaces
 * @db-read       supplier_execution_fulfillments, supplier_execution_orders, supplier_execution_order_lines, purchase_lines, hub_purchase_allocations, hub_physical_unit_placements, hub_physical_units, incidents
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/chantier/CUSTOMER_TO_CUSTOMER_CLOSURE.md, docs/doctrine/DOCTRINE_LOGISTICS_CONTROL_CHAIN.md
 * @impact-areas  logistics, purchasing, incident-management
 */
'use strict';

const VERDICT = Object.freeze({
  MATCHED: 'INBOUND_MATCHED',
  MISMATCH: 'MISMATCH',
  PENDING: 'PENDING',
});

const PHYSICAL_INCIDENT_TYPES = Object.freeze([
  'content_mismatch',
  'missing_item',
  'unexpected_item',
  'damaged_item',
  'weight_mismatch',
  'quantity_mismatch',
  'reconciliation_error',
]);

function text(value) {
  const v = String(value || '').trim();
  return v || null;
}

function int(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

function result({
  verdict,
  reason,
  fulfillment,
  expectedQuantity,
  receivedQuantity,
  hubUnits = [],
  incidents = [],
  purchaseLineIds = [],
} = {}) {
  return Object.freeze({
    scope: 'HUB_INBOUND',
    verdict,
    reason,
    supplier_fulfillment_id: fulfillment.id,
    supplier_execution_order_id: fulfillment.supplier_execution_order_id,
    provider: fulfillment.provider,
    supplier_order_id: fulfillment.supplier_order_id,
    supplier_unit_ref: fulfillment.supplier_unit_ref,
    expected_quantity: expectedQuantity,
    received_quantity: receivedQuantity,
    supplier_tracking_number: fulfillment.tracking_number || null,
    supplier_tracking_present: Boolean(text(fulfillment.tracking_number)),
    purchase_line_ids: Object.freeze([...purchaseLineIds]),
    hub_unit_refs: Object.freeze([...hubUnits]),
    incidents: Object.freeze(incidents.map((row) => Object.freeze({
      id: row.id,
      incident_type: row.incident_type,
      reason_code: row.reason_code || null,
    }))),
  });
}

async function loadFulfillment(client, supplierFulfillmentId) {
  const id = text(supplierFulfillmentId);
  if (!id) throw new Error('HUB_INBOUND_SUPPLIER_FULFILLMENT_ID_REQUIRED');

  const { rows } = await client.query(`
    SELECT f.id,
           f.supplier_execution_order_id,
           f.provider,
           f.expected_quantity,
           f.observed_quantity,
           f.provider_status,
           f.tracking_number,
           f.reconciliation_status,
           f.facts,
           o.supplier_order_id,
           NULLIF(BTRIM(f.facts->>'supplier_unit_ref'), '') AS supplier_unit_ref
      FROM supplier_execution_fulfillments f
      JOIN supplier_execution_orders o
        ON o.id = f.supplier_execution_order_id
     WHERE f.id = $1
  `, [id]);

  const fulfillment = rows[0];
  if (!fulfillment) throw new Error('HUB_INBOUND_SUPPLIER_FULFILLMENT_NOT_FOUND');
  return fulfillment;
}

async function loadLineage(client, fulfillment) {
  const unitRef = text(fulfillment.supplier_unit_ref);
  if (!unitRef) return [];

  const { rows } = await client.query(`
    SELECT DISTINCT
           pl.id AS purchase_line_id,
           pl.purchase_order_id,
           pl.order_item_id,
           pl.supplier_unit_ref,
           seol.quantity AS supplier_execution_quantity
      FROM supplier_execution_order_lines seol
      JOIN purchase_lines pl
        ON pl.id = seol.purchase_line_id
     WHERE seol.supplier_execution_order_id = $1
       AND pl.cancelled_at IS NULL
       AND pl.supplier_unit_ref = $2
     ORDER BY pl.id
  `, [fulfillment.supplier_execution_order_id, unitRef]);
  return rows;
}

async function loadHubFacts(client, lineage) {
  const lineIds = lineage.map((row) => row.purchase_line_id);
  const poIds = [...new Set(lineage.map((row) => row.purchase_order_id))];
  const orderItemIds = [...new Set(lineage.map((row) => row.order_item_id))];

  const { rows } = await client.query(`
    SELECT COALESCE(SUM(p.quantity) FILTER (WHERE p.operation_type = 'RECEIVE'), 0)::int AS received_quantity,
           COALESCE(BOOL_OR(u.state = 'QUARANTINED'), FALSE) AS has_quarantine,
           ARRAY_REMOVE(ARRAY_AGG(DISTINCT u.reference), NULL) AS hub_unit_refs,
           ARRAY_REMOVE(ARRAY_AGG(DISTINCT u.id::text), NULL) AS hub_unit_ids
      FROM hub_purchase_allocations a
      LEFT JOIN hub_physical_unit_placements p
        ON p.allocation_id = a.id
       AND p.operation_type = 'RECEIVE'
      LEFT JOIN hub_physical_units u
        ON u.id = p.physical_unit_id
     WHERE a.purchase_line_id = ANY($1::uuid[])
        OR (
          a.purchase_line_id IS NULL
          AND a.purchase_order_id = ANY($2::uuid[])
          AND a.order_item_id = ANY($3::uuid[])
        )
  `, [lineIds, poIds, orderItemIds]);

  return rows[0] || {
    received_quantity: 0,
    has_quarantine: false,
    hub_unit_refs: [],
    hub_unit_ids: [],
  };
}

async function loadPhysicalIncidents(client, { hubUnitIds = [], orderItemIds = [] } = {}) {
  const { rows } = await client.query(`
    SELECT id,
           incident_type,
           details->>'reason_code' AS reason_code
      FROM incidents
     WHERE status IN ('open','investigating')
       AND incident_type = ANY($1::text[])
       AND (
         details->>'physical_unit_id' = ANY($2::text[])
         OR order_item_id = ANY($3::uuid[])
       )
     ORDER BY created_at, id
  `, [PHYSICAL_INCIDENT_TYPES, hubUnitIds, orderItemIds]);
  return rows;
}

async function reconcileHubInbound(client, { supplierFulfillmentId } = {}) {
  if (!client || typeof client.query !== 'function') {
    throw new Error('HUB_INBOUND_DB_CLIENT_REQUIRED');
  }

  const fulfillment = await loadFulfillment(client, supplierFulfillmentId);
  const expectedQuantity = int(fulfillment.expected_quantity);

  if (String(fulfillment.reconciliation_status || '').toLowerCase() !== 'matched') {
    return result({
      verdict: VERDICT.PENDING,
      reason: 'SUPPLIER_FULFILLMENT_NOT_MATCHED',
      fulfillment,
      expectedQuantity,
      receivedQuantity: 0,
    });
  }

  if (expectedQuantity < 1) throw new Error('HUB_INBOUND_EXPECTED_QUANTITY_INVALID');

  const lineage = await loadLineage(client, fulfillment);
  if (!lineage.length) {
    return result({
      verdict: VERDICT.PENDING,
      reason: 'HUB_INBOUND_LINEAGE_MISSING',
      fulfillment,
      expectedQuantity,
      receivedQuantity: 0,
    });
  }

  const hub = await loadHubFacts(client, lineage);
  const receivedQuantity = int(hub.received_quantity);
  const incidents = await loadPhysicalIncidents(client, {
    hubUnitIds: Array.isArray(hub.hub_unit_ids) ? hub.hub_unit_ids : [],
    orderItemIds: [...new Set(lineage.map((row) => row.order_item_id))],
  });

  const common = {
    fulfillment,
    expectedQuantity,
    receivedQuantity,
    hubUnits: Array.isArray(hub.hub_unit_refs) ? hub.hub_unit_refs : [],
    incidents,
    purchaseLineIds: lineage.map((row) => row.purchase_line_id),
  };

  if (hub.has_quarantine === true) {
    return result({
      ...common,
      verdict: VERDICT.MISMATCH,
      reason: 'HUB_INBOUND_QUARANTINED',
    });
  }

  if (incidents.length > 0) {
    return result({
      ...common,
      verdict: VERDICT.MISMATCH,
      reason: 'HUB_INBOUND_PHYSICAL_INCIDENT',
    });
  }

  if (receivedQuantity > expectedQuantity) {
    return result({
      ...common,
      verdict: VERDICT.MISMATCH,
      reason: 'HUB_INBOUND_OVER_RECEIVED',
    });
  }

  if (receivedQuantity === 0) {
    return result({
      ...common,
      verdict: VERDICT.PENDING,
      reason: 'HUB_INBOUND_NOT_RECEIVED',
    });
  }

  if (receivedQuantity < expectedQuantity) {
    return result({
      ...common,
      verdict: VERDICT.PENDING,
      reason: 'HUB_INBOUND_PARTIAL_RECEIPT',
    });
  }

  return result({
    ...common,
    verdict: VERDICT.MATCHED,
    reason: null,
  });
}

module.exports = {
  VERDICT,
  PHYSICAL_INCIDENT_TYPES,
  reconcileHubInbound,
};
