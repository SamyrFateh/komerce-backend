/**
 * @komerce-arch
 * @role          auth-passkey-endpoints
 * @domain        auth-passkey
 * @layer         route
 * @criticality   high
 * @inputs        webauthn_registration_response, webauthn_authentication_response, credential_management_id, phone
 * @outputs       webauthn_options, kmrc_jwt_cookie, credential_state, safe_credential_metadata
 * @depends       services/webauthn-service.js, services/webauthn-management-service.js, utils/auth-cookie.js, middleware/auth.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       users
 * @db-write      none
 * @db-txn        challenge_single_use, ceremony_separation, no_client_trusted_origin, revoke_only_own_credential
 * @doctrine      no_homemade_crypto, session_via_auth8_helper, auth6_authenticator_management
 * @impact-areas  auth, account-security
 * @version       2026-08
 */

'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireRecentAuth } = require('../middleware/require-recent-auth');
const { setAuthCookie } = require('../utils/auth-cookie');
const { signAuthToken } = require('../utils/auth-session');
const webauthn = require('../services/webauthn-service');
const management = require('../services/webauthn-management-service');
const log = require('../utils/logger').child({ module: 'auth-passkey' });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function _issueSession(res, user, method = 'passkey') {
  setAuthCookie(res, signAuthToken(user, { method }));
}

// ── AUTH-6 — Gestion des authentificateurs ───────────────────────────────
// L'UI reçoit uniquement un identifiant de gestion opaque + métadonnées sûres.
// credential_id/public_key/sign_count ne sortent jamais de cette frontière.

router.get('/credentials', authenticate, async (req, res) => {
  try {
    const credentials = await management.listCredentials(req.user.id);
    res.json({ credentials });
  } catch (err) {
    log.error('[credentials] erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/credentials/:id', authenticate, requireRecentAuth, async (req, res) => {
  try {
    const managementId = String(req.params.id || '');
    if (!UUID_RE.test(managementId)) {
      return res.status(400).json({ error: 'Identifiant de passkey invalide' });
    }

    const result = await management.revokeCredential({
      userId: req.user.id,
      credentialManagementId: managementId,
    });
    if (!result.revoked) {
      return res.status(404).json({ error: 'Passkey introuvable' });
    }
    res.json({ revoked: true, id: result.id });
  } catch (err) {
    log.error('[credentials/revoke] erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});


// ── AUTH-7 — Step-up du même compte ─────────────────────────────────────
router.post('/step-up/options', authenticate, async (req, res) => {
  try {
    const result = await webauthn.getStepUpOptions({ userId: req.user.id });
    if (!result.available) return res.status(409).json({ error: 'Aucune passkey active', code: 'passkey_step_up_unavailable' });
    res.json(result.options);
  } catch (err) {
    log.error('[step-up/options] erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/step-up/verify', authenticate, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || !req.body.id) return res.status(400).json({ error: 'Réponse WebAuthn invalide' });
    const result = await webauthn.verifyStepUp({ userId: req.user.id, response: req.body });
    if (!result.verified) return res.status(401).json({ error: 'Confirmation refusée', reason: result.error });
    _issueSession(res, req.user, 'passkey');
    res.json({ verified: true });
  } catch (err) {
    log.error('[step-up/verify] erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── AUTH-2/3 — Enregistrement ────────────────────────────────────────────
// Contexte requis : utilisateur déjà authentifié (K1 minimum).

router.post('/register/options', authenticate, requireRecentAuth, async (req, res) => {
  try {
    const options = await webauthn.getRegistrationOptions(req.user);
    res.json(options);
  } catch (err) {
    log.error('[register/options] erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/register/verify', authenticate, requireRecentAuth, async (req, res) => {
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

// ── AUTH-2/4 — Connexion ─────────────────────────────────────────────────
// Public par nature. `phone` optionnel : fourni → username-first ; absent → discoverable.

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

    const { rows } = await db.query(
      'SELECT id, full_name, email, phone, role, currency_pref, relais_id FROM users WHERE id = $1',
      [result.userId]
    );
    if (!rows.length) {
      return res.status(401).json({ error: 'Utilisateur introuvable' });
    }

    const user = rows[0];
    _issueSession(res, user);
    res.json({
      verified: true,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        currency_pref: user.currency_pref,
        relais_id: user.relais_id,
      },
    });
  } catch (err) {
    log.error('[login/verify] erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
