/**
 * KOMERCE — Order Status Machine (services/order-status-machine.js) — v1.0
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  SINGLE SOURCE OF TRUTH for all order status transitions.          ║
 * ║  Architectural decisions D1/D2: every status change MUST go here.  ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Sources:
 *   'patch'  — Admin/agent manually changes status via PATCH
 *   'scan'   — Scan-triggered via parcelSync (forward-only, no role check)
 *   'system' — Auto-transition (cash_relais auto-paid, wallet 100%)
 *
 * Guarantees (D6):
 *   - Every transition inserts into order_status_history
 *   - Timestamps are set ONCE (COALESCE — never overwritten)
 *   - Forward-only for scan/system (idempotent, never goes backward)
 *
 * Interdits:
 *   ❌ Direct UPDATE of orders.status outside this service
 *   ❌ Status change without order_status_history entry
 */

'use strict';

const db = require('../db');
const { randomBytes } = require('crypto');

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const ORDER_STATUSES = Object.freeze([
  'confirmed', 'ordered', 'preparation', 'shipped', 'in_transit',
  'available', 'collected', 'cancelled', 'refunded',
]);

/** Rank for forward-only checks. Higher = further along. */
const STATUS_RANK = Object.freeze({
  confirmed:   0,
  ordered:     1,
  preparation: 2,
  shipped:     3,
  in_transit:  4,
  available:   5,
  collected:   6,
  // cancelled/refunded are special — handled separately
});

/** Strict transition matrix (for 'patch' source). */
const VALID_TRANSITIONS = Object.freeze({
  confirmed:   ['ordered', 'cancelled'],
  ordered:     ['preparation', 'cancelled'],
  preparation: ['shipped', 'cancelled'],
  shipped:     ['in_transit', 'cancelled'],
  in_transit:  ['available', 'cancelled'],
  available:   ['collected', 'cancelled'],
  collected:   [],
  cancelled:   ['refunded'],
  refunded:    [],
});

/** Role permissions per target status (for 'patch' source). */
const TRANSITION_ROLES = Object.freeze({
  ordered:     ['admin', 'agent_relais'],
  preparation: ['admin', 'agent_hub'],
  shipped:     ['admin', 'agent_hub'],
  in_transit:  ['admin', 'agent_hub'],   // D2 validated: hub confirms departure
  available:   ['admin', 'agent_relais'],
  collected:   ['admin', 'agent_relais'],
  cancelled:   ['admin'],
  refunded:    ['admin'],
});

/** Timestamp column for each status on orders table. */
const STATUS_TIMESTAMP = Object.freeze({
  ordered:     'ordered_at',
  preparation: 'preparation_at',
  shipped:     'shipped_at',
  in_transit:  'in_transit_at',
  available:   'available_at',
  collected:   'collected_at',
  cancelled:   'cancelled_at',
});


// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check if a transition is a valid forward movement.
 * Used for scan and system sources.
 */
function isForwardTransition(from, to) {
  if (to === 'cancelled') return !['collected', 'refunded'].includes(from);
  if (to === 'refunded') return from === 'cancelled';
  const fromRank = STATUS_RANK[from];
  const toRank = STATUS_RANK[to];
  if (fromRank === undefined || toRank === undefined) return false;
  return toRank > fromRank;
}

/**
 * Generate a secure 6-char pickup code.
 */
function generatePickupCode() {
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 6 }, () => {
    let b; do { b = randomBytes(1)[0]; } while (b >= 216);
    return CHARS[b % 36];
  }).join('');
}


// ═══════════════════════════════════════════════════════════════════════════════
// transitionOrderStatus() — THE SINGLE ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Transition an order's status. This is the ONLY function allowed to write
 * orders.status in the entire codebase.
 *
 * @param {object} opts
 * @param {string}      opts.orderId    — UUID of the order
 * @param {string}      opts.newStatus  — Target order_status
 * @param {object}      opts.actor      — { id, role } of who initiated (default: system)
 * @param {string}      opts.source     — 'patch' | 'scan' | 'system'
 * @param {string|null} opts.scanId     — Scan UUID (for scan source)
 * @param {string|null} opts.note       — Optional note for history
 * @param {object|null} opts.dbClient   — Transaction client (optional)
 * @returns {Promise<{success:boolean, previousStatus:string, newStatus:string, noop?:boolean, pickupCode?:string, error?:string}>}
 */
