/**
 * KOMERCE — Order Status Machine (services/order-status-machine.js) — v1.4 (pending status)
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  SINGLE SOURCE OF TRUTH for all order status transitions.          ║
 * ║  Architectural decisions D1/D2: every status change MUST go here.  ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * v1.4 — Ajout du statut 'pending' :
 *   - pending   = commande créée, en attente de paiement
 *   - confirmed = paiement reçu (cash OU Stripe), prêt pour CT
 *   - ordered   = commande passée chez le fournisseur
 *
 * Sources:
 *   'patch'  — Admin/agent manually changes status via PATCH
 *   'scan'   — Scan-triggered via parcelSync (forward-only, no role check)
 *   'system' — Auto-transition (wallet 100%)
 *   'stripe_webhook' — Webhook Stripe (pending → confirmed)
 *   'cash_confirm'   — Agent relais confirme cash (pending → confirmed)
 *
 * Guarantees (D6):
 *   - Every transition inserts into order_status_history
 *   - Timestamps are set ONCE (COALESCE — never overwritten)
 *   - Forward-only for scan/system (idempotent, never goes backward)
 */

'use strict';

const db = require('../db');
const { randomBytes } = require('crypto');

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const ORDER_STATUSES = Object.freeze([
  'pending',      // ← NOUVEAU: en attente de paiement
  'confirmed',    // paiement reçu, prêt pour CT
  'ordered', 'preparation', 'shipped', 'in_transit',
  'available', 'collected', 'cancelled', 'refunded',
]);

/** Rank for forward-only checks. Higher = further along. */
const STATUS_RANK = Object.freeze({
  pending:     0,   // ← NOUVEAU
  confirmed:   1,
  ordered:     2,
  preparation: 3,
  shipped:     4,
  in_transit:  5,
  available:   6,
  collected:   7,
  // cancelled/refunded are special — handled separately
});

/** Strict transition matrix (for 'patch' source). */
const VALID_TRANSITIONS = Object.freeze({
  pending:     ['confirmed', 'cancelled'],  // ← NOUVEAU
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
  confirmed:   ['admin', 'agent_relais', 'system'],  // ← NOUVEAU: paiement confirmé
  ordered:     ['admin', 'agent_hub'],
  preparation: ['admin', 'agent_hub'],
  shipped:     ['admin', 'agent_hub'],
  in_transit:  ['admin', 'agent_hub'],
  available:   ['admin', 'agent_relais'],
  collected:   ['admin', 'agent_relais'],
  cancelled:   ['admin'],
  refunded:    ['admin'],
});

