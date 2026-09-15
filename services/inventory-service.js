/**
 * @komerce-arch
 * @role          inventory-inventory-service
 * @domain        inventory
 * @layer         service
 * @criticality   critical
 * @inputs        physical receipt / scan assignment payload
 * @outputs       proven physical allocation state, proposal, custody transition
 * @depends       db, services/hub-allocation-service.js, services/parcel-item-mutation-service.js, services/scan-write-service.js, services/order-mutation-service.js
 * @used-by       bootstrap/crons.js, routes/inventory-api.js
 * @db-read       inventory_items, order_items, orders, purchase_orders, parcel_items, parcels, products, relais
 * @db-write      inventory_items
 * @db-write-via:parcel-item-mutation-service parcel_items
 * @db-write-via:scan-write-service scan_events
 * @db-write-via:order-mutation-service orders
 * @db-txn        receive_and_assignment_atomic
 * @doctrine      HUB-001_PHYSICAL_IDENTITY_ALLOCATION_CUSTODY
 * @impact-areas  inventory, logistics, purchasing, orders
 * @version       2026-09
 */

'use strict';

/**
 * HUB-001 — Physical Identity, Allocation & Custody
 *
 * `inventory_items` est l'allocation physique existante : aucune table
 * physical_units parallèle.
 *
 * Philosophie opérateur :
 *   - le moteur PROPOSE un Market Parcel compatible ;
 *   - l'agent SCANNE ;
 *   - un autre colis est accepté seulement s'il est compatible avec la même
 *     vérité commerciale (Market + Relais + order_item + Purchase Order) ;
 *   - aucune vérité amont n'est jamais réassignée par le Hub.
 */
const db = require('../db');
const {
  resolvePurchaseAllocation,
  assertParcelCompatible,
  hubAllocationError,
} = require('./hub-allocation-service');
const {
  assignPhysicalAllocationToParcel,
} = require('./parcel-item-mutation-service');
const { recordHubAllocationScanEvent } = require('./scan-write-service');
const { setInventoryCompletion } = require('./order-mutation-service');

const BUFFER_DEFAULT_HOURS = 12;

async function updateOrderCompletion(orderId, executor = db) {
  const q = executor && typeof executor.query === 'function' ? executor : db;
  const { rows: [counts] } = await q.query(`
    SELECT
      COALESCE((SELECT SUM(COALESCE(quantity, 1))::int FROM order_items WHERE order_id = $1), 0) AS total,
      COALESCE((SELECT SUM(quantity)::int FROM inventory_items WHERE order_id = $1 AND status <> 'cancelled'), 0) AS received,
      COALESCE((SELECT SUM(quantity)::int FROM inventory_items WHERE order_id = $1 AND status = 'assigned'), 0) AS assigned
    FROM orders WHERE id = $1
  `, [orderId]);

  if (!counts) return;

  const total = Number(counts.total || 0);
  const received = Number(counts.received || 0);
  const assigned = Number(counts.assigned || 0);
  const ratio = total > 0 ? Math.min(received / total, 1) : 0;

  await setInventoryCompletion(q, {
    orderId,
    itemsReceived: received,
    itemsTotal: total,
    completionRatio: ratio,
  });

  return { total, received, assigned, ratio };
}

