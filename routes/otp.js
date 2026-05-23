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

/**
 * POST /api/auth/otp/request
 * Send a 6-digit OTP via WhatsApp to the given phone number.
 * Rate-limited: 1 request per 2 minutes per phone.
 */
router.post('/request', async (req, res) => {
  try {
    let { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Numéro de téléphone requis' });
    }

    // Normalize phone: ensure E.164 format
    phone = phone.replace(/[\s\-()]/g, '');
    if (!phone.startsWith('+')) {
      // Assume Comoros (+269) if no country code
      if (phone.startsWith('269')) phone = '+' + phone;
      else phone = '+269' + phone;
    }
    if (!/^\+\d{8,15}$/.test(phone)) {
      return res.status(400).json({ success: false, error: 'Format de numéro invalide' });
    }

    // Check if user exists with this phone
    const userCheck = await pool.query(
      `SELECT id, full_name FROM users WHERE phone = $1 OR whatsapp_phone = $1`,
      [phone]
    );
    if (userCheck.rows.length === 0) {
      // Don't reveal if user exists — but still return success
      // (prevents enumeration attacks)
      return res.json({
        success: true,
        message: 'Si ce numéro est enregistré, vous recevrez un code par WhatsApp.',
        expiresIn: OTP_EXPIRY_MIN * 60
      });
    }

    // Rate limit: check last OTP for this phone
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
    // La colonne `code` en DB continue d'être utilisée, mais contient désormais le hash bcrypt.
    // La migration DB n'est pas requise : bcrypt hash fait ~60 chars, VARCHAR(64) ou TEXT supporte.
    const codeHash = await bcrypt.hash(code, OTP_BCRYPT_ROUNDS);

    // Store OTP (code hashé)
    await pool.query(
      `INSERT INTO otp_codes (phone, code, expires_at, attempts, created_at)
       VALUES ($1, $2, $3, 0, NOW())`,
      [phone, codeHash, expiresAt]
    );

    // [P0-1] Envoi OTP via canal générique (WhatsApp Meta + fallback SMS)
    const customerName = userCheck.rows[0].full_name || 'Client';
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
      // [P0-4] Sécurisé v2 : uniquement en NODE_ENV === 'development' (pas staging ni autre)
      // ET seulement si la variable explicite OTP_DEV_ECHO=true est aussi définie.
      // Ça évite qu'un staging accessible publiquement expose les codes.
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

    // Normalize phone
    phone = phone.replace(/[\s\-()]/g, '');
    if (!phone.startsWith('+')) {
      if (phone.startsWith('269')) phone = '+' + phone;
      else phone = '+269' + phone;
    }

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

    // Find user
    const userResult = await pool.query(
      `SELECT id, full_name, phone, email, role FROM users
       WHERE phone = $1 OR whatsapp_phone = $1`,
      [phone]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Utilisateur introuvable' });
    }

    const user = userResult.rows[0];

    // Create JWT (7 days for client tracking)
    const token = jwt.sign(
      { id: user.id, role: 'client', phone, fullName: user.full_name },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Set cookie for convenience
    res.cookie('kmrc_client', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    log.info(`[OTP] ✅ Vérifié → ${user.full_name} (${phone})`);

    res.json({
      success: true,
      token,
      user: {
        name: user.full_name,
        phone: phone
      }
    });
  } catch (err) {
    log.error('[OTP] ❌ verify error:', err.message);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
