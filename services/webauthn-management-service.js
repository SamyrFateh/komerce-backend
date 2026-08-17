/**
 * @komerce-arch
 * @role          auth-passkey-management
 * @domain        auth-passkey
 * @layer         service
 * @criticality   high
 * @inputs        authenticated_user_id, credential_management_id
 * @outputs       safe_credential_metadata, revocation_result
 * @depends       db.js
 * @used-by       routes/auth-passkey.js
 * @db-read       webauthn_credentials
 * @db-write      webauthn_credentials
 * @db-txn        revoke_only_own_credential, idempotent_revocation
 * @doctrine      auth6_authenticator_management, never_expose_public_key_or_credential_id
 * @impact-areas  auth, account-security
 * @version       2026-08
 */
'use strict';

const db = require('../db');

function _safeCredential(row) {
  return {
    id: row.id,
    device_label: row.device_label || 'Passkey',
    created_at: row.created_at,
    last_used_at: row.last_used_at || null,
    backup_eligible: !!row.backup_eligible,
    backup_state: !!row.backup_state,
  };
}

async function listCredentials(userId) {
  const { rows } = await db.query(
    `SELECT id, device_label, created_at, last_used_at, backup_eligible, backup_state
       FROM webauthn_credentials
      WHERE user_id = $1
        AND revoked_at IS NULL
      ORDER BY COALESCE(last_used_at, created_at) DESC, created_at DESC`,
    [userId]
  );
  return rows.map(_safeCredential);
}

async function revokeCredential({ userId, credentialManagementId }) {
  const { rows } = await db.query(
    `UPDATE webauthn_credentials
        SET revoked_at = COALESCE(revoked_at, NOW())
      WHERE id = $1
        AND user_id = $2
      RETURNING id, revoked_at`,
    [credentialManagementId, userId]
  );

  if (!rows.length) return { revoked: false, error: 'credential_not_found' };
  return { revoked: true, id: rows[0].id, revoked_at: rows[0].revoked_at };
}

module.exports = {
  listCredentials,
  revokeCredential,
};
