/**
 * @komerce-arch
 * @role          collective-workspace-contributions
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        public_token, creator_token, payload, contribution_id
 * @outputs       contribution, ok
 * @depends       services/collective-workspace-internals.js
 * @used-by       services/collective-workspace-engine.js
 * @db-read       collective_workspaces
 * @db-write      collective_workspace_contributions, collective_workspace_events
 * @db-txn        required_for_state_transition
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  shared-cart
 * @version       2026-06
 */

'use strict';

const { db, _hashToken, logEvent } = require('./collective-workspace-internals');

/**
 * Ajoute une intention de contribution.
 * Aucun paiement n'est effectué ici.
 * Le contributeur partage son intention (montant qu'il proposera de payer).
 */
async function addContribution(publicToken, payload = {}) {
  const {
    contributor_name,
    contributor_phone,
    contributor_email,
    intended_amount_kmf,
    suggestion,
    message,
    kind: rawKind,
  } = payload;

  if (!contributor_name) throw new Error('contributor_name_required');

  // P1.2 : amount nullable
  let amount = null;
  if (intended_amount_kmf !== undefined && intended_amount_kmf !== null && intended_amount_kmf !== '') {
    amount = parseInt(intended_amount_kmf, 10);
    if (Number.isNaN(amount) || amount <= 0) throw new Error('amount_invalid');
  }

  const sug = (suggestion || '').toString().trim() || null;
  const msg = (message || '').toString().trim() || null;

  // Au moins un des trois (montant, suggestion, message) doit être présent
  if (amount === null && !sug && !msg) {
    throw new Error('content_required');
  }

  // kind dérivé du contenu si non fourni
  let kind = (rawKind || '').toString().trim().toLowerCase();
  if (!['suggestion', 'intention', 'message'].includes(kind)) {
    if (amount !== null) kind = 'intention';
    else if (sug)        kind = 'suggestion';
    else                 kind = 'message';
  }

  const hash = _hashToken(publicToken);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // P0 FIX : SELECT FOR UPDATE pour bloquer toute mutation simultanée (finalize, etc.)
    const wsRes = await client.query(
      `SELECT id, status FROM collective_workspaces WHERE public_token_hash = $1 FOR UPDATE`,
      [hash]
    );
    if (!wsRes.rows.length) {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_found');
    }
    const ws = wsRes.rows[0];
    if (ws.status !== 'conception') {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_open');
    }

    const { rows } = await client.query(
      `INSERT INTO collective_workspace_contributions
         (workspace_id, contributor_name, contributor_phone, contributor_email,
          intended_amount_kmf, suggestion, message, kind, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'intention')
       RETURNING *`,
      [ws.id, contributor_name, contributor_phone || null, contributor_email || null,
       amount, sug, msg, kind]
    );
    await logEvent(client, ws.id, 'contribution_added', 'contributor', contributor_email || contributor_phone, {
      contributor_name, intended_amount_kmf: amount, suggestion: sug, message: msg, kind,
    });

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function cancelContribution(publicToken, contributionId) {
  const hash = _hashToken(publicToken);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const wsRes = await client.query(
      `SELECT id, status FROM collective_workspaces WHERE public_token_hash = $1 FOR UPDATE`,
      [hash]
    );
    if (!wsRes.rows.length) {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_found');
    }
    const ws = wsRes.rows[0];
    if (ws.status !== 'conception') {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_open');
    }

    const { rowCount } = await client.query(
      `UPDATE collective_workspace_contributions
         SET status = 'cancelled'
       WHERE id = $1 AND workspace_id = $2 AND status = 'intention'`,
      [contributionId, ws.id]
    );
    if (!rowCount) {
      await client.query('ROLLBACK');
      throw new Error('contribution_not_found_or_already_handled');
    }
    await logEvent(client, ws.id, 'contribution_cancelled', 'contributor', null, { contribution_id: contributionId });

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function cancelContributionByCreator(creatorToken, contributionId) {
  const hash = _hashToken(creatorToken);
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const wsRes = await client.query(
      `SELECT id, status
       FROM collective_workspaces
       WHERE creator_token_hash = $1
       FOR UPDATE`,
      [hash]
    );

    if (!wsRes.rows.length) {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_found');
    }

    const ws = wsRes.rows[0];

    if (ws.status !== 'conception') {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_open');
    }

    const { rowCount } = await client.query(
      `UPDATE collective_workspace_contributions
         SET status = 'cancelled'
       WHERE id = $1
         AND workspace_id = $2
         AND status = 'intention'`,
      [contributionId, ws.id]
    );

    if (!rowCount) {
      await client.query('ROLLBACK');
      throw new Error('contribution_not_found_or_already_handled');
    }

    await logEvent(client, ws.id, 'contribution_cancelled_by_creator', 'creator', null, {
      contribution_id: contributionId,
    });

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { addContribution, cancelContribution, cancelContributionByCreator };
