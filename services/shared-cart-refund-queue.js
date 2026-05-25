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
 * pour traitement manuel Stripe/admin.
 */

const db = require('../db');

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
       AND COALESCE((c.metadata->>'requires_manual_refund')::boolean, false) = true
     ORDER BY c.failed_at DESC NULLS LAST, c.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  const { rows: countRows } = await db.query(
    `SELECT COUNT(*)::int AS count
       FROM shared_cart_contributions c
      WHERE c.status = 'failed'
        AND COALESCE((c.metadata->>'requires_manual_refund')::boolean, false) = true`
  );

  return {
    items: rows,
    count: countRows[0]?.count || 0,
    limit,
    offset,
  };
}

module.exports = {
  listManualRefundQueue,
};
