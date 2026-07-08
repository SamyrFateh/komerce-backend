/**
 * @komerce-arch
 * @role          refund-service
 * @domain        refunds
 * @layer         service
 * @criticality   medium
 * @inputs        client, order, amountKmf, amountEur, refundType, reason, userId
 * @outputs       refund row, stripe/wallet refund result
 * @depends       db.js, stripe, services/wallet-service.js
 * @used-by       routes/orders/cancel.js, services/admin-order-refund.js, services/cancel-shared-cart-with-refunds.js
 * @db-read       orders, refunds, wallets
 * @db-write      refunds
 * @db-txn        resolve_before_behavior_change
 * @doctrine      refund_confirmed_only, idempotent_stripe_refund, resolve_before_behavior_change
 * @impact-areas  orders, refunds, wallet
 * @version       2026-06
 */

/**
 * KOMERCE — Refund Service v2.1
 *
 * Wrapper Stripe + Wallet pour les remboursements/annulations.
 * v2.0 : remplace store_credits par wallet-service.
 * v2.1 (P0) :
 *   - Idempotency key stable sur stripe.refunds.create (BUG critique fixé)
 *   - Idempotency key stable sur fallback wallet (plus de Date.now())
 *   - Format clé stable : refund_${order.id}_${refundType}_${parcelId || 'full'}
 *
 * IMPORTANT : la clé d'idempotence DOIT être stable d'un retry à l'autre.
 * Date.now() change à chaque appel = jamais idempotent = double remboursement possible.
 */

'use strict';

const stripe        = require('stripe')(process.env.STRIPE_SECRET_KEY);
const walletService = require('./wallet-service');
const refundReceiptService = require('./documents/refund-receipt');
const log = require('../utils/logger').child({ module: 'refund-service' });

/**
 * Construit une clé d'idempotence stable.
 * Format : refund_<orderId>_<refundType>_<parcelId|'full'>
 */
function _buildIdempotencyKey(orderId, refundType, parcelId) {
  return `refund_${orderId}_${refundType}_${parcelId || 'full'}`;
}

/**
 * Traite un remboursement (Stripe ou wallet).
 * Doit être appelé dans une transaction DB existante.
 */
async function processRefund(dbClient, order, amountKmf, amountEur, refundType, reason, initiatedBy, parcelId = null) {
  let refundMethod, stripeRefundId = null, walletTxId = null;
  const idempotencyKey = _buildIdempotencyKey(order.id, refundType, parcelId);

  // PATCH P2-2 : INSERT refund en 'pending' AVANT l'appel Stripe.
  // Avant : INSERT après Stripe → si crash DB post-refund, argent remboursé sans trace.
  // Maintenant : INSERT pending → Stripe → UPDATE completed. Idempotence garantie.
  // ON CONFLICT sur (order_id, refund_type) — contrainte ajoutée en migration 014.
  const { rows: [pendingRefund] } = await dbClient.query(
    `INSERT INTO refunds
       (order_id, amount_kmf, amount_eur, refund_type, refund_method,
        stripe_refund_id, store_credit_id, reason, initiated_by, status)
     VALUES ($1,$2,$3,$4,'pending_stripe',NULL,NULL,$5,$6,'pending')
     ON CONFLICT (order_id, refund_type) DO NOTHING
     RETURNING id`,
    [order.id, amountKmf, amountEur, refundType, reason || 'Annulation client', initiatedBy]
  );
  // Fallback SELECT si conflict (retry) — toujours résoudre refundRowId
  let refundRowId = pendingRefund?.id;
  if (!refundRowId) {
    const { rows: [existing] } = await dbClient.query(
      `SELECT id FROM refunds WHERE order_id = $1 AND refund_type = $2 LIMIT 1`,
      [order.id, refundType]
    );
    refundRowId = existing?.id || null;
  }

  if (order.payment_mode === 'stripe_eur' && order.stripe_payment_id) {
    refundMethod    = 'stripe';
    const amountCents  = Math.round(amountEur * 100);
    const stripeRefund = await stripe.refunds.create({
      payment_intent: order.stripe_payment_id,
      amount:         amountCents,
      reason:         'requested_by_customer',
      metadata: {
        order_reference: order.reference,
        refund_type:     refundType,
        ...(parcelId ? { parcel_id: parcelId } : {}),
        komerce:         'true',
      },
    }, {
      idempotencyKey,  // ← P0 FIX : empêche double remboursement Stripe sur retry
    });
    stripeRefundId = stripeRefund.id;
    log.info(`[CANCEL] Stripe refund OK: ${stripeRefundId} — ${amountEur}€ pour ${order.reference}`);
  } else {
    refundMethod = 'wallet_credit';
    const result = await walletService.credit(dbClient, {
      userId:         order.user_id,
      amountKmf,
      reason:         'order_cancel',
      referenceId:    order.id,
      idempotencyKey,
      note:           `Remboursement ${refundType} — commande ${order.reference}`,
      createdBy:      initiatedBy,
    });
    walletTxId = result.transaction.id;
  }

  // Mettre à jour l'enregistrement refund avec les IDs réels + statut 'completed'
  if (refundRowId) {
    await dbClient.query(
      `UPDATE refunds
          SET refund_method = $1, stripe_refund_id = $2, store_credit_id = $3,
              status = 'completed', completed_at = NOW()
        WHERE id = $4`,
      [refundMethod, stripeRefundId, walletTxId, refundRowId]
    );
  }

  // Reçu de remboursement — émis par le caller post-commit (non bloquant).
  // processRefund s'exécute dans la transaction du caller : le reçu doit être
  // déclenché après COMMIT. On expose refundRowId pour que le caller le fasse.
  // Exemple dans cancel.js : db.query SELECT id FROM refunds … .then(row => refundReceiptService.issue(row.id))
  // Pour les callers qui ne gèrent pas eux-mêmes le post-commit, on attache
  // une fonction helper non bloquante sur le résultat.

  return { method: refundMethod, stripeRefundId, walletTxId, amountEur, amountKmf, refundRowId };
}