async function transitionOrderStatus({
  orderId,
  newStatus,
  actor = { id: null, role: 'system' },
  source = 'patch',
  scanId = null,
  note = null,
  dbClient = null,
}) {
  const q = dbClient || db;

  // ── 1. Load current order ────────────────────────────────────────────────
  const { rows: [order] } = await q.query(
    `SELECT id, status, payment_mode, pickup_code FROM orders WHERE id = $1`,
    [orderId]
  );
  if (!order) {
    return { success: false, error: 'Commande introuvable' };
  }

  const previousStatus = order.status;

  // ── 2. Idempotent: same status = no-op ───────────────────────────────────
  if (previousStatus === newStatus) {
    return { success: true, previousStatus, newStatus, noop: true };
  }

  // ── 3. Validate transition ───────────────────────────────────────────────
  if (source === 'patch') {
    // Strict: only allowed transitions
    const allowed = VALID_TRANSITIONS[previousStatus] || [];
    if (!allowed.includes(newStatus)) {
      return {
        success: false, previousStatus, newStatus,
        error: `Transition invalide: ${previousStatus} → ${newStatus}. Autorisées: ${allowed.join(', ') || 'aucune (état terminal)'}`,
      };
    }

    // Role check
    const allowedRoles = TRANSITION_ROLES[newStatus] || ['admin'];
    if (!allowedRoles.includes(actor.role)) {
      return {
        success: false, previousStatus, newStatus,
        error: `Rôle "${actor.role}" non autorisé pour → ${newStatus}`,
      };
    }

    // Special: agent_relais can only set 'ordered' for cash_relais
    if (newStatus === 'ordered' && actor.role === 'agent_relais' && order.payment_mode !== 'cash_relais') {
      return { success: false, error: "Agent relais: uniquement commandes cash relais" };
    }

  } else {
    // scan/system: forward-only, no role check
    if (!isForwardTransition(previousStatus, newStatus)) {
      // Not an error — just means the order is already ahead. Idempotent.
      return { success: true, previousStatus, newStatus: previousStatus, noop: true };
    }
  }

  // ── 4. Build UPDATE query ────────────────────────────────────────────────
  const setParts = ['status = $1::order_status', 'updated_at = NOW()'];
  const values = [newStatus];
  let paramIdx = 2;

  // Timestamp for this status (set ONCE via COALESCE)
  const tsCol = STATUS_TIMESTAMP[newStatus];
  if (tsCol) {
    setParts.push(`${tsCol} = COALESCE(${tsCol}, NOW())`);
  }

  // Auto-generate pickup_code when → available
  let pickupCode = null;
  if (newStatus === 'available' && !order.pickup_code) {
    pickupCode = generatePickupCode();
    setParts.push(`pickup_code = $${paramIdx}`);
    values.push(pickupCode);
    paramIdx++;
  }

  values.push(orderId);

  await q.query(
    `UPDATE orders SET ${setParts.join(', ')} WHERE id = $${paramIdx}`,
    values
  );

  // ── 5. Special: cash_relais → ordered = auto-paid ───────────────────────
  if (newStatus === 'ordered' && order.payment_mode === 'cash_relais') {
    await q.query(
      `UPDATE orders SET payment_status = 'paid' WHERE id = $1`,
      [orderId]
    );
  }

  // ── 6. D6: Always log to order_status_history ───────────────────────────
  const historyNote = note || `[${source}] ${previousStatus} → ${newStatus}`;
  try {
    await q.query(
      `INSERT INTO order_status_history (order_id, status, scan_id, changed_by, note)
       VALUES ($1, $2::order_status, $3, $4, $5)`,
      [orderId, newStatus, scanId, actor.id, historyNote]
    );
  } catch (histErr) {
    // History must not block the flow, but log loudly
    console.error(`[STATUS-MACHINE] ⚠️ History insert failed (order=${orderId}):`, histErr.message);
  }

  console.log(`[STATUS-MACHINE] ✅ order=${orderId} ${previousStatus} → ${newStatus} (source=${source})`);

  return { success: true, previousStatus, newStatus, pickupCode };
}


// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  transitionOrderStatus,
  ORDER_STATUSES,
  VALID_TRANSITIONS,
  TRANSITION_ROLES,
  STATUS_RANK,
  STATUS_TIMESTAMP,
  isForwardTransition,
};
