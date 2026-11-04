/**
 * @komerce-arch
 * @role          credential-action-token-persistence
 * @domain        auth-identity
 * @layer         service
 * @criticality   high
 * @inputs        credential_token_or_verified_account_context
 * @outputs       verified_token_or_authorized_result
 * @depends       auth-identity
 * @used-by       V1 account activation and password recovery
 * @db-read       credential_action_tokens
 * @db-write      credential_action_tokens
 * @db-txn        caller-owned
 * @doctrine      credential_secret_never_persisted_in_cleartext
 * @impact-areas  auth-identity, account-security
 * @version       2026-11
 */
'use strict';
// Caller-owned transactions: consume and password update must share one transaction.
const { hashCredentialToken, issueCredentialToken } = require('./credential-link-token');
function executor(db) {
  if (!db || typeof db.query !== 'function') throw new TypeError('Transaction executor required');
  return db;
}
async function createActionToken(client, { userId, purpose, now = new Date() }) {
  executor(client);
  if (!userId) throw new TypeError('userId required');
  const issued = issueCredentialToken(purpose, now);
  await client.query(
    `UPDATE credential_action_tokens SET consumed_at=NOW()
       WHERE user_id=$1::uuid AND purpose=$2 AND consumed_at IS NULL`,
    [userId, purpose]
  );
  await client.query(
    `INSERT INTO credential_action_tokens(user_id,token_hash,purpose,created_at,expires_at)
     VALUES($1::uuid,$2,$3,$4,$5)`,
    [userId, issued.tokenHash, purpose, now, issued.expiresAt]
  );
  // Raw token only returns to trusted notification orchestration; never log or return via public API.
  return { token: issued.token, expiresAt: issued.expiresAt };
}
async function consumeActionToken(client, { token, purpose }) {
  executor(client);
  if (!['account_activation','password_reset'].includes(purpose)) throw new TypeError('Invalid purpose');
  let hash;
  try { hash = hashCredentialToken(token); } catch (_) { return null; }
  // Atomic single-use operation. Caller MUST roll back if subsequent credential mutation fails.
  const { rows } = await client.query(
    `UPDATE credential_action_tokens
         SET consumed_at=NOW()
       WHERE token_hash=$1 AND purpose=$2
         AND consumed_at IS NULL AND expires_at>NOW()
       RETURNING user_id`,
    [hash, purpose]
  );
  return rows[0] ? rows[0].user_id : null;
}
module.exports = { createActionToken, consumeActionToken };
