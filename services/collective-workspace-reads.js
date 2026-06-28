/**
 * @komerce-arch
 * @role          collective-workspace-reads
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        public_token, creator_token, raw_token, workspace, opts
 * @outputs       workspace, items, contributions, session, token_info, phase
 * @depends       services/collective-workspace-internals.js
 * @used-by       services/collective-workspace-engine.js, services/collective-workspace-lifecycle.js
 * @db-read       collective_payment_sessions, collective_payment_tokens, collective_workspace_contributions, collective_workspace_items, collective_workspaces, relais
 * @db-write      (none)
 * @db-txn        (none)
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  shared-cart
 * @version       2026-06
 */

'use strict';

const { db, _hashToken } = require('./collective-workspace-internals');

/**
 * Lecture publique (par public_token) — pour les contributeurs.
 * Ne renvoie pas le creator_token_hash.
 */
async function getWorkspaceByPublicToken(publicToken) {
  const hash = _hashToken(publicToken);
  const { rows } = await db.query(
    `SELECT w.id, w.event_name, w.event_note,
            w.creator_name, w.recipient_name, w.recipient_phone,
            w.relais_id, w.status, w.order_id,
            w.created_at, w.finalized_at,
            r.name as relais_name
     FROM collective_workspaces w
     LEFT JOIN relais r ON r.id = w.relais_id
     WHERE w.public_token_hash = $1`,
    [hash]
  );
  if (!rows.length) return null;
  const ws = rows[0];

  const items = (await db.query(
    `SELECT id, product_id, quantity, product_name_snapshot,
            product_image_snapshot, price_snapshot_kmf
     FROM collective_workspace_items
     WHERE workspace_id = $1 ORDER BY created_at`,
    [ws.id]
  )).rows;

  const contributions = (await db.query(
    `SELECT id, contributor_name, intended_amount_kmf, status, created_at
     FROM collective_workspace_contributions
     WHERE workspace_id = $1 AND status != 'cancelled'
     ORDER BY created_at`,
    [ws.id]
  )).rows;

  // Session courante (si active)
  const session = (await db.query(
    `SELECT id, total_to_pay_kmf, amount_secured_kmf, status, expires_at, created_at
     FROM collective_payment_sessions
     WHERE workspace_id = $1 AND status IN ('open','ready_to_capture')
     ORDER BY created_at DESC LIMIT 1`,
    [ws.id]
  )).rows[0] || null;

  return { workspace: ws, items, contributions, session };
}

/**
 * Lecture créateur (par creator_token) — vue privilégiée avec tous les détails.
 */
async function getWorkspaceByCreatorToken(creatorToken) {
  const hash = _hashToken(creatorToken);
  const { rows } = await db.query(
    `SELECT * FROM collective_workspaces WHERE creator_token_hash = $1`,
    [hash]
  );
  if (!rows.length) return null;
  return rows[0];
}

async function getTokenInfo(rawToken) {
  const hash = _hashToken(rawToken);
  const { rows } = await db.query(
    `SELECT t.*, s.workspace_id, s.total_to_pay_kmf, s.amount_secured_kmf,
            s.status as session_status, s.expires_at as session_expires_at,
            w.event_name, w.recipient_name
     FROM collective_payment_tokens t
     JOIN collective_payment_sessions s ON s.id = t.session_id
     JOIN collective_workspaces w ON w.id = s.workspace_id
     WHERE t.token_hash = $1`,
    [hash]
  );
  if (!rows.length) return null;
  return rows[0];
}

/**
 * Derive a user-facing V2 phase from legacy/internal statuses.
 *
 * We keep the current DB states for compatibility, but expose a clearer
 * product phase for organizer/public UIs:
 *   - draft
 *   - collecting
 *   - reviewing
 *   - finalized
 *   - payment_pending
 *   - partially_paid
 *   - paid
 *   - order_created
 *   - expired
 *   - cancelled
 */
function deriveWorkspacePhase(workspace, opts = {}) {
  const ws = workspace || {};
  const items = Array.isArray(opts.items) ? opts.items : [];
  const contributions = Array.isArray(opts.contributions) ? opts.contributions : [];
  const session = opts.session || null;

  if (ws.status === 'order_created') return 'order_created';
  if (ws.status === 'paid') return 'paid';
  if (ws.status === 'session_ended') return 'expired';
  if (ws.status === 'cancelled') return 'cancelled';
  if (ws.status === 'payment_pending') {
    const secured = Number(session?.amount_secured_kmf) || 0;
    const total = Number(session?.total_to_pay_kmf) || 0;
    if (secured > 0 && total > 0 && secured < total) return 'partially_paid';
    return 'payment_pending';
  }

  if (ws.status === 'conception') {
    if (!items.length && !contributions.length) return 'draft';
    if (contributions.length > 0) return 'reviewing';
    return 'collecting';
  }

  return ws.status || 'draft';
}

module.exports = {
  getWorkspaceByPublicToken,
  getWorkspaceByCreatorToken,
  getTokenInfo,
  deriveWorkspacePhase,
};
