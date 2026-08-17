/**
 * @komerce-arch
 * @role          auth-session-proof
 * @domain        auth
 * @layer         util
 * @criticality   high
 * @inputs        authenticated_user, authentication_method
 * @outputs       signed_jwt_with_auth_time_and_amr
 * @depends       jsonwebtoken, crypto, utils/auth-session-policy.js, utils/auth-token-policy.js
 * @used-by       auth routes, OTP routes, passkey routes, magic-link validation
 * @doctrine      auth7_recent_proof, auth8_session_hardening
 * @impact-areas  auth, account-security
 * @version       2026-08
 */
'use strict';

const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { resolveSessionTtlSeconds } = require('./auth-session-policy');
const { SESSION_TOKEN_USE } = require('./auth-token-policy');

function _secret() {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error('[auth-session] JWT_SECRET manquant');
  return value;
}

function authNowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function signAuthToken(user, {
  method,
  phone = undefined,
  fullName = undefined,
  expiresIn = process.env.JWT_EXPIRES,
} = {}) {
  if (!user?.id) throw new Error('[auth-session] user.id requis');
  if (!method) throw new Error('[auth-session] méthode d’authentification requise');

  const claims = {
    id: user.id,
    role: user.role || 'client',
    token_use: SESSION_TOKEN_USE,
    // AUTH-8d : chaque émission est une vraie rotation de session.
    // OTP, Passkey et step-up produisent donc toujours une nouvelle jti.
    jti: randomUUID(),
    auth_time: authNowSeconds(),
    amr: [String(method)],
  };
  if (phone !== undefined) claims.phone = phone;
  if (fullName !== undefined) claims.fullName = fullName;

  return jwt.sign(claims, _secret(), {
    expiresIn: resolveSessionTtlSeconds(expiresIn),
  });
}

module.exports = {
  authNowSeconds,
  signAuthToken,
};
