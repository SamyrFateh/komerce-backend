'use strict';

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const router = express.Router();
const pool = require('../db');
const { sendOtpMessage } = require('../services/notification-service');
const log = require('../utils/logger').child({ module: 'otp' });

// ─── Config ─────────────────────────────────────────────────
const OTP_LENGTH = 6;
const OTP_EXPIRY_MIN = 10;
const MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SEC = 45;
const OTP_WINDOW_MIN = 15;
const MAX_REQUESTS_PER_WINDOW = 3;
const OTP_BCRYPT_ROUNDS = 8;

const ALLOWED_PURPOSES = new Set([
  'login',
  'checkout',
  'shared_cart_access',
  'order_tracking',
  'pickup',
]);

const { normalizePhone: _normalizePhoneUtil } = require('../utils/phone');

// FIX W2 — normalisePhone unifié via utils/phone.js (indicatif +269 par défaut Comores).
// Supprimé : normalizer local qui forçait +269 sans validation longueur/format.
// utils/phone.js : normalizePhone(raw, defaultCountry) — valide E.164, refuse si invalide.
function normalizePhone(raw) {
  return _normalizePhoneUtil(raw, '+269');
}

function normalizePurpose(raw) {
  const purpose = String(raw || 'login').trim();
  return ALLOWED_PURPOSES.has(purpose) ? purpose : null;
}

function jwtCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

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

async function createLightweightUser(phone) {
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
    ['Client Komerce', resolvedEmail, phone, phone, passwordHash]
  );

  return user;
}

function signKomerceJwt(user, phone) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role || 'client',
      phone,
      fullName: user.full_name,
      jti: crypto.randomUUID(),
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES || '30d' }
  );
}

/**
 * POST /api/auth/otp/request
 *
 * UX Komerce :
 * téléphone → code OTP → session client légère.
 */
router.post('/request', async (req, res) => {
  try {
    let { phone, purpose = 'login' } = req.body || {};

    if (!phone) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: 'Numéro de téléphone requis',
      });
    }

    phone = normalizePhone(phone);
    purpose = normalizePurpose(purpose);

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

    const recentOtp = await pool.query(
      `SELECT created_at
         FROM otp_codes
        WHERE phone = $1
          AND purpose = $2
          AND created_at > NOW() - INTERVAL '45 seconds'
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

    const existingUser = await findUserByPhone(phone);
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
      _dev: (process.env.NODE_ENV === 'development' && process.env.OTP_DEV_ECHO === 'true')
        ? { code, waResult: waResult.success }
        : undefined,
    });
  } catch (err) {
    log.error({ err }, '[OTP] request error:');
    return res.status(500).json({
      ok: false,
      success: false,
      error: 'Erreur serveur',
    });
  }
});

/**
 * POST /api/auth/otp/verify
 */
router.post('/verify', async (req, res) => {
  try {
    let { phone, code, purpose = 'login' } = req.body || {};

    if (!phone || !code) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: 'Numéro et code requis',
      });
    }

    phone = normalizePhone(phone);
    code = String(code).trim();
    purpose = normalizePurpose(purpose);

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

    let user = await findUserByPhone(phone);
    let created = false;

    if (!user) {
      user = await createLightweightUser(phone);
      created = true;
    }

    const token = signKomerceJwt(user, phone);

    res.cookie('kmrc_jwt', token, jwtCookieOptions());
    // CONSOLIDATION AUTH — kmrc_client supprimé (jamais lu par middleware/auth.js ni auth-guest.js).
    // Cookie canonique unique : kmrc_jwt. requireClientAuth lit désormais kmrc_jwt directement.

    log.info(`[OTP] Vérifié → ${user.full_name || 'Client Komerce'} (${phone}) / purpose=${purpose}${created ? ' [created]' : ''}`);

    return res.json({
      ok: true,
      success: true,
      message: 'Numéro vérifié',
      created,
      user: buildUserPayload(user, phone),
    });
  } catch (err) {
    log.error({ err }, '[OTP] verify error:');
    return res.status(500).json({
      ok: false,
      success: false,
      error: 'Erreur serveur',
    });
  }
});

module.exports = router;
