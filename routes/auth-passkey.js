/**
 * @komerce-arch
 * @role          auth-passkey-endpoints
 * @domain        auth-passkey
 * @layer         route
 * @criticality   high
 * @inputs        webauthn_registration_response, webauthn_authentication_response, phone
 * @outputs       webauthn_options, kmrc_jwt_cookie, credential_state
 * @depends       services/webauthn-service.js, utils/auth-cookie.js, middleware/auth.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       webauthn_credentials, webauthn_challenges, users (via webauthn-service)
 * @db-write      webauthn_credentials, webauthn_challenges (via webauthn-service)
 * @db-txn        challenge_single_use, ceremony_separation, no_client_trusted_origin
 * @doctrine      no_homemade_crypto, session_via_auth8_helper
 * @impact-areas  auth
 * @version       2026-08
 *
 * AUTH-2 — périmètre SERVEUR uniquement (voir PLAN_ATTAQUE_AUTH-2.md).
 * PAS l'UI front, PAS la proposition post-OTP (AUTH-3), PAS le login-passkey
 * nominal comme parcours par défaut (AUTH-4). Ce lot ajoute la capacité,
 * ne remplace aucun parcours OTP existant.
 */

'use strict';

const express = require('express');
const { randomUUID } = require('crypto');
const jwt = require('jsonwebtoken');

const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { setAuthCookie } = require('../utils/auth-cookie');
const webauthn = require('../services/webauthn-service');
const log = require('../utils/logger').child({ module: 'auth-passkey' });

const _JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES || '30d';

function _issueSession(res, user) {
  const token = jwt.sign(
    { id: user.id, role: user.role, jti: randomUUID() },
    _JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
  setAuthCookie(res, token);
}

// ── 2b — Enregistrement ──────────────────────────────────────────────────
// Contexte requis : utilisateur déjà authentifié (K1 minimum, cf. AUTH-1 §7).
// On n'enregistre une passkey que pour un compte dont le contrôle est déjà
// prouvé — jamais en anonyme.

router.post('/register/options', authenticate, async (req, res) => {
  try {
    const options = await webauthn.getRegistrationOptions(req.user);
    res.json(options);
  } catch (err) {
    log.error('[register/options] erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/register/verify', authenticate, async (req, res) => {
  try {
    const response = req.body;
    if (!response || typeof response !== 'object' || !response.id) {
      return res.status(400).json({ error: 'Réponse WebAuthn invalide' });
    }

    const result = await webauthn.verifyRegistration({
      userId: req.user.id,
      response,
      deviceLabel: req.body.deviceLabel || null,
    });

    if (!result.verified) {
      return res.status(400).json({ error: 'Enregistrement refusé', reason: result.error });
    }

    res.json({ verified: true });
  } catch (err) {
    log.error('[register/verify] erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── 2c — Connexion ───────────────────────────────────────────────────────
// Public par nature (c'est un mécanisme de login). `phone` optionnel :
// fourni → username-first (allowCredentials restreint) ; absent → discoverable.

router.post('/login/options', async (req, res) => {
  try {
    const { phone } = req.body || {};
    const options = await webauthn.getLoginOptions({ phone: phone || null });
    res.json(options);
  } catch (err) {
    log.error('[login/options] erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/login/verify', async (req, res) => {
  try {
    const response = req.body;
    if (!response || typeof response !== 'object' || !response.id) {
      return res.status(400).json({ error: 'Réponse WebAuthn invalide' });
    }

    const result = await webauthn.verifyLogin({ response });

    if (!result.verified) {
      return res.status(401).json({ error: 'Authentification refusée', reason: result.error });
    }

    // Session émise via le helper AUTH-8 — mêmes garanties que le login OTP.
    const { rows } = await db.query(
      'SELECT id, full_name, email, phone, role, currency_pref, relais_id FROM users WHERE id = $1',
      [result.userId]
    );
    if (!rows.length) {
      return res.status(401).json({ error: 'Utilisateur introuvable' });
    }

    _issueSession(res, rows[0]);
    res.json({ verified: true, user: { id: rows[0].id, full_name: rows[0].full_name, role: rows[0].role } });
  } catch (err) {
    log.error('[login/verify] erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
