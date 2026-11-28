/**
 * @komerce-arch
 * @role          client-otp-session
 * @domain        auth-identity
 * @layer         route
 * @criticality   high
 * @inputs        phone, code, name, purpose
 * @outputs       kmrc_jwt_cookie, lightweight_user, otp_state
 * @depends       services/notification-service.js, services/otp-test-mode.js, utils/phone.js, db.js
 * @used-by       bootstrap/api-routes.js, public/boutique/js/b-identity.js, public/boutique/js/b-tracking.js, checkout
 * @db-read       otp_codes, users, assignment_memberships, market_operating_assignments, markets
 * @db-write      otp_codes, users
 * @db-txn        otp_single_use, test_mode_never_prod, phone_normalization
 * @doctrine      otp_une_fois, session_client_legere, test_mode_never_prod, phone_normalization
 * @impact-areas  checkout, participant-flow, tracking, shared-cart-access, auth
 * @version       2026-06
 */

'use strict';

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const router = express.Router();
const pool = require('../db');
const { sendOtpMessage } = require('../services/notification-service');
const log = require('../utils/logger').child({ module: 'otp' });

// ── TEST MODE (jamais actif en production) ──────────────────────────
const { isOtpTestMode, getMasterCode, isMasterCode } = require('../services/otp-test-mode');
const { hasPreparedG6BuyerOtp } = require('../services/g6-staging-buyer-identity-guard');

// ─── Config ─────────────────────────────────────────────────
const OTP_LENGTH = 6;
const OTP_EXPIRY_MIN = 10;
const MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SEC = 300; // FRESH-032: 5 min (ex 45s) — cohérent avec fenêtre 15 min / 3 max
const OTP_WINDOW_MIN = 15;
const MAX_REQUESTS_PER_WINDOW = 3;
const OTP_BCRYPT_ROUNDS = 8;

const INTERNAL_MARKET_LOGIN = 'internal_market_login';
const ALLOWED_PURPOSES = new Set([
  INTERNAL_MARKET_LOGIN,
  'login',
  'checkout',
  'shared_cart_access',
  'order_tracking',
  'pickup',
]);

const { normalizePhone: _normalizePhoneUtil } = require('../utils/phone');

function normalizePhone(raw) {
  return _normalizePhoneUtil(raw, '+269');
}

function normalizePurpose(raw) {
  const purpose = String(raw || 'login').trim();
  return ALLOWED_PURPOSES.has(purpose) ? purpose : null;
}

// AUTH-8a — cookie d'auth centralisé (utils/auth-cookie.js)
const { setAuthCookie, clearAuthCookie } = require('../utils/auth-cookie');
const { signAuthToken } = require('../utils/auth-session');

function buildUserPayload(user, phone) {
  return {
    id: user.id,
    name: user.full_name,
    full_name: user.full_name,
    phone: phone || user.phone || user.whatsapp_phone,
    role: user.role || 'client',
  };
}

async function findUserByPhone(phone) {
  const { rows } = await pool.query(
    `SELECT id, full_name, phone, whatsapp_phone, email, role
       FROM users
      WHERE phone = $1 OR whatsapp_phone = $1
      LIMIT 1`,
    [phone]
  );
  return rows[0] || null;
}

async function createLightweightUser(phone, name) {
  const resolvedEmail = phone.replace(/\D/g, '') + '@komerce.km';
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);

  const { rows: [user] } = await pool.query(
    `INSERT INTO users (full_name, email, phone, whatsapp_phone, password_hash, role, country, currency_pref)
     VALUES ($1, $2, $3, $4, $5, 'client', 'KM', 'KMF')
     ON CONFLICT (email) DO UPDATE
       SET phone = COALESCE(users.phone, EXCLUDED.phone),
           whatsapp_phone = COALESCE(users.whatsapp_phone, EXCLUDED.whatsapp_phone),
           updated_at = NOW()
     RETURNING id, full_name, phone, whatsapp_phone, email, role`,
    [name || 'Client', resolvedEmail, phone, phone, passwordHash]
  );

  return user;
}