/**
 * Variante avec fallback : si Stripe échoue, bascule sur wallet.
 *
 * P0 FIX : idempotency key stable partout (Stripe ET wallet fallback).
 * Avant le fix, le fallback utilisait Date.now() => jamais idempotent.
 *
 * A-BE-06 (2026-05-26) : INSERT pending AVANT l'appel Stripe, comme processRefund().
 * Avant : INSERT seulement à la fin → si Stripe rembourse et que l'INSERT crash,
 * argent remboursé sans trace DB.
 * Maintenant : INSERT pending → Stripe/wallet → UPDATE completed.
 */
async function processRefundWithFallback(dbClient, order, amountKmf, amountEur, refundType, reason, initiatedBy, parcelId) {
  // Garde montant zéro : aucun appel DB/Stripe/wallet pour un remboursement nul
  // (évite une ligne `refunds` fantôme + un appel Stripe amount:0 inutile).
  if (!amountKmf && !amountEur) {
    return { method: 'none', skipped: true, reason: 'zero_amount', amountEur, amountKmf };
  }

  let refundMethod, stripeRefundId = null, walletTxId = null;
  const idempotencyKey = _buildIdempotencyKey(order.id, refundType, parcelId);

  // A-BE-06 : INSERT refund en 'pending' AVANT tout appel Stripe ou wallet.
  // ON CONFLICT sur (order_id, refund_type) — contrainte ajoutée en migration 014.
  const { rows: [pendingRefund] } = await dbClient.query(
    `INSERT INTO refunds
       (order_id, amount_kmf, amount_eur, refund_type, refund_method,
        stripe_refund_id, store_credit_id, reason, initiated_by, status)
     VALUES ($1,$2,$3,$4,'pending_stripe',NULL,NULL,$5,$6,'pending')
     ON CONFLICT (order_id, refund_type) DO NOTHING
     RETURNING id`,
    [order.id, amountKmf, amountEur, refundType, reason || 'Annulation', initiatedBy]
  );
  // Fallback SELECT si conflict (retry)
  let refundRowId = pendingRefund?.id;
  if (!refundRowId) {
    const { rows: [existing] } = await dbClient.query(
      `SELECT id FROM refunds WHERE order_id = $1 AND refund_type = $2 LIMIT 1`,
      [order.id, refundType]
    );
    refundRowId = existing?.id || null;
  }

  if (order.payment_mode === 'stripe_eur' && order.stripe_payment_id) {
    const amountCents = Math.round(amountEur * 100);
    try {
      const stripeRefund = await stripe.refunds.create({
        payment_intent: order.stripe_payment_id,
        amount: amountCents,
        reason: 'requested_by_customer',
        metadata: {
          order_reference: order.reference,
          refund_type:     refundType,
          ...(parcelId ? { parcel_id: parcelId } : {}),
          komerce:         'true',
        },
      }, {
        idempotencyKey,  // ← P0 FIX
      });
      stripeRefundId = stripeRefund.id;
      refundMethod   = 'stripe';
    } catch (stripeErr) {
      log.error({ err: stripeErr }, '[refund-service] Stripe failed, using wallet fallback');
      refundMethod = 'wallet_credit';
    }
  }

  if (!refundMethod || refundMethod === 'wallet_credit') {
    refundMethod = 'wallet_credit';
    const result = await walletService.credit(dbClient, {
      userId:         order.user_id,
      amountKmf,
      reason:         'order_cancel',
      referenceId:    order.id,
      // ← P0 FIX : clé stable (avant : Date.now() = jamais idempotent !)
      idempotencyKey: `refund_fb_${order.id}_${refundType}_${parcelId || 'full'}`,
      note:           `Remboursement fallback — ${order.reference}`,
      createdBy:      initiatedBy,
    });
    walletTxId = result.transaction.id;
  }

  // Mettre à jour l'enregistrement refund avec les IDs réels + statut 'completed'
  if (refundRowId) {
    await dbClient.query(
      `UPDATE refunds
          SET refund_method = $1, stripe_refund_id = $2, store_credit_id = $3,
              status = 'completed', completed_at = NOW()
        WHERE id = $4`,
      [refundMethod, stripeRefundId, walletTxId, refundRowId]
    );
  } else {
    // Ligne déjà créée par un retry précédent (ON CONFLICT DO NOTHING) —
    // mettre à jour si elle est encore en 'pending'
    await dbClient.query(
      `UPDATE refunds
          SET refund_method = $1, stripe_refund_id = COALESCE($2, stripe_refund_id),
              store_credit_id = COALESCE($3, store_credit_id),
              status = 'completed', completed_at = COALESCE(completed_at, NOW())
        WHERE order_id = $4 AND refund_type = $5 AND status = 'pending'`,
      [refundMethod, stripeRefundId, walletTxId, order.id, refundType]
    );
  }

  return { method: refundMethod, stripeRefundId, walletTxId, amountEur, amountKmf, refundRowId };
}

