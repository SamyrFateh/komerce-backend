/**
 * @komerce-arch
 * @role          auth-passkey-webauthn
 * @domain        auth-passkey
 * @layer         service
 * @criticality   high
 * @inputs        user, registration_response, authentication_response
 * @outputs       webauthn_options, credential_record, session_grant
 * @depends       @simplewebauthn/server, db.js, utils/logger.js
 * @db-read       webauthn_credentials, webauthn_challenges, users
 * @db-write      webauthn_credentials, webauthn_challenges
 * @db-txn        challenge_single_use, credential_id_unique, ceremony_separation
 * @doctrine      no_homemade_crypto, challenge_server_side_only, never_trust_client_origin
 * @impact-areas  auth
 * @version       2026-08
 */

'use strict';

const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { isoBase64URL } = require('@simplewebauthn/server/helpers');

const db = require('../db');
const log = require('../utils/logger').child({ module: 'webauthn-service' });

// ── Config (AUTH-2, décision actée dans la carte auth-passkey) ─────────────
// rpID = nom de domaine (sans schéma/port). En dev, localhost est un rpID valide.
const CHALLENGE_TTL_MS = 2 * 60 * 1000; // 2 min — court, comme prévu au plan AUTH-2

function _rpID() {
  return process.env.WEBAUTHN_RP_ID || 'localhost';
}

function _rpName() {
  return process.env.WEBAUTHN_RP_NAME || 'Komerce';
}

/**
 * Origines acceptées. WEBAUTHN_ORIGINS = liste séparée par des virgules
 * (ex: "https://komerce.shop,https://www.komerce.shop"). Fallback sur
 * FRONTEND_URL (déjà utilisé ailleurs dans le repo) pour ne pas dupliquer
 * une config en dev/staging.
 */
