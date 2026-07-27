/**
 * @komerce-arch
 * @role          shared-cart-shared-cart-refund-queue
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, services/refund-service.js, services/documents/refund-receipt.js
 * @used-by       services/cancel-shared-cart-with-refunds.js, routes/shared-cart-refund-admin.js
 * @db-read       shared_cart_contributions, shared_carts, users
 * @db-write      shared_cart_contributions, shared_cart_events
 * @db-write-via:refund-service refunds
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  shared-cart
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — Shared Cart Manual Refund Queue
 *
 * Liste admin des paiements Stripe encaissés mais non comptabilisés dans un
 * panier partagé, typiquement parce que le panier était déjà financé, expiré
 * ou converti au moment du webhook.
 *
 * La PR précédente marque ces contributions :
 *   status = 'failed'
 *   metadata.requires_manual_refund = true
 *
 * Ce service ne rembourse pas automatiquement. Il expose la file opérationnelle
 * pour traitement manuel Stripe/admin et permet ensuite de marquer qu'un
 * remboursement a été traité manuellement.
 */

const db = require('../db');
const { recordExternalRefund } = require('./refund-service');
const refundReceiptService = require('./documents/refund-receipt');
const log = require('../utils/logger').child({ module: 'shared-cart-refund-queue' });

function clampLimit(value) {
  const n = Number(value) || 50;
  return Math.max(1, Math.min(200, Math.round(n)));
}

function clampOffset(value) {
  const n = Number(value) || 0;
  return Math.max(0, Math.round(n));
}