// ─────────────────────────────────────────────────────────────────────────────
// recordExternalRefund — trace comptable d'un remboursement déjà effectué
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insère une ligne `refunds` avec status='completed' pour un remboursement
 * dont l'appel externe (PayPal, Stripe) a déjà abouti.
 *
 * Contrairement à processRefund (pending→completed), cette fonction enregistre
 * directement l'état final. Elle est le SEUL chemin d'écriture directe sur
 * `refunds` pour les features payments et shared-cart.
 *
 * @param {object} dbClient   Client de transaction actif (ou pool global)
 * @param {object} opts
 * @param {string}  opts.orderId           UUID de la commande
 * @param {number}  opts.amountKmf         Montant en KMF
 * @param {number}  opts.amountEur         Montant en EUR (peut être null)
 * @param {string}  opts.refundType        'full' | 'partial'
 * @param {string}  opts.method            'paypal' | 'stripe' | 'wallet_credit' | …
 * @param {string}  opts.externalRefundId  ID externe (stripe_refund_id, ref PayPal) ou null
 * @param {string}  opts.reason            Motif lisible
 * @param {string}  opts.initiatedBy       UUID de l'acteur (null = système)
 * @param {string}  opts.conflictOn        Clé d'idempotence :
 *                    'order_refund_type' → ON CONFLICT (order_id, refund_type)
 *                    'stripe_refund_id'  → ON CONFLICT (stripe_refund_id)
 *                    'any'               → ON CONFLICT DO NOTHING
 * @param {Date}   [opts.completedAt]      Date de completion (défaut : NOW())
 * @returns {Promise<string|null>}         UUID de la ligne insérée, ou celle
 *                                         retrouvée via la clé d'idempotence en cas de conflit
 */
async function recordExternalRefund(dbClient, {
  orderId, amountKmf, amountEur, refundType, method,
  externalRefundId = null, reason, initiatedBy = null,
  conflictOn = 'any', completedAt = null,
}) {
  const conflictClause =
    conflictOn === 'order_refund_type' ? 'ON CONFLICT (order_id, refund_type) DO NOTHING' :
    conflictOn === 'stripe_refund_id'  ? 'ON CONFLICT (stripe_refund_id) DO NOTHING' :
                                         'ON CONFLICT DO NOTHING';

  const { rows: [row] } = await dbClient.query(
    `INSERT INTO refunds
       (order_id, amount_kmf, amount_eur, refund_type, refund_method,
        stripe_refund_id, store_credit_id, reason, initiated_by, status, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, 'completed', $9)
     ${conflictClause}
     RETURNING id`,
    [
      orderId, amountKmf, amountEur ?? null, refundType, method,
      externalRefundId, reason, initiatedBy,
      completedAt ?? new Date(),
    ]
  );

  if (row) return row.id;

  // Conflit (retry) — retrouver l'existant via la clé d'idempotence
  if (conflictOn === 'stripe_refund_id' && externalRefundId) {
    const { rows: [existing] } = await dbClient.query(
      `SELECT id FROM refunds WHERE stripe_refund_id = $1 LIMIT 1`,
      [externalRefundId]
    );
    return existing?.id ?? null;
  }
  if (conflictOn === 'order_refund_type') {
    const { rows: [existing] } = await dbClient.query(
      `SELECT id FROM refunds WHERE order_id = $1 AND refund_type = $2 LIMIT 1`,
      [orderId, refundType]
    );
    return existing?.id ?? null;
  }
  return null;
}

module.exports = { processRefund, processRefundWithFallback, recordExternalRefund, _buildIdempotencyKey };
