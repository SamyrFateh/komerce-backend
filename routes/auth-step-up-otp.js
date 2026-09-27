/**
 * @komerce-arch
 * @role          auth-step-up-otp-endpoints
 * @domain        auth-identity
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_session
 * @outputs       otp_code_via_whatsapp, kmrc_jwt_cookie
 * @depends       services/notification-service.js, middleware/auth.js, utils/auth-session.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       users, otp_codes
 * @db-write      otp_codes
 * @db-txn        otp_single_use, own_phone_only, test_mode_never_prod
 * @doctrine      auth7_step_up_by_freshness_and_method, otp_une_fois
 * @impact-areas  auth, account-security
 * @version       2026-09
 */

'use strict';

/**
 * routes/auth-step-up-otp.js — AUTH-7b : step-up OTP du même compte.
 *
 * Complète routes/auth-passkey.js (step-up passkey) pour les comptes qui
 * n'ont pas encore de passkey enrôlée — le cas de la quasi-totalité des
 * market_operator aujourd'hui, puisque l'UX passkey n'est pas encore
 * câblée sur /login.html. requireRecentAuth (middleware/require-recent-
 * auth.js) répond déjà 428 avec `methods: ['passkey', 'otp']` — ce fichier
 * construit le chemin 'otp' manquant.
 *
 * Différences volontaires avec routes/otp.js (login client anonyme) :
 *   - authenticate est requis sur les deux endpoints : jamais anonyme.
 *   - le téléphone n'est JAMAIS lisible dans le body — toujours résolu
 *     depuis req.user (session déjà authentifiée), pour qu'un attaquant
 *     avec une session volée ne puisse pas demander un OTP vers UN AUTRE
 *     numéro et usurper le step-up.
 *   - aucune création de compte : l'utilisateur existe déjà (authenticate
 *     l'a chargé), on ne fait que prouver une possession récente du
 *     téléphone déjà enregistré sur ce compte.
 *   - même table otp_codes, purpose dédié 'step_up' (colonne texte libre,
 *     aucune contrainte CHECK en base — voir docs/db/railway-live-schema.sql).
 */

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { auth } = require('../validators');
const { setAuthCookie } = require('../utils/auth-cookie');
const { signAuthToken } = require('../utils/auth-session');
const { sendOtpMessage } = require('../services/notification-service');
const log = require('../utils/logger').child({ module: 'auth-step-up-otp' });

const { isOtpTestMode, getMasterCode, isMasterCode } = require('../services/otp-test-mode');

const OTP_LENGTH = 6;
const OTP_EXPIRY_MIN = 10;
const MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SEC = 300;
const OTP_WINDOW_MIN = 15;
const MAX_REQUESTS_PER_WINDOW = 3;
const OTP_BCRYPT_ROUNDS = 8;
const PURPOSE = 'step_up';

function ownPhone(user) {
  return user && user.phone ? String(user.phone) : null;
}