function _expectedOrigin() {
  if (process.env.WEBAUTHN_ORIGINS) {
    return process.env.WEBAUTHN_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return process.env.FRONTEND_URL || 'http://localhost:3000';
}

/** UUID user.id (DB) → 16 octets stables, opaques, sans PII — WebAuthn user.id. */
function _webauthnUserID(userId) {
  const hex = String(userId).replace(/-/g, '');
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

// ── Challenges ───────────────────────────────────────────────────────────

async function _storeChallenge({ userId, challenge, ceremonyType }) {
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  await db.query(
    `INSERT INTO webauthn_challenges (user_id, challenge, ceremony_type, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId || null, challenge, ceremonyType, expiresAt]
  );
}

/**
 * Consomme un challenge de façon atomique : un seul appelant peut gagner la
 * course (UPDATE ... WHERE consumed_at IS NULL RETURNING). Couvre à la fois
 * "déjà utilisé" (invariant #1) et "expiré" (invariant #2) en une requête.
 * Ne fait AUCUNE confiance à ce que le client prétend — la ligne trouvée est
 * la seule source de vérité pour user_id/ceremony_type attendus.
 */
async function _consumeChallenge({ challenge, ceremonyType }) {
  const { rows } = await db.query(
    `UPDATE webauthn_challenges
       SET consumed_at = NOW()
     WHERE challenge = $1
       AND consumed_at IS NULL
       AND expires_at > NOW()
     RETURNING id, user_id, ceremony_type`,
    [challenge]
  );
  if (!rows.length) {
    return { ok: false, reason: 'challenge_invalid_or_expired' };
  }
  const row = rows[0];
  // Invariant #6 — séparation des cérémonies : un challenge émis pour
  // 'register' ne peut pas servir à 'login', et inversement.
  if (row.ceremony_type !== ceremonyType) {
    return { ok: false, reason: 'ceremony_mismatch' };
  }
  return { ok: true, userId: row.user_id };
}

// ── Credentials ──────────────────────────────────────────────────────────

async function _findActiveCredentialsByUser(userId) {
  const { rows } = await db.query(
    `SELECT credential_id, transports FROM webauthn_credentials
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
  return rows;
}

async function _findCredentialByCredentialId(credentialId) {
  const { rows } = await db.query(
    `SELECT id, user_id, credential_id, public_key, sign_count, transports,
            backup_eligible, backup_state, revoked_at
     FROM webauthn_credentials WHERE credential_id = $1`,
    [credentialId]
  );
  return rows[0] || null;
}

// ── Enregistrement (2b) ──────────────────────────────────────────────────

async function getRegistrationOptions(user) {
  const existing = await _findActiveCredentialsByUser(user.id);

  const options = await generateRegistrationOptions({
    rpName: _rpName(),
    rpID: _rpID(),
    userID: _webauthnUserID(user.id),
    userName: user.phone || user.email || user.id,
    userDisplayName: user.full_name || user.phone || 'Client Komerce',
    attestationType: 'none', // doctrine §19
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
    },
    excludeCredentials: existing.map((c) => ({
      id: c.credential_id,
      transports: c.transports || undefined,
    })),
  });

  await _storeChallenge({ userId: user.id, challenge: options.challenge, ceremonyType: 'register' });
  return options;
}

async function verifyRegistration({ userId, response, deviceLabel }) {
  const consumed = await _consumeChallenge({
    challenge: _clientDataChallenge(response),
    ceremonyType: 'register',
  });

  if (!consumed.ok) {
    return { verified: false, error: consumed.reason };
  }
  // Invariant #3 — challenge lié au bon user : un challenge émis pour A ne
  // valide pas pour B.
  if (consumed.userId !== userId) {
    return { verified: false, error: 'user_mismatch' };
  }

  let result;
  try {
    result = await verifyRegistrationResponse({
      response,
      expectedChallenge: _clientDataChallenge(response),
      expectedOrigin: _expectedOrigin(),
      expectedRPID: _rpID(),
      requireUserVerification: true, // demandé ET vérifié (invariant #7)
    });
  } catch (err) {
    log.warn('[verifyRegistration] verification échouée:', err.message);
    return { verified: false, error: 'verification_failed' };
  }

  if (!result.verified || !result.registrationInfo) {
    return { verified: false, error: 'not_verified' };
  }

  const { credential, aaguid, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
  const credentialIdB64 = credential.id;

  // Invariant #9 — unicité credential_id (le UNIQUE index protège aussi en DB).
  const dup = await _findCredentialByCredentialId(credentialIdB64);
  if (dup) {
    return { verified: false, error: 'credential_already_registered' };
  }

  await db.query(
    `INSERT INTO webauthn_credentials
       (user_id, credential_id, public_key, sign_count, transports, aaguid,
        backup_eligible, backup_state, device_label)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      userId,
      credentialIdB64,
      isoBase64URL.fromBuffer(credential.publicKey),
      credential.counter || 0,
      response.response.transports || [],
      aaguid || null,
      credentialDeviceType === 'multiDevice',
      !!credentialBackedUp,
      deviceLabel || null,
    ]
  );

  return { verified: true };
}

// ── Connexion (2c) ───────────────────────────────────────────────────────

async function getLoginOptions({ phone } = {}) {
  let userId = null;
  let allowCredentials;

  if (phone) {
    const { rows } = await db.query('SELECT id FROM users WHERE phone = $1', [phone]);
    if (rows.length) {
      userId = rows[0].id;
      const creds = await _findActiveCredentialsByUser(userId);
      allowCredentials = creds.map((c) => ({ id: c.credential_id, transports: c.transports || undefined }));
    } else {
      // Ne pas révéler l'existence du compte : on génère quand même un
      // challenge "orphelin" (aucune credential ne pourra jamais matcher).
      allowCredentials = [];
    }
  }
  // Sans phone : discoverable credentials (resident keys) — allowCredentials
  // omis, le navigateur laisse l'utilisateur choisir. Décision actée : Komerce
  // supporte les deux, username-first (phone fourni) est le chemin recommandé
  // côté UI pour rester cohérent avec l'identité OTP existante.

  const options = await generateAuthenticationOptions({
    rpID: _rpID(),
    userVerification: 'required',
    allowCredentials,
  });

  await _storeChallenge({ userId, challenge: options.challenge, ceremonyType: 'login' });
  return options;
}

async function verifyLogin({ response }) {
  const credentialIdB64 = response?.id;
  if (!credentialIdB64) {
    return { verified: false, error: 'malformed_response' };
  }

  const stored = await _findCredentialByCredentialId(credentialIdB64);
  if (!stored) {
    return { verified: false, error: 'unknown_credential' };
  }
  // Invariant #10 — révocation.
  if (stored.revoked_at) {
    return { verified: false, error: 'credential_revoked' };
  }

  const consumed = await _consumeChallenge({
    challenge: _clientDataChallenge(response),
    ceremonyType: 'login',
  });
  if (!consumed.ok) {
    return { verified: false, error: consumed.reason };
  }
  // Si le challenge était lié à un user (login username-first), il doit
  // correspondre au propriétaire de la credential utilisée.
  if (consumed.userId && consumed.userId !== stored.user_id) {
    return { verified: false, error: 'user_mismatch' };
  }

  let result;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: _clientDataChallenge(response),
      expectedOrigin: _expectedOrigin(),
      expectedRPID: _rpID(),
      requireUserVerification: true,
      credential: {
        id: stored.credential_id,
        publicKey: isoBase64URL.toBuffer(stored.public_key),
        counter: Number(stored.sign_count),
        transports: stored.transports || undefined,
      },
    });
  } catch (err) {
    log.warn('[verifyLogin] verification échouée:', err.message);
    return { verified: false, error: 'verification_failed' };
  }

  if (!result.verified) {
    return { verified: false, error: 'not_verified' };
  }

  const { newCounter } = result.authenticationInfo;

  // Invariant #8 — politique signCount.
  // Passkeys synchronisées (backup_state=true) : signCount souvent figé à 0,
  // une "régression" n'est pas un signal de clonage → acceptée, tracée.
  // Credential non sauvegardée : régression = anomalie (clone possible) → rejet.
  if (!stored.backup_state && Number(stored.sign_count) > 0 && newCounter <= Number(stored.sign_count)) {
    log.warn('[verifyLogin] signCount régression détectée', {
      credentialId: credentialIdB64,
      stored: stored.sign_count,
      received: newCounter,
    });
    return { verified: false, error: 'sign_count_regression' };
  }

  await db.query(
    `UPDATE webauthn_credentials SET sign_count = $1, last_used_at = NOW() WHERE id = $2`,
    [newCounter, stored.id]
  );

  return { verified: true, userId: stored.user_id };
}


// ── Step-up AUTH-7 ───────────────────────────────────────────────────────
async function getStepUpOptions({ userId }) {
  const creds = await _findActiveCredentialsByUser(userId);
  if (!creds.length) return { available: false, reason: 'no_active_credential' };
  const options = await generateAuthenticationOptions({
    rpID: _rpID(),
    userVerification: 'required',
    allowCredentials: creds.map((c) => ({ id: c.credential_id, transports: c.transports || undefined })),
  });
  await _storeChallenge({ userId, challenge: options.challenge, ceremonyType: 'step_up' });
  return { available: true, options };
}

async function verifyStepUp({ userId, response }) {
  if (!response?.id) return { verified: false, error: 'malformed_response' };
  const expectedChallenge = _clientDataChallenge(response);
  const consumed = await _consumeChallenge({ challenge: expectedChallenge, ceremonyType: 'step_up' });
  if (!consumed.ok) return { verified: false, error: consumed.reason };
  if (consumed.userId !== userId) return { verified: false, error: 'user_mismatch' };

  const stored = await _findCredentialByCredentialId(response.id);
  if (!stored) return { verified: false, error: 'unknown_credential' };
  if (stored.user_id !== userId) return { verified: false, error: 'user_mismatch' };
  if (stored.revoked_at) return { verified: false, error: 'credential_revoked' };

  let result;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: _expectedOrigin(),
      expectedRPID: _rpID(),
      requireUserVerification: true,
      credential: {
        id: stored.credential_id,
        publicKey: isoBase64URL.toBuffer(stored.public_key),
        counter: Number(stored.sign_count),
        transports: stored.transports || undefined,
      },
    });
  } catch (err) {
    log.warn('[verifyStepUp] verification échouée:', err.message);
    return { verified: false, error: 'verification_failed' };
  }
  if (!result.verified) return { verified: false, error: 'not_verified' };
  const newCounter = result.authenticationInfo.newCounter;
  if (!stored.backup_state && Number(stored.sign_count) > 0 && newCounter <= Number(stored.sign_count)) {
    return { verified: false, error: 'sign_count_regression' };
  }
  await db.query('UPDATE webauthn_credentials SET sign_count = $1, last_used_at = NOW() WHERE id = $2', [newCounter, stored.id]);
  return { verified: true, userId };
}

// ── Helpers internes : extraction du challenge depuis clientDataJSON ──────
// On ne fait jamais confiance à un champ "challenge" que le client aurait pu
// nous renvoyer à part — on le relit depuis clientDataJSON, la même donnée
// que la lib va elle-même vérifier (signée par l'authenticator via origin/rpID).

function _clientDataChallenge(response) {
  const clientDataJSON = response?.response?.clientDataJSON;
  if (!clientDataJSON) return null;
  const decoded = JSON.parse(isoBase64URL.toUTF8String(clientDataJSON));
  return decoded.challenge;
}

module.exports = {
  getRegistrationOptions,
  verifyRegistration,
  getLoginOptions,
  verifyLogin,
  getStepUpOptions,
  verifyStepUp,
  // exporté pour tests
  _consumeChallenge,
  _clientDataChallenge,
};
