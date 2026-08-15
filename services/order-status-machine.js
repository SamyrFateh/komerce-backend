/**
 * @komerce-arch
 * @role          order-status-state-machine
 * @domain        orders
 * @layer         machine
 * @criticality   critical
 * @inputs        order_id, current_status, target_status, actor, reason
 * @outputs       validated_transition, order_history, side_effects
 * @depends       db.js, services/client-notification-service.js
 * @used-by       order-payment-confirmation.js, routes/orders.js, cancellation-flows, admin-flows
 * @db-read       order_items, orders, products, relais
 * @db-write      order_items, order_status_history, orders
 * @db-write-via:product-admin-service products, product_variants
 * @db-txn        single_status_transition_gate, append_history_before_side_effects
 * @doctrine      status_transition_source_unique, payment_to_stock_single_entry, annulation_tracee
 * @impact-areas  orders, payments, stock, wallet, sourcing, notifications, dashboards
 * @version       2026-06
 */

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
 *   'system' — Auto-transition (wallet 100%, auto-ordered after payment)
 *   'stripe_webhook' — Webhook Stripe (pending → confirmed)
 *   'cash_confirm'   — Agent relais confirme cash (pending → confirmed)
 *   'wallet_full_payment' — Wallet couvre 100% de la commande (pending → confirmed)
 *   'paypal_capture' — Capture PayPal confirmée (pending → confirmed) — migration 079
 *
 * Guarantees (D6):
 *   - Every transition inserts into order_status_history
 *   - Timestamps are set ONCE (COALESCE — never overwritten)
 *   - Forward-only for scan/system (idempotent, never goes backward)
 */

'use strict';

const db = require('../db');
const log = require('../utils/logger').child({ module: 'order-status-machine' });
const { adjustStock } = require('./product-admin-service');
const { sourceStatusesFor, sqlGuard } = require('./payment-status-validator');
const clientNotifications = require('./client-notification-service');

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const ORDER_STATUSES = Object.freeze([
  'pending',               // en attente de paiement
  'confirmed',             // paiement reçu, prêt pour CT
  'ordered', 'preparation', 'shipped', 'in_transit',
  'available', 'collected', 'cancelled', 'refunded',
]);

