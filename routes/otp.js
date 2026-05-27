'use strict';

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');          // [P1-3] Hash des codes OTP
const jwt = require('jsonwebtoken');
const router = express.Router();
const pool = require('../db');
const { sendOtpMessage } = require('../services/notification-service');
const log = require('../utils/logger').child({ module: 'otp' });

// ─── Config ─────────────────────────────────────────────────
const OTP_LENGTH = 6;
const OTP_EXPIRY_MIN = 10;
const MAX_ATTEMPTS = 5;       // Max verify attempts per OTP
const RATE_LIMIT_MIN = 2;     // Min interval between OTP requests
const OTP_BCRYPT_ROUNDS = 8;  // [P1-3] 8 rounds = équilibre sécu/perf (OTP expire en 10min)

function normalizePhone(raw) {
  let phone = String(raw || '').replace(/[\s\-()]/g, '');
  if (!phone.startsWith('+')) {
    // Assume Comoros (+269) if no country code
    if (phone.startsWith('269')) phone = '+' + phone;
    else phone = '+269' + phone;
  }
  return phone;
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
    { id: user.id, role: user.role || 'client', phone, fullName: user.full_name, jti: crypto.randomUUID() },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES || '30d' }
  );
}

/**
 * POST /api/auth/otp/request
 * Send a 6-digit OTP via WhatsApp to the given phone number.
 * Rate-limited: 1 request per 2 minutes per phone.
 *
 * Doctrine identité légère : on n'exige pas que l'utilisateur existe déjà.
 * Le compte minimal est créé seulement après validation OTP.
 */
router.post('/request', async (req, res) => {
  try {
    let { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Numéro de téléphone requis' });
    }

    phone = normalizePhone(phone);
    if (!/^\+\d{8,15}$/.test(phone)) {
      return res.status(400).json({ success: false, error: 'Format de numéro invalide' });
    }

    // Rate limit: check last OTP for this phone before any user lookup/creation.
    const recentOtp = await pool.query(
      `SELECT created_at FROM otp_codes 
       WHERE phone = $1 AND created_at > NOW() - INTERVAL '${RATE_LIMIT_MIN} minutes'
       ORDER BY created_at DESC LIMIT 1`,
      [phone]
    );
    if (recentOtp.rows.length > 0) {
      const waitSec = Math.ceil(
        (new Date(recentOtp.rows[0].created_at).getTime() + RATE_LIMIT_MIN * 60000 - Date.now()) / 1000
      );
      return res.status(429).json({
        success: false,
        error: `Veuillez patienter ${waitSec}s avant de redemander un code.`,
        retryAfter: waitSec
      });
    }

    // Generate 6-digit OTP
    const code = String(crypto.randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MIN * 60 * 1000);

    // Invalidate previous OTPs for this phone
    await pool.query(
      `UPDATE otp_codes SET verified = TRUE WHERE phone = $1 AND verified = FALSE`,
      [phone]
    );

    // [P1-3] Hash du code avant stockage DB (ne jamais stocker en clair)
    const codeHash = await bcrypt.hash(code, OTP_BCRYPT_ROUNDS);

    // Store OTP (code hashé)
    await pool.query(
      `INSERT INTO otp_codes (phone, code, expires_at, attempts, created_at)
       VALUES ($1, $2, $3, 0, NOW())`,
      [phone, codeHash, expiresAt]
    );

    const existingUser = await findUserByPhone(phone);
    const customerName = existingUser?.full_name || 'Client Komerce';

    // [P0-1] Envoi OTP via canal générique (WhatsApp Meta + fallback SMS)
    const waResult = await sendOtpMessage({
      phone,
      code,
      name: customerName,
      expiryMin: OTP_EXPIRY_MIN,
    });

    log.info(`[OTP] 📱 Code envoyé → ${phone} (${waResult.success ? `✅ via ${waResult.channel}` : `❌ ${waResult.reason || waResult.error}`})`);

    res.json({
      success: true,
      message: 'Code envoyé par WhatsApp !',
      expiresIn: OTP_EXPIRY_MIN * 60,
      _dev: (process.env.NODE_ENV === 'development' && process.env.OTP_DEV_ECHO === 'true')
        ? { code, waResult: waResult.success }
        : undefined
    });
  } catch (err) {
    log.error('[OTP] ❌ request error:', err.message);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

/**
 * POST /api/auth/otp/verify
 * Validate OTP code and return JWT for authenticated client access.
 */
router.post('/verify', async (req, res) => {
  try {
    let { phone, code } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ success: false, error: 'Numéro et code requis' });
    }

    phone = normalizePhone(phone);
    code = String(code).trim();
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, error: 'Code à 6 chiffres requis' });
    }

    // Find valid OTP
    const otpResult = await pool.query(
      `SELECT id, code, attempts FROM otp_codes
       WHERE phone = $1 AND verified = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [phone]
    );

    if (otpResult.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Code expiré ou invalide. Redemandez un code.' });
    }

    const otp = otpResult.rows[0];

    // Check max attempts
    if (otp.attempts >= MAX_ATTEMPTS) {
      await pool.query(`UPDATE otp_codes SET verified = TRUE WHERE id = $1`, [otp.id]);
      return res.status(429).json({ success: false, error: 'Trop de tentatives. Redemandez un code.' });
    }

    // Increment attempts
    await pool.query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [otp.id]);

    // [P1-3] Verify code via bcrypt.compare (code stocké en DB est un hash)
    const codeMatches = await bcrypt.compare(code, otp.code);
    if (!codeMatches) {
      const remaining = MAX_ATTEMPTS - otp.attempts - 1;
      return res.status(401).json({
        success: false,
        error: `Code incorrect. ${remaining} tentative(s) restante(s).`
      });
    }

    // Mark as verified
    await pool.query(`UPDATE otp_codes SET verified = TRUE WHERE id = $1`, [otp.id]);

    // Find or create lightweight user after phone ownership is proven.
    let user = await findUserByPhone(phone);
    let created = false;
    if (!user) {
      user = await createLightweightUser(phone);
      created = true;
    }

    // Create unified JWT used by the main authenticate middleware.
    const token = signKomerceJwt(user, phone);

    // Unified auth cookie for boutique/API.
    res.cookie('kmrc_jwt', token, jwtCookieOptions());
    // Backward compatibility for any legacy client tracking code still reading kmrc_client.
    res.cookie('kmrc_client', token, jwtCookieOptions());

    log.info(`[OTP] ✅ Vérifié → ${user.full_name || 'Client Komerce'} (${phone})${created ? ' [created]' : ''}`);

    res.json({
      success: true,
      token,
      created,
      user: buildUserPayload(user, phone)
    });
  } catch (err) {
    log.error('[OTP] ❌ verify error:', err.message);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
