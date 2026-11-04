/**
 * @komerce-arch
 * @role          credential-link-crypto
 * @domain        auth-identity
 * @layer         service
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
/**
 * Activation / password reset tokens. The raw secret must never be persisted.
 * This module deliberately does not activate accounts or authorize sessions:
 * callers must enforce account state and consume persisted hashes atomically.
 */
'use strict';
const { randomBytes, createHash, timingSafeEqual } = require('crypto');

const PURPOSES = Object.freeze(['account_activation', 'password_reset']);
const TTL_SECONDS = Object.freeze({ account_activation: 24 * 60 * 60, password_reset: 30 * 60 });
const SECRET_BYTES = 32;

function assertPurpose(purpose) {
  if (!PURPOSES.includes(purpose)) throw new TypeError('Unsupported credential token purpose');
}
function hashCredentialToken(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    throw new TypeError('Invalid credential token format');
  }
  return createHash('sha256').update(token, 'ascii').digest('hex');
}
function issueCredentialToken(purpose, now = new Date()) {
  assertPurpose(purpose);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('Invalid date');
  const token = randomBytes(SECRET_BYTES).toString('hex');
  return {
    token, // deliver only over the verified channel, never return in public APIs/logs
    tokenHash: hashCredentialToken(token),
    purpose,
    expiresAt: new Date(now.getTime() + TTL_SECONDS[purpose] * 1000),
  };
}
function credentialTokenMatches(token, expectedHash) {
  try {
    const actual = Buffer.from(hashCredentialToken(token), 'hex');
    if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
    return timingSafeEqual(actual, Buffer.from(expectedHash, 'hex'));
  } catch (_) { return false; }
}
module.exports = {
  PURPOSES,
  TTL_SECONDS,
  issueCredentialToken,
  hashCredentialToken,
  credentialTokenMatches,
};
