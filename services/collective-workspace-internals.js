/**
 * @komerce-arch
 * @role          collective-workspace-internals
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        (none)
 * @outputs       (none)
 * @depends       db.js
 * @used-by       services/collective-workspace-creation.js, services/collective-workspace-reads.js, services/collective-workspace-items.js, services/collective-workspace-contributions.js, services/collective-workspace-lifecycle.js
 * @db-read       (none)
 * @db-write      collective_workspace_events
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  shared-cart
 * @version       2026-06
 */

'use strict';

const crypto = require('crypto');
const db = require('../db');

// ─── Configuration ─────────────────────────────────────────────────────
const CONFIG = {
  TOKEN_BYTES: 24,                          // 192 bits = ~32 chars en base64url
  PUBLIC_TOKEN_PREFIX: 'WS-',               // ex: WS-Ab3xK7...
  CREATOR_TOKEN_PREFIX: 'WC-',              // ex: WC-Ab3xK7...
  PAYMENT_TOKEN_PREFIX: 'PT-',              // ex: PT-Ab3xK7...
  SESSION_DURATION_MS: 72 * 60 * 60 * 1000, // 72h max
  SESSION_DURATION_MIN_MS: 1 * 60 * 60 * 1000, // 1h min (anti-erreur)
};

// ─── Helpers tokens ────────────────────────────────────────────────────
function _generateToken(prefix) {
  const raw = crypto.randomBytes(CONFIG.TOKEN_BYTES).toString('base64url');
  return prefix + raw;
}

function _hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ─── Audit log helper ──────────────────────────────────────────────────
async function logEvent(client, workspaceId, eventType, actorType, actorIdentifier, payload = {}) {
  const c = client || db;
  await c.query(
    `INSERT INTO collective_workspace_events
       (workspace_id, event_type, actor_type, actor_identifier, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [workspaceId, eventType, actorType || null, actorIdentifier || null, JSON.stringify(payload)]
  );
}

module.exports = { db, CONFIG, _generateToken, _hashToken, logEvent };
