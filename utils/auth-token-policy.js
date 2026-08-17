/**
 * @komerce-arch
 * @role          auth-token-policy
 * @domain        auth
 * @layer         util
 * @criticality   high
 * @inputs        verified_jwt_claims
 * @outputs       session_claims_verdict
 * @depends       none
 * @db-read       none
 * @db-write      none
 * @doctrine      auth8_scoped_tokens_never_become_sessions
 * @impact-areas  auth, all-authenticated-api
 * @version       2026-08
 */
'use strict';

const SESSION_TOKEN_USE = 'session';

/**
 * AUTH-8e — frontière entre une SESSION Komerce et tout autre JWT signé avec
 * la même clé historique.
 *
 * La signature cryptographique ne suffit pas à conférer les droits d'une
 * session. Un JWT session doit porter la preuve de son émission par le helper
 * canonique AUTH-7/8 : jti + auth_time + amr. Tout token scoped est refusé.
 *
 * `token_use` est introduit par AUTH-8e. Pour ne pas déconnecter une seconde
 * fois les sessions AUTH-7/8 encore valides au déploiement, son absence est
 * tolérée seulement si tous les autres marqueurs canoniques sont présents.
 */
function sessionClaimsVerdict(decoded) {
  if (!decoded || typeof decoded !== 'object') {
    return { ok: false, reason: 'claims_missing' };
  }
  if (!decoded.id) {
    return { ok: false, reason: 'subject_missing' };
  }
  if (decoded.scope !== undefined && decoded.scope !== null) {
    return { ok: false, reason: 'scoped_token_not_session' };
  }
  if (decoded.token_use !== undefined && decoded.token_use !== SESSION_TOKEN_USE) {
    return { ok: false, reason: 'token_use_not_session' };
  }
  if (!decoded.jti || typeof decoded.jti !== 'string') {
    return { ok: false, reason: 'jti_missing' };
  }
  const authTime = Number(decoded.auth_time);
  if (!Number.isFinite(authTime) || authTime <= 0) {
    return { ok: false, reason: 'auth_time_missing' };
  }
  if (!Array.isArray(decoded.amr) || decoded.amr.length === 0) {
    return { ok: false, reason: 'amr_missing' };
  }
  if (decoded.exp === undefined || decoded.exp === null || !Number.isFinite(Number(decoded.exp)) || Number(decoded.exp) <= 0) {
    return { ok: false, reason: 'exp_missing' };
  }

  return {
    ok: true,
    legacyTokenUse: decoded.token_use === undefined,
  };
}

function isCanonicalSessionClaims(decoded) {
  return sessionClaimsVerdict(decoded).ok;
}

module.exports = {
  SESSION_TOKEN_USE,
  sessionClaimsVerdict,
  isCanonicalSessionClaims,
};