async function proposeAssignmentWithExecutor(executor, inventoryItemId) {
  const { rows: [item] } = await executor.query(`
    SELECT ii.*,
           o.relais_id,
           o.market_id,
           o.id AS authoritative_order_id
      FROM inventory_items ii
      JOIN orders o ON o.id = ii.order_id
     WHERE ii.id = $1
       AND ii.status IN ('received', 'buffered', 'proposed')
     FOR UPDATE OF ii
  `, [inventoryItemId]);

  if (!item) return null;

  if (!item.purchase_order_id || !item.identity_verified_at) {
    const bufferUntil = new Date(Date.now() + BUFFER_DEFAULT_HOURS * 3600000);
    await executor.query(`
      UPDATE inventory_items
         SET status = 'buffered',
             buffer_reason = 'purchase_allocation_unproven',
             buffer_until = $2,
             proposed_parcel_id = NULL,
             updated_at = NOW()
       WHERE id = $1
    `, [inventoryItemId, bufferUntil]);
    return { status: 'buffered', reason: 'purchase_allocation_unproven', buffer_until: bufferUntil };
  }

  // Une proposition est une guidance physique, jamais une autorité :
  //   1. colis qui porte déjà le même order_item ;
  //   2. colis d'ancrage de la même commande ;
  //   3. autre colis du même Relais/Market.
  const { rows: parcels } = await executor.query(`
    SELECT p.id,
           p.reference,
           p.order_id,
           p.relais_id,
           CASE
             WHEN EXISTS (
               SELECT 1 FROM parcel_items pi
                WHERE pi.parcel_id = p.id AND pi.order_item_id = $3
             ) THEN -1
             WHEN p.order_id = $4 THEN 0
             ELSE 1
           END AS priority,
           (SELECT COUNT(*)::int FROM parcel_items pi WHERE pi.parcel_id = p.id) AS item_count
      FROM parcels p
      JOIN relais r ON r.id = p.relais_id
     WHERE p.relais_id = $1
       AND r.market_id = $2
       AND p.status IN ('draft', 'preparation')
     ORDER BY priority ASC, item_count ASC, p.created_at ASC
     LIMIT 5
  `, [item.relais_id, item.market_id, item.order_item_id, item.authoritative_order_id]);

  if (parcels.length > 0) {
    const best = parcels[0];
    await executor.query(`
      UPDATE inventory_items
         SET status = 'proposed',
             proposed_parcel_id = $2,
             proposed_at = NOW(),
             buffer_reason = NULL,
             buffer_until = NULL,
             updated_at = NOW()
       WHERE id = $1
    `, [inventoryItemId, best.id]);

    return {
      status: 'proposed',
      parcel_id: best.id,
      parcel_ref: best.reference,
      alternatives: parcels.slice(1),
    };
  }

  const bufferUntil = new Date(Date.now() + BUFFER_DEFAULT_HOURS * 3600000);
  await executor.query(`
    UPDATE inventory_items
       SET status = 'buffered',
           buffer_reason = 'no_compatible_parcel',
           buffer_until = $2,
           proposed_parcel_id = NULL,
           updated_at = NOW()
     WHERE id = $1
  `, [inventoryItemId, bufferUntil]);

  return { status: 'buffered', reason: 'no_compatible_parcel', buffer_until: bufferUntil };
}

// ─── RECEIVE PHYSICAL ALLOCATION ─────────────────────────────────────────────
async function receiveItem({
  order_item_id,
  order_id = null,
  purchase_order_id = null,
  quantity = 1,
  received_by = null,
} = {}) {
  if (!order_item_id) {
    throw hubAllocationError('HUB_ORDER_ITEM_REQUIRED', 'order_item_id requis pour prouver l’allocation physique.');
  }

  return db.withTransaction(async (client) => {
    const allocation = await resolvePurchaseAllocation(client, {
      orderItemId: order_item_id,
      purchaseOrderId: purchase_order_id,
      quantity,
    });

    if (order_id && String(order_id) !== String(allocation.order_id)) {
      throw hubAllocationError(
        'HUB_ORDER_REASSIGNMENT_FORBIDDEN',
        'order_id ne peut pas réassigner la ligne commerciale vers une autre commande.',
        { supplied_order_id: order_id, authoritative_order_id: allocation.order_id, order_item_id }
      );
    }

    const { rows: [inv] } = await client.query(`
      INSERT INTO inventory_items (
        id, order_item_id, order_id, product_id, quantity,
        purchase_order_id, identity_verified_at,
        status, received_at, received_by
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4,
        $5, NOW(),
        'received', NOW(), $6
      )
      RETURNING *
    `, [
      allocation.order_item_id,
      allocation.order_id,
      allocation.product_id,
      allocation.physical_quantity,
      allocation.purchase_order_id,
      received_by,
    ]);

    const proposal = await proposeAssignmentWithExecutor(client, inv.id);
    await updateOrderCompletion(allocation.order_id, client);

    return {
      item: inv,
      proposal,
      allocation: {
        purchase_order_id: allocation.purchase_order_id,
        order_id: allocation.order_id,
        order_item_id: allocation.order_item_id,
        market_id: allocation.market_id,
        relais_id: allocation.relais_id,
        quantity: allocation.physical_quantity,
        identity_strength: allocation.identity_strength,
      },
    };
  });
}