function signKomerceJwt(user, phone) {
  return signAuthToken(user, { method: 'otp', phone, fullName: user.full_name });
}

// ════════════════════════════════════════════════════════════════════
// Helper interne : émet la session vérifiée (cookie + payload).
// Factorisé pour être réutilisé par le chemin normal ET le chemin test.
// ════════════════════════════════════════════════════════════════════
async function issueVerifiedSession(res, phone, name) {
  let user = await findUserByPhone(phone);
  let created = false;

  if (!user) {
    const safeName = (name && String(name).trim().slice(0, 50)) || null;
    user = await createLightweightUser(phone, safeName);
    created = true;
  }

  const token = signKomerceJwt(user, phone);
  setAuthCookie(res, token);

  return { user, created };
}


// Internal bootstrap authenticates an already provisioned lead only.
// It is not a user writer and does not determine dashboard permissions.
// Reject ambiguity even if only one of the matched accounts is a lead.
async function findInternalMarketLead(phone) {
  const { rows } = await pool.query(
    `SELECT u.id, u.full_name, u.phone, u.email, u.role,
            u.account_activation_required,
            EXISTS (
              SELECT 1 FROM assignment_memberships am
              JOIN market_operating_assignments a ON a.id=am.assignment_id
              JOIN markets m ON m.id=a.market_id
              WHERE am.user_id=u.id AND am.status='ACTIVE' AND am.is_operating_lead=TRUE
                AND a.status='ACTIVE' AND m.lifecycle_status IN ('PROVISIONING','ACTIVE','SUSPENDED')
            ) AS eligible_lead
       FROM users u WHERE u.phone=$1 OR u.whatsapp_phone=$1 LIMIT 2`,
    [phone]
  );
  const u = rows[0];
  return rows.length === 1 && u.role === 'market_operator' &&
    u.phone === phone && !u.account_activation_required && u.eligible_lead === true &&
    /^[a-z]+(?:-[a-z]+)*\.[a-z]+(?:-[a-z]+)*@komerce\.co$/.test(String(u.email || ''))
    ? u : null;
}

function internalOtpPurpose(user) {
  // Tie the challenge to the specific account, not just a reusable phone.
  return INTERNAL_MARKET_LOGIN + ':' + user.id;
}
function internalOtpDenied(res) {
  return res.status(401).json({ok:false,success:false,error:'Code expiré ou invalide. Redemandez un code.'});
}

async function verifyInternalMarketLogin(res, phone, code) {
  const user = await findInternalMarketLead(phone);
  if (!user) return internalOtpDenied(res);
  const purpose = internalOtpPurpose(user);
  // Reserve one attempt atomically. Concurrent attempts cannot bypass the cap.
  const attempt = await pool.query(
    `UPDATE otp_codes SET attempts=attempts+1
      WHERE id=(SELECT id FROM otp_codes WHERE phone=$1 AND purpose=$2
        AND verified=FALSE AND expires_at>NOW() ORDER BY created_at DESC LIMIT 1)
      AND verified=FALSE AND expires_at>NOW() AND attempts<$3
      RETURNING id,code`, [phone,purpose,MAX_ATTEMPTS]);
  const otp = attempt.rows[0];
  if (!otp || !(await bcrypt.compare(code, otp.code))) return internalOtpDenied(res);
  // Only one successful verification may consume this challenge.
  const consumed = await pool.query(
    `UPDATE otp_codes SET verified=TRUE,consumed_at=NOW()
      WHERE id=$1 AND verified=FALSE AND expires_at>NOW() RETURNING id`, [otp.id]);
  if (!consumed.rows[0]) return internalOtpDenied(res);
  const current = await findInternalMarketLead(phone);
  if (!current || current.id !== user.id) return internalOtpDenied(res);
  setAuthCookie(res, signKomerceJwt(current, phone));
  return res.json({ok:true,success:true,message:'Numéro vérifié',created:false,user:buildUserPayload(current,phone)});
}

