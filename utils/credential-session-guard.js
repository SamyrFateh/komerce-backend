/**
 * @komerce-arch
 * @role          credential-session-version-guard
 * @domain        auth-identity
 * @layer         util
 * @criticality   high
 * @inputs        credential_token_or_verified_account_context
 * @outputs       verified_token_or_authorized_result
 * @depends       auth-identity
 * @used-by       V1 account activation and password recovery
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      credential_secret_never_persisted_in_cleartext
 * @impact-areas  auth-identity, account-security
 * @version       2026-11
 */
'use strict';

// Sessions use integer-second auth_time claims. Rounding the DB timestamp up
// invalidates even sessions issued earlier in the same second as a password change.
function sessionPredatesCredentials(authTime, changedAt) {
  if (changedAt == null) return false;
  const changedMillis = new Date(changedAt).getTime();
  const issued = Number(authTime);
  if (!Number.isFinite(changedMillis) || !Number.isSafeInteger(issued) || issued <= 0) return true;
  // Fail closed for sessions issued in the same second as a credential change.
  return issued <= Math.floor(changedMillis / 1000);
}
module.exports = { sessionPredatesCredentials };