/** Rank for forward-only checks. Higher = further along. */
const STATUS_RANK = Object.freeze({
  pending:     0,
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
  pending:     ['confirmed', 'cancelled'],
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
  pending: ['admin', 'system'],
  confirmed:   ['admin', 'agent_relais', 'system'],  // paiement confirmé
  ordered:     ['admin', 'agent_hub'],
  preparation: ['admin', 'agent_hub'],
  shipped:     ['admin', 'agent_hub'],
  in_transit:  ['admin', 'agent_hub', 'agent_transitaire'],
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
 * @param {string}      opts.source        — Source de la transition :
 *   - 'patch'          : mutation admin directe (role check VALID_ROLES_PER_STATUS)
 *   - 'scan'           : scan terrain via scan-engine ou parcelSync (forward-only via isForwardTransition)
 *   - 'system'         : déclenchement interne (cron, webhook, machine) — même branche que 'scan'
 *   - 'stripe_webhook' : confirmation Stripe automatique
 *   - 'cash_confirm'   : confirmation cash agent
 *   - 'cancel'         : annulation via routes/orders/cancel.js — utilise la branche isForwardTransition
 *                        (cancelled est un mouvement forward depuis la plupart des statuts).
 *                        Le contrôle d'accès est géré dans cancel.js (requireAdmin ou cutoff_status).
 *                        NE PAS copier ce pattern sans ajouter un contrôle d'accès explicite côté route.
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
  const forUpdate = dbClient ? ' FOR UPDATE OF o' : '';
  const { rows: [order] } = await q.query(
    `SELECT o.id, o.status, o.payment_mode, o.relais_id, o.pickup_secret_hash,
            o.user_id, o.reference, r.name AS relais_name
       FROM orders o
       LEFT JOIN relais r ON r.id = o.relais_id
      WHERE o.id = $1${forUpdate}`,
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

  } else if (['stripe_webhook', 'cash_confirm', 'wallet_full_payment', 'paypal_capture'].includes(source)) {
    // Payment confirmation sources: STRICTLY pending → confirmed only
    if (!(previousStatus === 'pending' && newStatus === 'confirmed')) {
      // Already paid, or wrong transition → graceful no-op
      return { success: true, previousStatus, newStatus: previousStatus, noop: true };
    }
  } else if (source === 'refund_external') {
    // Remboursement externe (PayPal/Stripe) : * → refunded autorisé
    // L'argent a DÉJÀ été rendu — bloquer la transition = incohérence DB.
    // Exception documentée I-BACK-3 (P3-A.4, 2026-06).
    if (newStatus !== 'refunded') {
      return { success: false, error: `refund_external ne peut cibler que 'refunded'` };
    }
  } else {
    // scan/system/auto: forward-only, no role check
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
    setParts.push(`${tsCol} = COALESCE(${tsCol}, NOW())`);
  }

  // ── 4b. Gate douane : bloquer → available si douane non déclarée ─────────
  // Doctrine DOUANE_DECLARATION_PIVOT : la réception ne peut pas être validée
  // tant que le montant douane de l'expédition n'a pas été saisi par l'admin.
  // Commandes sans colis groupage (pas de customs_shipment lié) : laissées passer.
  if (newStatus === 'available') {
    const { isCustomsDeclaredForOrder } = require('./customs-shipment-service');
    const customsCheck = await isCustomsDeclaredForOrder(q, orderId);
    if (!customsCheck.allowed) {
      return { success: false, error: customsCheck.reason, code: 'CUSTOMS_NOT_DECLARED' };
    }
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

  // Auto-generate le code de retrait canonique quand → available (idempotent —
  // no-op si un secret existe déjà, ex. déjà généré à la confirmation du
  // paiement). require() tardif : évite le cycle avec pickup-secret-service.js,
  // qui dépend lui-même de transitionOrderStatus.
  let pickupCode = null;
  if (newStatus === 'available' && !order.pickup_secret_hash) {
    const { ensureSecretGenerated } = require('./pickup-secret-service');
    const secretResult = await ensureSecretGenerated({
      orderId:  orderId,
      relaisId: order.relais_id || null,
      channel:  'status_available',
      dbClient: dbClient || null,
    });
    pickupCode = secretResult.code || null;
  }

  // ── 5. Special: confirmed (paiement reçu) → set payment_status = 'paid' ──
  // Ceci remplace la logique qui était dans payments.js
  // Garde alignée sur payment-status-validator.js (P5-N2/N3, 2026-07) : ce
  // bloc ne s'exécute déjà que si previousStatus === 'pending' (variable en
  // mémoire) — la clause WHERE ajoute la même garantie côté DB, en défense
  // en profondeur contre une course avec une autre transition concurrente.
  if (newStatus === 'confirmed' && previousStatus === 'pending' && ['stripe_webhook', 'cash_confirm', 'wallet_full_payment', 'paypal_capture', 'system'].includes(source)) {
    const paidGuard = sqlGuard(sourceStatusesFor('paid'));
    await q.query(
      `UPDATE orders SET payment_status = 'paid' WHERE id = $1 AND ${paidGuard}`,
      [orderId]
    );
  }

  // ── 5b. Auto-effects: cancelled → wallet reversal + stock restore ────────
  let cancelEffects = null;

  if (newStatus === 'cancelled') {
    cancelEffects = {
      walletReversalAmount: 0,
      walletReversalTxId: null,
      stockItemsRestored: 0,
      purchaseOrders: null,
    };

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
        log.info({ order_id: orderId, user_id: orderInfo.user_id, amount_kmf: wResult.reversed_kmf }, 'Wallet reversed after order cancellation');
      } catch (e) {
        log.error({ err: e, order_id: orderId, user_id: orderInfo.user_id }, 'Wallet removeFromOrder failed, trying credit fallback');
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
          log.error({ err: e2, order_id: orderId, user_id: orderInfo.user_id }, 'Wallet credit fallback failed');
        }
      }
    }

    // Stock restore — UNIQUEMENT si le stock avait réellement été décrémenté.
    // Le décrément se fait au passage pending → confirmed (order-payment-confirmation.js).
    // Annuler une commande jamais confirmée (pending) ne doit
    // PAS rendre de stock, sinon on crée du stock fantôme.
    const stockWasDecremented = STATUS_RANK[previousStatus] >= STATUS_RANK.confirmed;
    if (stockWasDecremented) {
      // Symétrie avec le décrément : restaurer stock produit ET stock variantes.
      // PDC-7 (Lot 7) — même correctif que parcel-operations.js:497-523 : oi.sku_id
      // et p.inventory_model sont OBLIGATOIRES ici. Sans eux, adjustStock() route
      // tout item sur le chemin legacy quel que soit son vrai modèle, et un produit
      // inventory_model='SKU' ne voit jamais son stock product_skus restauré à
      // l'annulation générale (bug historique documenté, corrigé uniquement côté
      // backorder jusqu'ici — ce chemin de restauration générale était le deuxième
      // moteur non corrigé).
      const { rows: items } = await q.query(
        `SELECT oi.product_id, oi.quantity, oi.variant_combo, oi.sku_id, p.has_variants, p.inventory_model
           FROM order_items oi
           JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = $1`,
        [orderId]
      );
      await adjustStock(q, items, 'increment');
      cancelEffects.stockItemsRestored = items.length;
      if (items.length > 0) {
        log.info({ order_id: orderId, items_count: items.length, previous_status: previousStatus }, 'Stock restored after order cancellation');
      }
    } else {
      cancelEffects.stockItemsRestored = 0;
      log.info({ order_id: orderId, previous_status: previousStatus }, 'Stock non restauré : commande jamais confirmée (stock jamais décrémenté)');
    }

    // Purchase orders sync — pending/notified auto-cancelled, engaged POs alerted.
    try {
      const { syncPurchaseOrdersOnOrderCancel } = require('./cancel-order-purchase-orders');
      cancelEffects.purchaseOrders = await syncPurchaseOrdersOnOrderCancel(q, {
        orderId,
        orderReference: orderInfo?.reference || null,
        actor,
        reason: cancelReason || note || null,
      });
    } catch (poErr) {
      log.error({ err: poErr, order_id: orderId }, 'Purchase orders cancel sync failed');
      cancelEffects.purchaseOrders = { error: poErr.message };
    }

    // Shared-list claim release (Boutique First, D2) — une ligne de commande
    // annulée libère l'article de la liste partagée à laquelle elle était
    // rattachée, pour qu'un autre participant puisse le réclamer. La colonne
    // shared_cart_item_id porte l'arbitrage via un index unique standard :
    // NULL n'entre jamais en conflit avec NULL, donc remettre à NULL ici
    // suffit à rouvrir l'article sans machine à états ni verrou applicatif.
    try {
      const { rowCount } = await q.query(
        `UPDATE order_items
            SET shared_cart_item_id = NULL
          WHERE order_id = $1
            AND shared_cart_item_id IS NOT NULL`,
        [orderId]
      );
      cancelEffects.sharedListClaimsReleased = rowCount;
      if (rowCount > 0) {
        log.info({ order_id: orderId, count: rowCount }, 'Shared-list claims released after order cancellation');
      }
    } catch (claimErr) {
      log.error({ err: claimErr, order_id: orderId }, 'Shared-list claim release failed');
      cancelEffects.sharedListClaimsReleased = { error: claimErr.message };
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
    log.error({ err: histErr, order_id: orderId, status: newStatus }, 'Order status history insert failed');
    throw histErr;
  }

  // Projection client essentielle uniquement. L'émission est idempotente et
  // best-effort pour ne jamais bloquer un retrait ou une transition terrain.
  // GET /api/auth/me/notifications réconcilie les émissions manquées depuis
  // la vérité orders.status='available'.
  try {
    // Un client SQL fourni appartient à une transaction appelante : une
    // erreur SQL même catchée la placerait en état aborted. Dans ce cas on ne
    // projette rien ici ; la lecture client réconcilie après le commit depuis
    // orders.status. Sans transaction externe, le statut est déjà durable et
    // la projection best-effort peut être tentée immédiatement.
    if (!dbClient && newStatus === 'available') {
      await clientNotifications.emitPickupReady({
        dbClient: q,
        userId: order.user_id,
        orderId: order.id,
        orderReference: order.reference,
        relaisName: order.relais_name,
      });
    } else if (!dbClient && ['collected', 'cancelled', 'refunded'].includes(newStatus)) {
      await clientNotifications.resolvePickupForOrder(order.id, { dbClient: q });
    }
  } catch (notificationErr) {
    log.error({ err: notificationErr, order_id: orderId, status: newStatus }, 'Client notification projection failed; reconciliation will retry');
  }

  log.info({ order_id: orderId, previous_status: previousStatus, new_status: newStatus, source }, 'Order status transition applied');

  return { success: true, previousStatus, newStatus, pickupCode, cancelEffects };
}


