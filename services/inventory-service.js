/**
 * ═══════════════════════════════════════════════════════════════
 * INVENTORY SERVICE v2 — Hub article management + PROPOSITIONS
 * ═══════════════════════════════════════════════════════════════
 *
 * Flow: receive → propose (auto) → agent confirms/reassigns → assigned
 *
 * Statuts inventory_item:
 *   received  → article scanné au hub
 *   proposed  → moteur a proposé un colis (proposed_parcel_id)
 *   assigned  → agent a confirmé (ou auto-confirm après délai)
 *   buffered  → pas de colis compatible, en attente
 *   cancelled → annulé
 *
 * ⚠️ Le moteur PROPOSE, l'agent PEUT modifier, mais ça ne bloque JAMAIS.
 *    Si l'agent ne fait rien, la proposition reste en "proposed" jusqu'à
 *    auto-confirm (configurable) ou validation manuelle bulk.
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

const db = require('../db');
const { v4: uuidv4 } = require('uuid');

// Config
const AUTO_CONFIRM_HOURS = 4; // Propositions auto-confirmées après 4h
const BUFFER_DEFAULT_HOURS = 12;

// ════════════════════════════════════════════════════════════════
// 1. RECEIVE ARTICLE
// ════════════════════════════════════════════════════════════════

async function receiveItem({ order_item_id, quantity = 1, received_by = null, notes = null }) {
  const { rows: [oi] } = await db.query(
    `SELECT oi.id, oi.order_id, oi.product_id, oi.quantity AS ordered_qty,
            o.destination_island, o.status AS order_status
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE oi.id = $1`,
    [order_item_id]
  );

  if (!oi) throw new Error('order_item introuvable: ' + order_item_id);

  const id = uuidv4();
  const { rows: [item] } = await db.query(`
    INSERT INTO inventory_items (id, order_item_id, order_id, product_id, quantity, status, received_by, notes)
    VALUES ($1, $2, $3, $4, $5, 'received', $6, $7)
    RETURNING *
  `, [id, order_item_id, oi.order_id, oi.product_id, quantity, received_by, notes]);

  // Auto-propose assignment
  const proposal = await proposeAssignment(id);

  // Update order completion
  await updateOrderCompletion(oi.order_id);

  console.log(`[INVENTORY] ✅ Received ${quantity}x item → ${proposal.status}`);
  return { ...item, proposal };
}

// ════════════════════════════════════════════════════════════════
// 2. PROPOSE ASSIGNMENT (MOTEUR)
// ════════════════════════════════════════════════════════════════

/**
 * Le moteur cherche le meilleur colis compatible et PROPOSE l'assignation.
 * L'agent verra la proposition dans le dashboard et pourra modifier.
 * Rien n'est bloqué — le statut passe à "proposed" ou "buffered".
 */
