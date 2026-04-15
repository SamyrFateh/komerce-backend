/**
 * Simulator State Advancer — exécute les transitions via les vraies fonctions backend
 * Utilise transitionOrderStatus() (state machine SSOT) — jamais d'écriture directe sur orders.status
 */
'use strict';

const db = require('../../db');
const { transitionOrderStatus } = require('../../services/order-status-machine');

const SIM_ACTOR = { id: null, role: 'simulator' };

async function execute(orderId, tracked, action) {
  if (action.action === 'wait') {
    return { success: true, from: tracked.currentStatus, to: tracked.currentStatus, action: 'wait' };
  }
  if (action.action === 'log_only') {
    return { success: true, from: tracked.currentStatus, to: tracked.currentStatus, action: 'log_only' };
  }

  switch (action.action) {
    case 'confirm_payment':
      return await confirmPayment(orderId, tracked);
    case 'create_parcel':
      return await createParcel(orderId, tracked);
    case 'ship':
      return await scanAdvance(orderId, tracked, 'shipped');
    case 'transit':
      return await scanAdvance(orderId, tracked, 'in_transit');
    case 'arrive':
      return await scanAdvance(orderId, tracked, 'available');
    case 'collect':
      return await scanAdvance(orderId, tracked, 'collected');
    case 'cancel':
      return await cancelOrder(orderId, tracked);
    default:
      return { success: false, error: 'Action inconnue: ' + action.action };
  }
}

// ── Confirm Payment (cash) ──────────────────────────────────

async function confirmPayment(orderId, tracked) {
  const { rows } = await db.query('SELECT status, payment_mode, payment_status FROM orders WHERE id = $1', [orderId]);
  if (!rows.length) return { success: false, error: 'Commande introuvable' };
  const order = rows[0];
  const from = order.status;

  // Already confirmed/ordered? Skip
  if (['confirmed', 'ordered', 'preparation', 'shipped', 'in_transit', 'available', 'collected'].includes(order.status)) {
    return { success: true, from, to: order.status, action: 'already_past_pending' };
  }

  // Mark as paid
  await db.query("UPDATE orders SET payment_status = 'paid', updated_at = NOW() WHERE id = $1", [orderId]);

  // Transition pending → confirmed via state machine
  const r1 = await transitionOrderStatus({ orderId, newStatus: 'confirmed', actor: SIM_ACTOR, source: 'simulator' });
  if (!r1.success) return { success: false, from, to: from, error: 'pending→confirmed: ' + (r1.error || 'transition refusée') };

  // Then confirmed → ordered
  const r2 = await transitionOrderStatus({ orderId, newStatus: 'ordered', actor: SIM_ACTOR, source: 'simulator' });
  if (!r2.success) {
    // OK — at least confirmed
    return { success: true, from, to: 'confirmed', action: 'confirm_only' };
  }

  return { success: true, from, to: 'ordered', action: 'confirm_payment' };
}

// ── Create Parcel ───────────────────────────────────────────

async function createParcel(orderId, tracked) {
  const { rows } = await db.query('SELECT id, status, reference FROM orders WHERE id = $1', [orderId]);
  if (!rows.length) return { success: false, error: 'Commande introuvable' };
  const order = rows[0];
  const from = order.status;

  // Check if parcel already exists
  const { rows: existingParcels } = await db.query(
    "SELECT id FROM parcels WHERE order_id = $1 AND status != 'cancelled'", [orderId]
  );

  if (existingParcels.length === 0) {
    // Generate parcel reference
    const year = new Date().getFullYear();
    const { rows: [{ max_seq }] } = await db.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(reference FROM 'PCL-\\d{4}-(\\d+)') AS INT)), 0) AS max_seq
       FROM parcels WHERE reference LIKE $1`, [`PCL-${year}-%`]
    );
    const seq = (max_seq || 0) + 1;
    const reference = `PCL-${year}-${String(seq).padStart(4, '0')}`;

    // Get order items
    const { rows: items } = await db.query('SELECT id, quantity FROM order_items WHERE order_id = $1', [orderId]);

    // Create parcel
    const { rows: [parcel] } = await db.query(
      `INSERT INTO parcels (reference, order_id, type, notes, status, created_at)
       VALUES ($1, $2, 'standard', 'Créé par simulateur', 'preparation', NOW()) RETURNING id`,
      [reference, orderId]
    );

    // Assign all items to parcel
    for (const item of items) {
      await db.query(
        'INSERT INTO parcel_items (parcel_id, order_item_id, quantity) VALUES ($1, $2, $3)',
        [parcel.id, item.id, item.quantity]
      ).catch(function() { /* ignore dup */ });
    }
  }

  // Transition order → preparation via state machine
  if (['confirmed', 'ordered'].includes(order.status)) {
    const r = await transitionOrderStatus({ orderId, newStatus: 'preparation', actor: SIM_ACTOR, source: 'simulator' });
    if (!r.success) return { success: false, from, to: from, error: 'create_parcel: ' + (r.error || 'transition refusée') };
  }

  return { success: true, from, to: 'preparation', action: 'create_parcel' };
}

// ── Scan Advance (shipped, in_transit, available, collected) ─

async function scanAdvance(orderId, tracked, targetStep) {
  const { rows } = await db.query('SELECT status FROM orders WHERE id = $1', [orderId]);
  if (!rows.length) return { success: false, error: 'Commande introuvable' };
  const from = rows[0].status;

  // Get parcel for this order
  const { rows: parcels } = await db.query(
    "SELECT id, reference FROM parcels WHERE order_id = $1 AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1",
    [orderId]
  );
  if (!parcels.length) return { success: false, from, to: from, error: 'Pas de colis — impossible de scanner ' + targetStep };

  const parcel = parcels[0];

  try {
    // 1. Update parcel status
    await db.query("UPDATE parcels SET status = $1, updated_at = NOW() WHERE id = $2", [targetStep, parcel.id]);

    // 2. Insert scan record
    await db.query(
      "INSERT INTO scans (parcel_id, step, notes, created_at) VALUES ($1, $2, $3, NOW())",
      [parcel.id, targetStep, 'Simulateur — ' + targetStep]
    ).catch(function(e) { console.warn('[SIM] scan insert:', e.message); });

    // 3. Transition order status via state machine (SSOT)
    const result = await transitionOrderStatus({
      orderId,
      newStatus: targetStep,
      actor: SIM_ACTOR,
      source: 'simulator',
    });

    if (!result.success) {
      return { success: false, from, to: from, error: targetStep + ': ' + (result.error || 'transition refusée') };
    }

    return { success: true, from, to: targetStep, action: 'scan_' + targetStep };
  } catch (e) {
    return { success: false, from, to: from, error: targetStep + ': ' + e.message };
  }
}

// ── Cancel Order ────────────────────────────────────────────

async function cancelOrder(orderId, tracked) {
  const { rows } = await db.query('SELECT status FROM orders WHERE id = $1', [orderId]);
  if (!rows.length) return { success: false, error: 'Commande introuvable' };
  const from = rows[0].status;

  const result = await transitionOrderStatus({
    orderId,
    newStatus: 'cancelled',
    actor: SIM_ACTOR,
    source: 'simulator',
  });

  if (!result.success) return { success: false, from, to: from, error: 'cancel: ' + (result.error || 'transition refusée') };
  return { success: true, from, to: 'cancelled', action: 'cancel' };
}

module.exports = { execute };
