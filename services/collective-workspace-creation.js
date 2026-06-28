/**
 * @komerce-arch
 * @role          collective-workspace-creation
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        event_name, creator_name, creator_phone, recipient_name, relais_id
 * @outputs       workspace, public_token, creator_token
 * @depends       services/collective-workspace-internals.js
 * @used-by       services/collective-workspace-engine.js
 * @db-read       (none)
 * @db-write      collective_workspace_events, collective_workspaces
 * @db-txn        required_for_state_transition
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  shared-cart
 * @version       2026-06
 */

'use strict';

const { db, CONFIG, _generateToken, _hashToken, logEvent } = require('./collective-workspace-internals');

async function createWorkspace({
  event_name,
  event_note,
  creator_name,
  creator_phone,
  creator_email,
  creator_user_id,
  recipient_name,
  recipient_phone,
  relais_id,
}) {
  if (!event_name || !creator_name) {
    throw new Error('event_name et creator_name requis');
  }

  const publicToken  = _generateToken(CONFIG.PUBLIC_TOKEN_PREFIX);
  const creatorToken = _generateToken(CONFIG.CREATOR_TOKEN_PREFIX);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO collective_workspaces (
         public_token_hash, creator_token_hash,
         event_name, event_note,
         creator_name, creator_phone, creator_email, creator_user_id,
         recipient_name, recipient_phone, relais_id,
         status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'conception')
       RETURNING id, event_name, status, created_at`,
      [
        _hashToken(publicToken), _hashToken(creatorToken),
        event_name, event_note || null,
        creator_name, creator_phone || null, creator_email || null, creator_user_id || null,
        recipient_name || null, recipient_phone || null, relais_id || null,
      ]
    );
    const ws = rows[0];

    await logEvent(client, ws.id, 'workspace_created', 'creator', creator_email || creator_phone, {
      event_name, recipient_name, relais_id,
    });

    await client.query('COMMIT');
    return {
      workspace: ws,
      public_token: publicToken,
      creator_token: creatorToken,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createWorkspace };