async function listManualRefundQueue(options = {}) {
  const limit = clampLimit(options.limit);
  const offset = clampOffset(options.offset);

  const { rows } = await db.query(
    `SELECT
       c.id AS contribution_id,
       c.shared_cart_id,
       c.contributor_name,
       c.contributor_email,
       c.contributor_phone,
       c.amount_kmf,
       c.amount_paid,
       c.currency_paid,
       c.fx_rate_used,
       c.status AS contribution_status,
       c.stripe_session_id,
       c.stripe_payment_intent_id,
       c.failed_at,
       c.refunded_at,
       c.created_at AS contribution_created_at,
       c.metadata AS contribution_metadata,
       sc.token AS shared_cart_token,
       sc.title AS shared_cart_title,
       sc.status AS shared_cart_status,
       sc.total_kmf_snapshot,
       sc.contributed_kmf,
       sc.remaining_kmf,
       sc.finalized_order_id,
       sc.expires_at,
       u.id AS beneficiary_user_id,
       u.full_name AS beneficiary_name,
       u.email AS beneficiary_email,
       u.phone AS beneficiary_phone
     FROM shared_cart_contributions c
     JOIN shared_carts sc ON sc.id = c.shared_cart_id
     LEFT JOIN users u ON u.id = sc.beneficiary_user_id
     WHERE c.status = 'failed'
       AND c.metadata @> '{"requires_manual_refund": true}'
     ORDER BY c.failed_at DESC NULLS LAST, c.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  const { rows: countRows } = await db.query(
    `SELECT COUNT(*)::int AS count
       FROM shared_cart_contributions c
       JOIN shared_carts sc ON sc.id = c.shared_cart_id
      WHERE c.status = 'failed'
        AND c.metadata @> '{"requires_manual_refund": true}'`
  );

  return {
    items: rows,
    count: countRows[0]?.count || 0,
    limit,
    offset,
  };
}

async function markManualRefundProcessed(contributionId, adminUserId, options = {}) {
  const refundReference = String(options.refund_reference || '').trim() || null;
  const note = String(options.note || '').trim() || null;

  return db.withTransaction(async (client) => {
    const { rows: contributionRows } = await client.query(
      `SELECT *
         FROM shared_cart_contributions
        WHERE id = $1
        FOR UPDATE`,
      [contributionId]
    );

    if (!contributionRows.length) {
      const err = new Error('Contribution introuvable');
      err.statusCode = 404;
      throw err;
    }

    const contribution = contributionRows[0];

    if (contribution.status !== 'failed' || !contribution.metadata?.requires_manual_refund) {
      const err = new Error('Cette contribution ne nécessite pas de remboursement manuel');
      err.statusCode = 400;
      throw err;
    }

    const now = new Date().toISOString();
    const manualRefundPayload = {
      requires_manual_refund: false,
      manual_refund_processed: true,
      manual_refund_processed_at: now,
      manual_refund_processed_by: adminUserId,
      ...(refundReference ? { manual_refund_reference: refundReference } : {}),
      ...(note ? { manual_refund_note: note } : {}),
    };

    const { rows: [updatedContribution] } = await client.query(
      `UPDATE shared_cart_contributions
          SET status = 'refunded',
              refunded_at = $3,
              metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb,
              updated_at = $3
        WHERE id = $2
          AND status = 'failed'
          AND metadata @> '{"requires_manual_refund": true}'
        RETURNING *`,
      [JSON.stringify(manualRefundPayload), contributionId, now]
    );

    if (!updatedContribution) {
      const err = new Error('Remboursement manuel déjà traité ou contribution incompatible');
      err.statusCode = 409;
      throw err;
    }

    await client.query(
      `INSERT INTO shared_cart_events (shared_cart_id, event_type, actor_type, actor_id, payload)
         VALUES ($1, 'manual_refund_marked', 'admin', $2, $3)`,
      [updatedContribution.shared_cart_id, adminUserId, {
        contribution_id: updatedContribution.id,
        amount_kmf: updatedContribution.amount_kmf,
        amount_paid: updatedContribution.amount_paid,
        currency_paid: updatedContribution.currency_paid,
        stripe_session_id: updatedContribution.stripe_session_id,
        stripe_payment_intent_id: updatedContribution.stripe_payment_intent_id,
        refund_reference: refundReference,
        note,
      }]
    );

    // ── INSERT refunds (trace comptable) ──────────────────────────────────
    // Doctrine : refund_confirmed → ligne refunds 'completed'.
    // Le remboursement manuel est confirmé ici par l'admin.
    // payment_method = 'cash' ou 'stripe' selon la contribution (stripe remboursé
    // hors-bande = méthode 'manual_cash' ; on stocke ce que sait la contribution).
    const contribMeta   = updatedContribution.metadata || {};
    const paymentMethod = updatedContribution.payment_method || 'cash';
    const refundMethod  = paymentMethod === 'stripe' ? 'manual_cash' : 'cash';
    const amountKmf     = Number(updatedContribution.amount_kmf || 0);
    const amountEur     = updatedContribution.amount_paid
      ? Number(updatedContribution.amount_paid)
      : null;

    // ON CONFLICT sur (order_id, refund_type) : uniquement si la contribution
    // est rattachée à un order (panier finalisé). Sinon insert direct.
    // Note : shared_cart.finalized_order_id peut être null si le panier
    // a été annulé avant finalisation.
    const { rows: [cartRow] } = await client.query(
      `SELECT finalized_order_id FROM shared_carts WHERE id = $1`,
      [updatedContribution.shared_cart_id]
    );
    const orderId = cartRow?.finalized_order_id || null;

    let refundRowId = null;
    if (orderId) {
      refundRowId = await recordExternalRefund(client, {
        orderId,
        amountKmf,
        amountEur,
        refundType:       'partial',
        method:           refundMethod,
        externalRefundId: contribMeta.manual_refund_reference || null,
        reason:           note || 'Remboursement manuel contribution panier partagé',
        initiatedBy:      adminUserId,
        conflictOn:       'order_refund_type',
        completedAt:      now,
      });
    }

    return { contribution: updatedContribution, refundRowId };
  });
}

module.exports = {
  listManualRefundQueue,
  markManualRefundProcessed,
};