async function proposeAssignment(inventoryItemId) {
  const { rows: [item] } = await db.query(
    `SELECT ii.*, o.destination_island, o.id AS order_id
     FROM inventory_items ii
     JOIN orders o ON o.id = ii.order_id
     WHERE ii.id = $1 AND ii.status IN ('received', 'buffered')`,
    [inventoryItemId]
  );

  if (!item) throw new Error('Item introuvable ou déjà assigné/proposé');

  // Chercher colis ouverts compatibles (même destination, même commande d'abord, puis autre)
  const { rows: parcels } = await db.query(`
    SELECT p.id, p.reference, p.order_id,
           CASE WHEN p.order_id = $2 THEN 0 ELSE 1 END AS priority,
           (SELECT COUNT(*)::int FROM parcel_items pi WHERE pi.parcel_id = p.id) AS item_count
    FROM parcels p
    JOIN orders o ON o.id = p.order_id
    WHERE o.destination_island = $1
      AND p.status IN ('draft', 'preparation')
    ORDER BY priority ASC, item_count ASC, p.created_at ASC
    LIMIT 5
  `, [item.destination_island, item.order_id]);

  if (parcels.length > 0) {
    const bestParcel = parcels[0];
    await db.query(`
      UPDATE inventory_items 
      SET status = 'proposed', proposed_parcel_id = $2, proposed_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [inventoryItemId, bestParcel.id]);

    return { status: 'proposed', proposed_parcel_id: bestParcel.id, proposed_parcel_ref: bestParcel.reference, alternatives: parcels.slice(1) };
  }

  // Pas de colis compatible → buffer
  const bufferUntil = new Date(Date.now() + BUFFER_DEFAULT_HOURS * 60 * 60 * 1000);
  await db.query(`
    UPDATE inventory_items 
    SET status = 'buffered', buffer_reason = 'no_compatible_parcel', buffer_until = $2, updated_at = NOW()
    WHERE id = $1
  `, [inventoryItemId, bufferUntil]);

  return { status: 'buffered', buffer_reason: 'no_compatible_parcel', buffer_until: bufferUntil };
}

/**
 * Bulk propose: re-calcule les propositions pour tous les items received/buffered.
 * Utile quand un nouveau colis est créé.
 */
async function proposeAll() {
  const { rows: items } = await db.query(
    `SELECT id FROM inventory_items WHERE status IN ('received', 'buffered') ORDER BY received_at ASC`
  );

  const results = { proposed: 0, buffered: 0, errors: 0 };
  for (const item of items) {
    try {
      const r = await proposeAssignment(item.id);
      results[r.status === 'proposed' ? 'proposed' : 'buffered']++;
    } catch (e) {
      results.errors++;
    }
  }
  console.log(`[INVENTORY] 🔄 Bulk propose: ${results.proposed} proposed, ${results.buffered} buffered, ${results.errors} errors`);
  return results;
}

// ════════════════════════════════════════════════════════════════
// 3. CONFIRM / REASSIGN / REJECT (AGENT)
// ════════════════════════════════════════════════════════════════

/**
 * Confirmer la proposition du moteur (ou auto-confirm).
 */
async function confirmProposal(inventoryItemId) {
  const { rows: [item] } = await db.query(
    `SELECT * FROM inventory_items WHERE id = $1 AND status = 'proposed'`,
    [inventoryItemId]
  );
  if (!item) throw new Error('Pas de proposition en attente pour cet item');

  await db.query(`
    UPDATE inventory_items 
    SET status = 'assigned', parcel_id = proposed_parcel_id, assigned_at = NOW(), updated_at = NOW()
    WHERE id = $1
  `, [inventoryItemId]);

  console.log(`[INVENTORY] ✅ Proposal confirmed: ${inventoryItemId} → parcel ${item.proposed_parcel_id}`);
  return { confirmed: true, parcel_id: item.proposed_parcel_id };
}

/**
 * Réassigner un item à un autre colis (l'agent override le moteur).
 */
async function reassignItem(inventoryItemId, newParcelId) {
  const { rows: [parcel] } = await db.query(
    `SELECT id, reference FROM parcels WHERE id = $1 AND status IN ('draft', 'preparation')`,
    [newParcelId]
  );
  if (!parcel) throw new Error('Colis introuvable ou fermé');

  await db.query(`
    UPDATE inventory_items 
    SET status = 'assigned', parcel_id = $2, proposed_parcel_id = $2, assigned_at = NOW(), updated_at = NOW()
    WHERE id = $1
  `, [inventoryItemId, newParcelId]);

  console.log(`[INVENTORY] 🔄 Reassigned: ${inventoryItemId} → parcel ${parcel.reference}`);
  return { reassigned: true, parcel_id: newParcelId, parcel_ref: parcel.reference };
}

/**
 * Confirmer toutes les propositions en attente (bulk).
 */
async function confirmAllProposals() {
  const { rowCount } = await db.query(`
    UPDATE inventory_items 
    SET status = 'assigned', parcel_id = proposed_parcel_id, assigned_at = NOW(), updated_at = NOW()
    WHERE status = 'proposed'
  `);

  console.log(`[INVENTORY] ✅ Bulk confirmed: ${rowCount} items`);
  return { confirmed: rowCount };
}

/**
 * Auto-confirm propositions plus vieilles que AUTO_CONFIRM_HOURS.
 * Appelé par un cron ou manuellement. Non-bloquant.
 */
async function autoConfirmExpired() {
  const { rowCount } = await db.query(`
    UPDATE inventory_items 
    SET status = 'assigned', parcel_id = proposed_parcel_id, assigned_at = NOW(), updated_at = NOW()
    WHERE status = 'proposed' 
      AND proposed_at < NOW() - INTERVAL '${AUTO_CONFIRM_HOURS} hours'
  `);

  if (rowCount > 0) console.log(`[INVENTORY] ⏰ Auto-confirmed ${rowCount} expired proposals`);
  return { auto_confirmed: rowCount };
}

// ════════════════════════════════════════════════════════════════
// 4. GET PROPOSALS (DASHBOARD)
// ════════════════════════════════════════════════════════════════

/**
 * Liste toutes les propositions en attente avec détails pour le dashboard.
 */
async function getProposals() {
  const { rows } = await db.query(`
    SELECT ii.id, ii.order_item_id, ii.order_id, ii.product_id, ii.quantity,
           ii.status, ii.proposed_parcel_id, ii.proposed_at,
           ii.received_at, ii.notes,
           o.reference AS order_ref, o.destination_island,
           p.name AS product_name, p.image_url AS product_image,
           pcl.reference AS proposed_parcel_ref,
           EXTRACT(EPOCH FROM (NOW() - ii.proposed_at)) / 3600 AS hours_since_proposal
    FROM inventory_items ii
    LEFT JOIN orders o ON o.id = ii.order_id
    LEFT JOIN products p ON p.id = ii.product_id
    LEFT JOIN parcels pcl ON pcl.id = ii.proposed_parcel_id
    WHERE ii.status = 'proposed'
    ORDER BY ii.proposed_at ASC
  `);
  return rows;
}

/**
 * Liste les colis ouverts compatibles pour un item (pour le dropdown reassign).
 */
async function getCompatibleParcels(inventoryItemId) {
  const { rows: [item] } = await db.query(
    `SELECT ii.*, o.destination_island FROM inventory_items ii JOIN orders o ON o.id = ii.order_id WHERE ii.id = $1`,
    [inventoryItemId]
  );
  if (!item) throw new Error('Item introuvable');

  const { rows } = await db.query(`
    SELECT p.id, p.reference, p.status,
           o.reference AS order_ref, o.destination_island,
           (SELECT COUNT(*)::int FROM parcel_items pi WHERE pi.parcel_id = p.id) AS item_count,
           CASE WHEN p.order_id = $2 THEN '✅ même commande' ELSE '📦 autre commande' END AS match_type
    FROM parcels p
    JOIN orders o ON o.id = p.order_id
    WHERE o.destination_island = $1
      AND p.status IN ('draft', 'preparation')
    ORDER BY 
      CASE WHEN p.order_id = $2 THEN 0 ELSE 1 END ASC,
      p.created_at ASC
  `, [item.destination_island, item.order_id]);

  return rows;
}

// ════════════════════════════════════════════════════════════════
// 5. BUFFER MANAGEMENT
// ════════════════════════════════════════════════════════════════

async function bufferItem(inventoryItemId, reason, bufferUntilHours = BUFFER_DEFAULT_HOURS) {
  const bufferUntil = new Date(Date.now() + bufferUntilHours * 60 * 60 * 1000);
  
  await db.query(`
    UPDATE inventory_items 
    SET status = 'buffered', buffer_reason = $2, buffer_until = $3, updated_at = NOW()
    WHERE id = $1
  `, [inventoryItemId, reason, bufferUntil]);

  return { buffered: true, buffer_until: bufferUntil };
}

async function getBufferItems() {
  const { rows } = await db.query(`
    SELECT ii.*, 
           o.reference AS order_ref, o.destination_island,
           p.name AS product_name,
           u.full_name AS received_by_name,
           EXTRACT(EPOCH FROM (NOW() - ii.received_at)) / 3600 AS hours_in_buffer,
           ii.buffer_until < NOW() AS deadline_passed
    FROM inventory_items ii
    LEFT JOIN orders o ON o.id = ii.order_id
    LEFT JOIN products p ON p.id = ii.product_id
    LEFT JOIN users u ON u.id = ii.received_by
    WHERE ii.status = 'buffered'
    ORDER BY ii.buffer_until ASC
  `);
  return rows;
}

// ════════════════════════════════════════════════════════════════
// 6. ORDER COMPLETION TRACKING
// ════════════════════════════════════════════════════════════════

async function updateOrderCompletion(orderId) {
  const { rows: [stats] } = await db.query(`
    SELECT 
      COALESCE(SUM(oi.quantity), 0)::int AS items_total,
      COALESCE(SUM(LEAST(
        COALESCE((SELECT SUM(ii.quantity) FROM inventory_items ii WHERE ii.order_item_id = oi.id AND ii.status NOT IN ('cancelled')), 0),
        oi.quantity
      )), 0)::int AS items_received
    FROM order_items oi
    WHERE oi.order_id = $1
  `, [orderId]);

  const total = stats.items_total || 0;
  const received = stats.items_received || 0;
  const ratio = total > 0 ? Math.min(received / total, 1.0) : 0;

  await db.query(`
    UPDATE orders 
    SET completion_ratio = $2, items_received = $3, items_total = $4, updated_at = NOW()
    WHERE id = $1
  `, [orderId, ratio, received, total]);

  return { orderId, completion_ratio: ratio, items_received: received, items_total: total };
}

// ════════════════════════════════════════════════════════════════
// 7. DISPATCH DECISION
// ════════════════════════════════════════════════════════════════

async function shouldDispatchOrder(orderId) {
  const { rows: [order] } = await db.query(`
    SELECT id, reference, completion_ratio, items_received, items_total, 
           deadline_dispatch, destination_island, status
    FROM orders WHERE id = $1
  `, [orderId]);

  if (!order) throw new Error('Commande introuvable');

  if (order.completion_ratio >= 1.0) {
    return { should_dispatch: true, reason: 'complete', completion_ratio: order.completion_ratio };
  }

  if (order.deadline_dispatch && new Date(order.deadline_dispatch) < new Date()) {
    return { should_dispatch: true, reason: 'deadline_passed', completion_ratio: order.completion_ratio };
  }

  const { rows: [pressure] } = await db.query(`
    SELECT COUNT(*)::int AS buffered_count
    FROM inventory_items ii
    JOIN orders o ON o.id = ii.order_id
    WHERE o.destination_island = $1 AND ii.status = 'buffered'
  `, [order.destination_island]);

  if (pressure.buffered_count > 10) {
    return { should_dispatch: true, reason: 'buffer_pressure', completion_ratio: order.completion_ratio, buffered_count: pressure.buffered_count };
  }

  return { should_dispatch: false, reason: 'waiting', completion_ratio: order.completion_ratio };
}

// ════════════════════════════════════════════════════════════════
// 8. HUB STATS / KPI
// ════════════════════════════════════════════════════════════════

async function getHubStats() {
  const { rows: [stats] } = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM inventory_items WHERE status = 'received') AS items_received,
      (SELECT COUNT(*)::int FROM inventory_items WHERE status = 'proposed') AS items_proposed,
      (SELECT COUNT(*)::int FROM inventory_items WHERE status = 'assigned') AS items_assigned,
      (SELECT COUNT(*)::int FROM inventory_items WHERE status = 'buffered') AS items_buffered,
      (SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - received_at)) / 3600), 0)::numeric(10,1)
       FROM inventory_items WHERE status = 'buffered') AS avg_buffer_hours,
      (SELECT COUNT(*)::int FROM parcels WHERE status IN ('draft', 'preparation')) AS open_parcels,
      (SELECT COUNT(*)::int FROM orders 
       WHERE completion_ratio > 0 AND completion_ratio < 1 
         AND status NOT IN ('cancelled', 'refunded', 'collected')) AS partial_orders,
      (SELECT COUNT(*)::int FROM inventory_items 
       WHERE status = 'buffered' AND buffer_until < NOW()) AS overdue_buffer
  `);
  return stats;
}

module.exports = {
  receiveItem,
  proposeAssignment,
  proposeAll,
  confirmProposal,
  reassignItem,
  confirmAllProposals,
  autoConfirmExpired,
  getProposals,
  getCompatibleParcels,
  bufferItem,
  getBufferItems,
  updateOrderCompletion,
  shouldDispatchOrder,
  getHubStats,
};