router.post('/request', authenticate, async (req, res, next) => {
  try {
    const phone = ownPhone(req.user);
    if (!phone) {
      return res.status(409).json({
        error: 'Aucun numéro de téléphone enregistré sur ce compte — impossible d’envoyer un code.',
        code: 'step_up_otp_no_phone',
        hint: 'Demandez à un administrateur d’ajouter un numéro à votre compte.',
      });
    }

    if (isOtpTestMode()) {
      log.warn(`[step-up-otp][TEST] /request court-circuité pour user=${req.user.id} (code maître)`);
      return res.json({
        ok: true,
        message: 'Code envoyé (TEST MODE)',
        expiresIn: OTP_EXPIRY_MIN * 60,
        retryAfter: 0,
        _test: { mode: true, code: getMasterCode() },
      });
    }

    const recentOtp = await db.query(
      `SELECT created_at
         FROM otp_codes
        WHERE phone = $1
          AND purpose = $2
          AND created_at > NOW() - INTERVAL '300 seconds'
        ORDER BY created_at DESC
        LIMIT 1`,
      [phone, PURPOSE]
    );

    if (recentOtp.rows.length > 0) {
      const waitSec = Math.max(
        1,
        Math.ceil(
          (new Date(recentOtp.rows[0].created_at).getTime() + OTP_RESEND_COOLDOWN_SEC * 1000 - Date.now()) / 1000
        )
      );
      return res.status(429).json({
        error: `Veuillez patienter ${waitSec}s avant de redemander un code.`,
        retryAfter: waitSec,
      });
    }

    const windowResult = await db.query(
      `SELECT COUNT(*)::int AS count
         FROM otp_codes
        WHERE phone = $1
          AND purpose = $2
          AND created_at > NOW() - INTERVAL '15 minutes'`,
      [phone, PURPOSE]
    );

    if ((windowResult.rows[0]?.count || 0) >= MAX_REQUESTS_PER_WINDOW) {
      return res.status(429).json({
        error: 'Trop de codes demandés. Réessayez dans quelques minutes.',
        retryAfter: OTP_WINDOW_MIN * 60,
      });
    }

    const code = String(crypto.randomInt(10 ** (OTP_LENGTH - 1), 10 ** OTP_LENGTH));
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MIN * 60 * 1000);

    // Un seul OTP 'step_up' non consommé à la fois par téléphone.
    await db.query(
      `UPDATE otp_codes
          SET verified = TRUE, consumed_at = COALESCE(consumed_at, NOW())
        WHERE phone = $1 AND purpose = $2 AND verified = FALSE`,
      [phone, PURPOSE]
    );

    const codeHash = await bcrypt.hash(code, OTP_BCRYPT_ROUNDS);
    await db.query(
      `INSERT INTO otp_codes (phone, code, purpose, expires_at, attempts, created_at)
       VALUES ($1, $2, $3, $4, 0, NOW())`,
      [phone, codeHash, PURPOSE, expiresAt]
    );

    const waResult = await sendOtpMessage({
      phone,
      code,
      name: req.user.full_name,
      expiryMin: OTP_EXPIRY_MIN,
    });

    log.info(`[step-up-otp] Code envoyé → user=${req.user.id} (${waResult.success ? `via ${waResult.channel}` : waResult.reason || waResult.error})`);

    return res.json({
      ok: true,
      message: 'Code envoyé',
      expiresIn: OTP_EXPIRY_MIN * 60,
      retryAfter: OTP_RESEND_COOLDOWN_SEC,
      _dev: (process.env.NODE_ENV === 'development' && process.env.OTP_DEV_ECHO === 'true')
        ? { code, waResult: waResult.success }
        : undefined,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/verify', authenticate, validate(auth.stepUpOtpVerify), async (req, res, next) => {
  try {
    const phone = ownPhone(req.user);
    if (!phone) {
      return res.status(409).json({
        error: 'Aucun numéro de téléphone enregistré sur ce compte.',
        code: 'step_up_otp_no_phone',
      });
    }

    const code = String(req.body.code).trim();

    if (isMasterCode(code)) {
      setAuthCookie(res, signAuthToken(req.user, { method: 'otp', phone }));
      log.warn(`[step-up-otp][TEST] Vérif court-circuitée (code maître) → user=${req.user.id}`);
      return res.json({ ok: true, verified: true, _test: { mode: true } });
    }

    const otpResult = await db.query(
      `SELECT id, code, attempts
         FROM otp_codes
        WHERE phone = $1
          AND purpose = $2
          AND verified = FALSE
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1`,
      [phone, PURPOSE]
    );

    if (otpResult.rows.length === 0) {
      return res.status(401).json({ error: 'Code expiré ou invalide. Redemandez un code.' });
    }

    const otp = otpResult.rows[0];

    if (otp.attempts >= MAX_ATTEMPTS) {
      await db.query(
        `UPDATE otp_codes SET verified = TRUE, consumed_at = COALESCE(consumed_at, NOW()) WHERE id = $1`,
        [otp.id]
      );
      return res.status(429).json({ error: 'Trop de tentatives. Redemandez un code.' });
    }

    await db.query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [otp.id]);

    const codeMatches = await bcrypt.compare(code, otp.code);
    if (!codeMatches) {
      const remaining = MAX_ATTEMPTS - otp.attempts - 1;
      return res.status(401).json({
        error: `Code incorrect. ${remaining} tentative(s) restante(s).`,
        remainingAttempts: remaining,
      });
    }

    await db.query(
      `UPDATE otp_codes SET verified = TRUE, consumed_at = COALESCE(consumed_at, NOW()) WHERE id = $1`,
      [otp.id]
    );

    // AUTH-8d : chaque step-up réussi est une vraie rotation de session
    // (nouvelle jti, auth_time frais, amr=['otp']) — même patron que
    // routes/auth-passkey.js#_issueSession.
    setAuthCookie(res, signAuthToken(req.user, { method: 'otp', phone }));

    log.info(`[step-up-otp] Vérifié → user=${req.user.id}`);
    return res.json({ ok: true, verified: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