// ─── PROPOSE ASSIGNMENT (guidance, never authority) ──────────────────────────
async function proposeAssignment(inventoryItemId) {
  return db.withTransaction((client) => proposeAssignmentWithExecutor(client, inventoryItemId));
}

// ─── SCAN INTO MARKET PARCEL ────────────────────────────────────────────────
async function scanIntoParcel(inventoryItemId, parcelId, { scanned_by = null } = {}) {
  return db.withTransaction(async (client) => {
    const { rows: [item] } = await client.query(`
      SELECT ii.*,
             o.market_id,
             o.relais_id,
             po.order_id AS purchase_order_order_id,
             po.order_item_id AS purchase_order_item_id,
             po.status AS purchase_status
        FROM inventory_items ii
        JOIN orders o ON o.id = ii.order_id
        LEFT JOIN purchase_orders po ON po.id = ii.purchase_order_id
       WHERE ii.id = $1
       FOR UPDATE OF ii
    `, [inventoryItemId]);

    if (!item || !['received', 'proposed', 'buffered'].includes(item.status)) {
      throw hubAllocationError('HUB_INVENTORY_ITEM_NOT_ASSIGNABLE', 'Item introuvable ou déjà assigné.', { inventory_item_id: inventoryItemId });
    }
    if (!item.purchase_order_id || !item.identity_verified_at) {
      throw hubAllocationError('HUB_PURCHASE_ALLOCATION_UNPROVEN', 'Allocation d’achat non prouvée : assignation physique interdite.', {
        inventory_item_id: inventoryItemId,
      });
    }
    if (
      item.purchase_status === 'cancelled' ||
      String(item.purchase_order_order_id || '') !== String(item.order_id) ||
      String(item.purchase_order_item_id || '') !== String(item.order_item_id)
    ) {
      throw hubAllocationError('HUB_PURCHASE_ALLOCATION_CONFLICT', 'La vérité Purchasing ne correspond plus à l’allocation physique.', {
        inventory_item_id: inventoryItemId,
        purchase_order_id: item.purchase_order_id,
      });
    }

    const parcel = await assertParcelCompatible(client, { parcelId, allocation: item });
    const matched = String(item.proposed_parcel_id || '') === String(parcel.id);

    const packing = await assignPhysicalAllocationToParcel(client, {
      parcelId: parcel.id,
      orderItemId: item.order_item_id,
      quantity: Number(item.quantity),
    });

    const { rows: [assigned] } = await client.query(`
      UPDATE inventory_items
         SET status = 'assigned',
             parcel_id = $2,
             proposed_parcel_id = NULL,
             assigned_at = NOW(),
             updated_at = NOW()
       WHERE id = $1
       RETURNING *
    `, [inventoryItemId, parcel.id]);

    const evidence = await recordHubAllocationScanEvent(client, {
      parcelId: parcel.id,
      orderId: item.order_id,
      inventoryItemId: item.id,
      orderItemId: item.order_item_id,
      purchaseOrderId: item.purchase_order_id,
      marketId: item.market_id,
      relaisId: item.relais_id,
      quantity: Number(item.quantity),
      scannedBy: scanned_by,
      matchedProposal: matched,
    });

    await updateOrderCompletion(item.order_id, client);

    return {
      assigned: true,
      item: assigned,
      matched_proposal: matched,
      parcel_ref: parcel.reference,
      parcel_item_id: packing.parcel_item_id,
      evidence_scan_event_id: evidence && evidence.id,
      message: matched
        ? '✅ Conforme à la proposition'
        : '✅ Colis compatible choisi — aucune vérité commerciale réassignée',
    };
  });
}

// ─── BULK PROPOSE ALL ────────────────────────────────────────────────────────
async function proposeAll() {
  const { rows: items } = await db.query(
    `SELECT id FROM inventory_items WHERE status IN ('received', 'buffered') ORDER BY received_at ASC`
  );
  const results = { proposed: 0, buffered: 0, errors: 0 };
  for (const item of items) {
    try {
      const r = await proposeAssignment(item.id);
      if (r?.status === 'proposed') results.proposed++;
      else results.buffered++;
    } catch (_) {
      results.errors++;
    }
  }
  return results;
}