/**
 * appendOrderHistoryNote — Sprint A (MULTI_WRITER_TABLES.md).
 *
 * Historise un événement sur la commande SANS changer orders.status.
 * Distinct de transitionOrderStatus() : ne valide aucune transition, ne
 * déclenche aucun effet de bord (stock, wallet, notifications) — c'est
 * une simple note d'audit (ex: "Colis X → shipped", "Backorder annulé").
 *
 * Introduit pour que order_status_history reste écrit depuis un seul
 * point de code partagé, même quand l'appelant (ex: logistics) ne fait
 * pas une transition de commande à proprement parler.
 *
 * @param {object} client    - client DB (transaction en cours chez l'appelant)
 * @param {string} orderId
 * @param {string} status    - statut courant de la commande (non modifié)
 * @param {string} note
 * @param {string} changedBy - user.id
 */
async function appendOrderHistoryNote(client, orderId, status, note, changedBy) {
  return client.query(
    `INSERT INTO order_status_history (order_id, status, note, changed_by)
     VALUES ($1, $2, $3, $4)`,
    [orderId, status, note, changedBy]
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  transitionOrderStatus,
  appendOrderHistoryNote,
  ORDER_STATUSES,
  VALID_TRANSITIONS,
  TRANSITION_ROLES,
  STATUS_RANK,
  STATUS_TIMESTAMP,
  isForwardTransition,
};