/** Timestamp column for each status on orders table. */
const STATUS_TIMESTAMP = Object.freeze({
  pending:     'pending_at',     // ← NOUVEAU
  confirmed:   'confirmed_at',   // ← NOUVEAU (optionnel, à ajouter si besoin)
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
 * @param {string}      opts.orderId       — UUID of the order
 * @param {string}      opts.newStatus     — Target order_status
 * @param {object}      opts.actor         — { id, role } of who initiated (default: system)
 * @param {string}      opts.source        — 'patch' | 'scan' | 'system' | 'stripe_webhook' | 'cash_confirm'
 * @param {string|null} opts.scanId        — Scan UUID (for scan source)
 * @param {string|null} opts.note          — Optional note for history
 * @param {string|null} opts.cancelReason  — Reason for cancellation (set on orders.cancel_reason)
 * @param {object|null} opts.dbClient      — Transaction client (optional)
 * @returns {Promise<{success:boolean, previousStatus:string, newStatus:string, noop?:boolean, pickupCode?:string, cancelEffects?:object, error?:string}>}
 */
async function transitionOrderStatus({
  orderId,
  newStatus,
  actor = { id: null, role: 'system' },
  source = 'patch',
  scanId = null,
  note = null,
  cancelReason = null,
  dbClient = null,
}) {
  const q = dbClient || db;

  // ── 1. Load current order ────────────────────────────────────────────────
  const forUpdate = dbClient ? ' FOR UPDATE' : '';
  const { rows: [order] } = await q.query(
    `SELECT id, status, payment_mode, pickup_code FROM orders WHERE id = $1${forUpdate}`,
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

    // Special: agent_relais can only set 'confirmed' for cash_relais
    if (newStatus === 'confirmed' && actor.role === 'agent_relais' && order.payment_mode !== 'cash_relais') {
      return { success: false, error: "Agent relais: uniquement commandes cash relais" };
    }

  } else if (['stripe_webhook', 'cash_confirm', 'system'].includes(source)) {
    // Payment sources: only pending → confirmed allowed
    if (newStatus === 'confirmed' && previousStatus !== 'pending') {
      // Already confirmed or beyond — no-op
      return { success: true, previousStatus, newStatus: previousStatus, noop: true };
    }
    // For other transitions from these sources, use forward-only logic
    if (newStatus !== 'confirmed' && !isForwardTransition(previousStatus, newStatus)) {
      return { success: true, previousStatus, newStatus: previousStatus, noop: true };
    }
  } else {
    // scan/system: forward-only, no role check
    if (!isForwardTransition(previousStatus, newStatus)) {
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
    // Check if column exists before using COALESCE (pending_at/confirmed_at may not exist yet)
    if (['pending_at', 'confirmed_at'].includes(tsCol)) {
      // These columns may not exist in older schemas — skip silently
      // TODO: Add these columns in migration
    } else {
      setParts.push(`${tsCol} = COALESCE(${tsCol}, NOW())`);
    }
  }

  // Auto-generate pickup_code when → available
  let pickupCode = null;
  if (newStatus === 'available' && !order.pickup_code) {
    pickupCode = generatePickupCode();
    setParts.push(`pickup_code = $${paramIdx}`);
    values.push(pickupCode);
    paramIdx++;
  }

  // Cancel reason
  if (newStatus === 'cancelled' && cancelReason) {
    setParts.push(`cancel_reason = $${paramIdx}`);
    values.push(cancelReason);
    paramIdx++;
  }

  values.push(orderId);

  await q.query(
    `UPDATE orders SET ${setParts.join(', ')} WHERE id = $${paramIdx}`,
    values
  );

  // ── 5. Special: confirmed (paiement reçu) → set payment_status = 'paid' ──
  // Ceci remplace la logique qui était dans payments.js
  if (newStatus === 'confirmed' && ['stripe_webhook', 'cash_confirm', 'system'].includes(source)) {
    await q.query(
      `UPDATE orders SET payment_status = 'paid' WHERE id = $1`,
      [orderId]
    );
  }

  // ── 5b. Auto-effects: cancelled → wallet reversal + stock restore ────────
  let cancelEffects = null;

  if (newStatus === 'cancelled') {
    cancelEffects = { walletReversalAmount: 0, walletReversalTxId: null, stockItemsRestored: 0 };

    // Wallet reversal (idempotent via idempotency_key)
    const { rows: [orderInfo] } = await q.query(
      `SELECT wallet_applied_kmf, user_id, reference FROM orders WHERE id = $1`,
      [orderId]
    );
    const walletApplied = Number(orderInfo?.wallet_applied_kmf || 0);

    if (walletApplied > 0 && orderInfo.user_id) {
      const walletService = require('../services/wallet-service');
      try {
        const wResult = await walletService.removeFromOrder(q, { orderId });
        cancelEffects.walletReversalAmount = wResult.reversed_kmf;
        cancelEffects.walletReversalTxId = wResult.transaction?.id || null;
        console.log(`[STATUS-MACHINE] Wallet reversed: ${wResult.reversed_kmf} KMF → user ${orderInfo.user_id}`);
      } catch (e) {
        console.error('[STATUS-MACHINE] removeFromOrder failed:', e.message, '— credit fallback');
        try {
          const wResult = await walletService.credit(q, {
            userId:         orderInfo.user_id,
            amountKmf:      walletApplied,
            reason:         'order_cancel',
            referenceId:    orderId,
            idempotencyKey: `wallet_reversal_${orderId}`,
            note:           `Avoir wallet — annulation ${orderInfo.reference}`,
            createdBy:      actor.id,
          });
          cancelEffects.walletReversalAmount = walletApplied;
          cancelEffects.walletReversalTxId = wResult.transaction?.id || null;
        } catch (e2) {
          console.error('[STATUS-MACHINE] Wallet credit fallback also failed:', e2.message);
        }
      }
    }

    // Stock restore
    const { rows: items } = await q.query(
      'SELECT product_id, quantity FROM order_items WHERE order_id = $1',
      [orderId]
    );
    for (const item of items) {
      await q.query(
        'UPDATE products SET stock = stock + $1 WHERE id = $2',
        [item.quantity, item.product_id]
      );
    }
    cancelEffects.stockItemsRestored = items.length;
    if (items.length > 0) {
      console.log(`[STATUS-MACHINE] Stock restored: ${items.length} items for order ${orderId}`);
    }
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
    console.error(`[STATUS-MACHINE] ⚠️ History insert failed (order=${orderId}):`, histErr.message);
    throw histErr;
  }

  console.log(`[STATUS-MACHINE] ✅ order=${orderId} ${previousStatus} → ${newStatus} (source=${source})`);

  return { success: true, previousStatus, newStatus, pickupCode, cancelEffects };
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