// ─── DISPATCH DECISION ───────────────────────────────────────────────────────
async function shouldDispatch(orderId) {
  const { rows: [order] } = await db.query(
    `SELECT *, completion_ratio, items_received, items_total, deadline_dispatch FROM orders WHERE id = $1`,
    [orderId]
  );
  if (!order) throw new Error('Commande introuvable');

  const ratio = Number(order.completion_ratio || 0);
  const deadlinePassed = order.deadline_dispatch && new Date(order.deadline_dispatch) < new Date();

  if (ratio >= 1) return { decision: 'dispatch_full', reason: '100% articles reçus', ratio };
  if (deadlinePassed && ratio >= 0.5) return { decision: 'dispatch_partial', reason: `Deadline dépassée (${Math.round(ratio * 100)}%)`, ratio };
  if (deadlinePassed && ratio < 0.5) return { decision: 'wait_or_cancel', reason: `Deadline dépassée mais seulement ${Math.round(ratio * 100)}%`, ratio };
  return { decision: 'wait', reason: `${Math.round(ratio * 100)}% reçu — attente`, ratio };
}

// ─── STATS / KPI ─────────────────────────────────────────────────────────────
async function getStats() {
  const { rows: [s] } = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'received')::int AS received,
      COUNT(*) FILTER (WHERE status = 'proposed')::int AS proposed,
      COUNT(*) FILTER (WHERE status = 'assigned')::int AS assigned,
      COUNT(*) FILTER (WHERE status = 'buffered')::int AS buffered,
      COUNT(*) FILTER (WHERE status = 'buffered' AND buffer_until < NOW())::int AS overdue,
      COUNT(*) FILTER (WHERE purchase_order_id IS NULL OR identity_verified_at IS NULL)::int AS identity_unproven,
      ROUND(EXTRACT(EPOCH FROM AVG(
        CASE WHEN status = 'assigned' THEN assigned_at - received_at END
      )) / 60)::int AS avg_assign_minutes
    FROM inventory_items
  `);

  const { rows: [p] } = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE status IN ('draft','preparation'))::int AS open_parcels,
      COUNT(*) FILTER (WHERE status = 'shipped')::int AS shipped_parcels
    FROM parcels
  `);

  return { ...s, ...p };
}

// ─── LIST ITEMS WITH PROPOSALS ───────────────────────────────────────────────
async function listProposals() {
  const { rows } = await db.query(`
    SELECT ii.*,
           p.name AS product_name,
           o.reference AS order_ref,
           o.market_id,
           o.relais_id,
           r.name AS relais_name,
           pcl.reference AS proposed_parcel_ref,
           EXTRACT(EPOCH FROM (NOW() - ii.received_at)) / 60 AS wait_minutes
      FROM inventory_items ii
      JOIN order_items oi ON oi.id = ii.order_item_id
      JOIN products p ON p.id = oi.product_id
      JOIN orders o ON o.id = ii.order_id
      LEFT JOIN relais r ON r.id = o.relais_id
      LEFT JOIN parcels pcl ON pcl.id = ii.proposed_parcel_id
     WHERE ii.status IN ('received', 'proposed', 'buffered')
     ORDER BY
       CASE ii.status WHEN 'buffered' THEN 0 WHEN 'received' THEN 1 WHEN 'proposed' THEN 2 END,
       ii.received_at ASC
  `);
  return rows;
}

// ─── LIST OPEN MARKET PARCELS ────────────────────────────────────────────────
async function listOpenParcels() {
  const { rows } = await db.query(`
    SELECT p.id,
           p.reference,
           p.status,
           p.order_id,
           p.relais_id,
           r.name AS relais_name,
           r.market_id,
           (SELECT COUNT(*)::int FROM parcel_items pi WHERE pi.parcel_id = p.id) AS item_count
      FROM parcels p
      LEFT JOIN relais r ON r.id = p.relais_id
     WHERE p.status IN ('draft', 'preparation')
     ORDER BY p.created_at DESC
  `);
  return rows;
}

module.exports = {
  receiveItem,
  proposeAssignment,
  proposeAssignmentWithExecutor,
  proposeAll,
  scanIntoParcel,
  updateOrderCompletion,
  shouldDispatch,
  getStats,
  listProposals,
  listOpenParcels,
  BUFFER_DEFAULT_HOURS,
};