/**
 * POST /api/auth/otp/request
 *
 * UX Komerce : téléphone → code OTP → session client légère.
 */
router.post('/request', async (req, res, next) => {
  try {
    let { phone, purpose = 'login' } = req.body || {};

    if (!phone) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: 'Numéro de téléphone requis',
      });
    }

    purpose = normalizePurpose(purpose);
    phone = purpose === INTERNAL_MARKET_LOGIN ? _normalizePhoneUtil(phone) : normalizePhone(phone);

    if (!/^\+\d{8,15}$/.test(phone)) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: 'Format de numéro invalide',
      });
    }

    if (!purpose) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: 'Usage OTP invalide',
      });
    }

    const internal = purpose === INTERNAL_MARKET_LOGIN;
    const internalUser = internal ? await findInternalMarketLead(phone) : null;
    // Same outward response for absent, ambiguous and ineligible accounts.
    if (internal && !internalUser) return res.json({ok:true,success:true,message:'Code envoyé',expiresIn:OTP_EXPIRY_MIN*60,retryAfter:OTP_RESEND_COOLDOWN_SEC});
    if (internal) purpose = internalOtpPurpose(internalUser);

    // G6 owner-provisioned buyer: the canonical OTP is already bcrypt-hashed
    // in otp_codes by a protected staging-only runner. Never call WhatsApp,
    // never echo its code, never fall through to the global test mode.
    const g6 = internal ? null : await hasPreparedG6BuyerOtp(pool, {phone,purpose});
    if (g6) {
      if (!g6.prepared) return res.status(409).json({
        ok:false,success:false,code:'G6_OTP_FIXTURE_MISSING',
        error:'Code de recette absent ou expiré',
      });
      return res.json({
        ok:true,success:true,message:'Code de recette préparé (aucun envoi externe)',
        expiresIn:600,retryAfter:0,
      });
    }

    // ── TEST MODE : court-circuit, pas d'envoi WhatsApp, code maître ──
    // Renvoie immédiatement le code maître pour que le test l'utilise.
    // (jamais atteint en production : isOtpTestMode() y est toujours false)
    if (!internal && isOtpTestMode()) {
      log.warn(`[OTP][TEST] /request court-circuité pour ${phone} (code maître)`);
      return res.json({
        ok: true,
        success: true,
        message: 'Code envoyé (TEST MODE)',
        expiresIn: OTP_EXPIRY_MIN * 60,
        retryAfter: 0,
        _test: { mode: true, code: getMasterCode() },
      });
    }
    // ── /TEST MODE ────────────────────────────────────────────────────

    const recentOtp = await pool.query(
      `SELECT created_at
         FROM otp_codes
        WHERE phone = $1
          AND purpose = $2
          AND created_at > NOW() - INTERVAL '300 seconds' -- FRESH-032: cooldown 5 min
        ORDER BY created_at DESC
        LIMIT 1`,
      [phone, purpose]
    );

    if (recentOtp.rows.length > 0) {
      const waitSec = Math.max(
        1,
        Math.ceil(
          (new Date(recentOtp.rows[0].created_at).getTime() + OTP_RESEND_COOLDOWN_SEC * 1000 - Date.now()) / 1000
        )
      );

      return res.status(429).json({
        ok: false,
        success: false,
        error: `Veuillez patienter ${waitSec}s avant de redemander un code.`,
        retryAfter: waitSec,
      });
    }

    const windowResult = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM otp_codes
        WHERE phone = $1
          AND purpose = $2
          AND created_at > NOW() - INTERVAL '15 minutes'`,
      [phone, purpose]
    );

    if ((windowResult.rows[0]?.count || 0) >= MAX_REQUESTS_PER_WINDOW) {
      return res.status(429).json({
        ok: false,
        success: false,
        error: 'Trop de codes demandés. Réessayez dans quelques minutes.',
        retryAfter: OTP_WINDOW_MIN * 60,
      });
    }

    const code = String(crypto.randomInt(10 ** (OTP_LENGTH - 1), 10 ** OTP_LENGTH));
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MIN * 60 * 1000);

    await pool.query(
      `UPDATE otp_codes
          SET verified = TRUE,
              consumed_at = COALESCE(consumed_at, NOW())
        WHERE phone = $1
          AND purpose = $2
          AND verified = FALSE`,
      [phone, purpose]
    );

    const codeHash = await bcrypt.hash(code, OTP_BCRYPT_ROUNDS);

    await pool.query(
      `INSERT INTO otp_codes (phone, code, purpose, expires_at, attempts, created_at)
       VALUES ($1, $2, $3, $4, 0, NOW())`,
      [phone, codeHash, purpose, expiresAt]
    );

    // Internal staging tests exercise the real hashed, single-use challenge.
    // The global master code is never accepted for this purpose.
    if (internal && isOtpTestMode()) return res.json({ok:true,success:true,message:'Code envoyé (TEST MODE)',expiresIn:OTP_EXPIRY_MIN*60,retryAfter:OTP_RESEND_COOLDOWN_SEC,_test:{mode:true,code}});
    const existingUser = internalUser || await findUserByPhone(phone);
    const customerName = existingUser?.full_name || 'Client Komerce';

    const waResult = await sendOtpMessage({
      phone,
      code,
      name: customerName,
      expiryMin: OTP_EXPIRY_MIN,
    });

    log.info(`[OTP] Code envoyé → ${phone} / purpose=${purpose} (${waResult.success ? `via ${waResult.channel}` : waResult.reason || waResult.error})`);

    return res.json({
      ok: true,
      success: true,
      message: 'Code envoyé',
      expiresIn: OTP_EXPIRY_MIN * 60,
      retryAfter: OTP_RESEND_COOLDOWN_SEC,
      _dev: (!internal && process.env.NODE_ENV === 'development' && process.env.OTP_DEV_ECHO === 'true')
        ? { code, waResult: waResult.success }
        : undefined,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/otp/verify
 */
router.post('/verify', async (req, res, next) => {
  try {
    let { phone, code, name, purpose = 'login' } = req.body || {};

    if (!phone || !code) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: 'Numéro et code requis',
      });
    }

    purpose = normalizePurpose(purpose);
    phone = purpose === INTERNAL_MARKET_LOGIN ? _normalizePhoneUtil(phone) : normalizePhone(phone);
    code = String(code).trim();

    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: 'Code à 6 chiffres requis',
      });
    }

    if (!purpose) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: 'Usage OTP invalide',
      });
    }

    if (purpose === INTERNAL_MARKET_LOGIN) {
      if (!/^\+\d{8,15}$/.test(phone || '')) return internalOtpDenied(res);
      return await verifyInternalMarketLogin(res, phone, code);
    }

    // ── TEST MODE : le code maître valide pour n'importe quel numéro ──
    // Court-circuite la vérification DB/bcrypt → session immédiate.
    // (jamais atteint en production : isMasterCode() y est toujours false)
    if (isMasterCode(code) && !(await hasPreparedG6BuyerOtp(pool, {phone,purpose}))) {
      const { user, created } = await issueVerifiedSession(res, phone, name);
      log.warn(`[OTP][TEST] Vérif court-circuitée (code maître) → ${phone}${created ? ' [created]' : ''}`);
      return res.json({
        ok: true,
        success: true,
        message: 'Numéro vérifié (TEST MODE)',
        created,
        user: buildUserPayload(user, phone),
        _test: { mode: true },
      });
    }
    // ── /TEST MODE ────────────────────────────────────────────────────

    const otpResult = await pool.query(
      `SELECT id, code, attempts
         FROM otp_codes
        WHERE phone = $1
          AND purpose = $2
          AND verified = FALSE
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1`,
      [phone, purpose]
    );

    if (otpResult.rows.length === 0) {
      return res.status(401).json({
        ok: false,
        success: false,
        error: 'Code expiré ou invalide. Redemandez un code.',
      });
    }

    const otp = otpResult.rows[0];

    if (otp.attempts >= MAX_ATTEMPTS) {
      await pool.query(
        `UPDATE otp_codes
            SET verified = TRUE,
                consumed_at = COALESCE(consumed_at, NOW())
          WHERE id = $1`,
        [otp.id]
      );

      return res.status(429).json({
        ok: false,
        success: false,
        error: 'Trop de tentatives. Redemandez un code.',
      });
    }

    await pool.query(
      `UPDATE otp_codes
          SET attempts = attempts + 1
        WHERE id = $1`,
      [otp.id]
    );

    const codeMatches = await bcrypt.compare(code, otp.code);

    if (!codeMatches) {
      const remaining = MAX_ATTEMPTS - otp.attempts - 1;
      return res.status(401).json({
        ok: false,
        success: false,
        error: `Code incorrect. ${remaining} tentative(s) restante(s).`,
        remainingAttempts: remaining,
      });
    }

    await pool.query(
      `UPDATE otp_codes
          SET verified = TRUE,
              consumed_at = COALESCE(consumed_at, NOW())
        WHERE id = $1`,
      [otp.id]
    );

    const { user, created } = await issueVerifiedSession(res, phone, name);

    log.info(`[OTP] Vérifié → ${user.full_name || 'Client Komerce'} (${phone}) / purpose=${purpose}${created ? ' [created]' : ''}`);

    return res.json({
      ok: true,
      success: true,
      message: 'Numéro vérifié',
      created,
      user: buildUserPayload(user, phone),
    });
  } catch (err) {
    next(err);
  }
});

// ════════════════════════════════════════════════════════════════════
// POST /api/auth/otp/test-reset   (TEST MODE uniquement)
// ════════════════════════════════════════════════════════════════════
// Efface le cookie de session côté serveur (kmrc_jwt est httpOnly →
// JS navigateur ne peut PAS le supprimer, d'où ce endpoint) et, si un
// `phone` est fourni, purge le user de test léger + ses OTP, pour
// rejouer un parcours d'authentification "à neuf".
//
// Sécurité : 404 si hors mode test (donc invisible/inerte en production).
router.post('/test-reset', async (req, res, next) => {
  if (!isOtpTestMode()) {
    return res.status(404).json({ ok: false, error: 'Not found' });
  }

  // 1) Efface la session courante (cookie httpOnly)
  clearAuthCookie(res);

  // 2) Purge optionnelle du user de test + ses OTP
  let purged = null;
  try {
    const rawPhone = req.body && req.body.phone;
    if (rawPhone) {
      const phone = normalizePhone(rawPhone);
      await pool.query('DELETE FROM otp_codes WHERE phone = $1', [phone]);

      // On ne supprime QUE les comptes légers synthétiques (@komerce.km),
      // jamais un vrai compte admin/agent.
      const { rows } = await pool.query(
        `DELETE FROM users
          WHERE (phone = $1 OR whatsapp_phone = $1)
            AND email LIKE '%@komerce.km'
            AND role = 'client'
          RETURNING id, phone`,
        [phone]
      );
      purged = { phone, deletedUsers: rows.length };
      log.warn(`[OTP][TEST] test-reset → ${phone} (users supprimés: ${rows.length})`);
    }
  } catch (err) {
    next(err);
  }

  const { AUTH_COOKIE_NAME } = require('../utils/auth-cookie');
  return res.json({ ok: true, success: true, cleared: AUTH_COOKIE_NAME, purged });
});

module.exports = router;
