/**
 * @komerce-arch
 * @role          auth-auth
 * @domain        auth-identity
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       loyalty_tiers, users
 * @db-write      revoked_tokens, users
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  auth
 * @version       2026-06
 */


'use strict';
/**
 * KOMERCE — Authentification
 *
 * POST /api/auth/register   → création de compte
 * POST /api/auth/login      → connexion, retourne JWT + cookie httpOnly
 * POST /api/auth/logout     → déconnexion, supprime le cookie
 * GET  /api/auth/me         → profil de l'utilisateur connecté
 * PUT  /api/auth/me         → mise à jour profil
 */

const express      = require('express');
const { randomBytes, randomUUID } = require('crypto');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const db       = require('../db');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { auth } = require('../validators');
const log = require('../utils/logger').child({ module: 'auth' });

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  log.error('FATAL: JWT_SECRET manquant — démarrage impossible');
  process.exit(1); // N7: pas de fallback autorisé, même en dev
}
const _JWT_SECRET = JWT_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES || '30d';

const COOKIE_NAME = 'kmrc_jwt';

function cookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  const expiresStr = process.env.JWT_EXPIRES || '30d';
  const match = expiresStr.match(/(\d+)(d|h|m)/);
  let maxAge = 30 * 24 * 60 * 60 * 1000;
  if (match) {
    const val = parseInt(match[1]);
    if (match[2] === 'd') maxAge = val * 24 * 60 * 60 * 1000;
    if (match[2] === 'h') maxAge = val * 60 * 60 * 1000;
    if (match[2] === 'm') maxAge = val * 60 * 1000;
  }
  return { httpOnly: true, secure: isProd, sameSite: 'Strict', maxAge, path: '/' };
}

function setAuthCookie(res, token) { res.cookie(COOKIE_NAME, token, cookieOptions()); }
function clearAuthCookie(res) { res.clearCookie(COOKIE_NAME, { httpOnly: true, path: '/' }); }

function generateToken(user) {
  // N4 — jti unique pour permettre la révocation individuelle (migration 072)
  return jwt.sign({ id: user.id, role: user.role, jti: randomUUID() }, _JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function userResponse(user) {
  const { password_hash, ...safe } = user;
  return safe;
}

// ─── POST /api/auth/register ─────────────────────────────────────────────────────

router.post('/register', validate(auth.register), async (req, res, next) => {
  try {
    const { full_name, email, phone, password, country = 'KM', currency_pref = 'KMF' } = req.body;
    if (!phone) return res.status(400).json({ error: 'Le téléphone est obligatoire' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'Mot de passe minimum 6 caractères' });

    if (email) {
      const { rows: existing } = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
      if (existing.length) return res.status(409).json({ error: 'Cet email est déjà utilisé' });
    }
    const { rows: existingPhone } = await db.query('SELECT id FROM users WHERE phone = $1', [phone]);
    if (existingPhone.length) return res.status(409).json({ error: 'Ce numéro de téléphone est déjà utilisé' });

    const password_hash = await bcrypt.hash(password, 10);
    const { rows: [user] } = await db.query(
      `INSERT INTO users (full_name, email, phone, password_hash, role, country, currency_pref)
       VALUES ($1, $2, $3, $4, 'client', $5, $6) RETURNING *`,
      [full_name || null, email ? email.toLowerCase() : null, phone, password_hash, country, currency_pref]
    );
    const token = generateToken(user);
    setAuthCookie(res, token);
    res.status(201).json({ user: userResponse(user) });
  } catch(err) { next(err); }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────────

router.post('/login', validate(auth.login), async (req, res, next) => {
  try {
    const { email, phone, password } = req.body;
    if (!password) return res.status(400).json({ error: 'Mot de passe obligatoire' });
    if (!email && !phone) return res.status(400).json({ error: 'Email ou téléphone obligatoire' });

    let rows;
    if (email) {
      ({ rows } = await db.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]));
    } else {
      ({ rows } = await db.query('SELECT * FROM users WHERE phone = $1', [phone]));
    }

    if (!rows.length) return res.status(401).json({ error: 'Identifiants incorrects' });
    const user = rows[0];
    if (!user.password_hash) return res.status(401).json({ error: 'Identifiants incorrects' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Identifiants incorrects' });

    const token = generateToken(user);
    setAuthCookie(res, token);
    res.json({ user: userResponse(user) });
  } catch(err) { next(err); }
});

// ─── GET /api/auth/me ──────────────────────────────────────────────────────────

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const { rows: [user] } = await db.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.country,
              u.currency_pref, u.created_at, u.orders_count,
              lt.label AS loyalty_label, lt.badge AS loyalty_badge,
              lt.discount_pct AS loyalty_discount_pct,
              (SELECT lt2.min_orders
               FROM loyalty_tiers lt2
               WHERE lt2.min_orders > COALESCE(lt.min_orders, 0)
               ORDER BY lt2.min_orders ASC LIMIT 1
              ) - u.orders_count AS orders_until_next_tier
       FROM users u
       LEFT JOIN loyalty_tiers lt ON lt.id = u.loyalty_tier_id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/auth/me ──────────────────────────────────────────────────────────

router.put('/me', authenticate, validate(auth.updateProfile), async (req, res, next) => {
  try {
    // Lot 4 §3.4 — phone n'est plus accepté par le schéma (validators/index.js) :
    // le WhatsApp vérifié se modifie uniquement via le parcours OTP existant,
    // jamais par ce endpoint générique. On ne le lit ni ne l'écrit ici.
    const { full_name, currency_pref } = req.body;
    const { rows: [user] } = await db.query(
      `UPDATE users SET full_name = COALESCE($1, full_name),
       currency_pref = COALESCE($2, currency_pref), updated_at = NOW()
       WHERE id = $3 RETURNING id, full_name, email, phone, role, country, currency_pref`,
      [full_name, currency_pref, req.user.id]
    );
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// ─── /api/auth/me/pickup-authorization — Lot 5 ────────────────────────────────
// Autorisation nominative de retrait exceptionnel. Sous-ressource du profil,
// propriétaire = auth-identity (services/pickup-authorization-service.js).
// La session authentifiée existante suffit (§9 du lot — pas de nouvel OTP).

const {
  getMyAuthorization,
  setMyAuthorization,
  deleteMyAuthorization,
} = require('../services/pickup-authorization-service');

router.get('/me/pickup-authorization', authenticate, async (req, res, next) => {
  try {
    const result = await getMyAuthorization(req.user.id);
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

router.put('/me/pickup-authorization', authenticate, validate(auth.pickupAuthorization), async (req, res, next) => {
  try {
    const result = await setMyAuthorization({
      userId:      req.user.id,
      givenNames:  req.body.given_names,
      familyName:  req.body.family_name,
    });
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

router.delete('/me/pickup-authorization', authenticate, async (req, res, next) => {
  try {
    const result = await deleteMyAuthorization(req.user.id);
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

// ─── POST /api/auth/guest-checkout — SUPPRIMÉ (faille de sécurité) ───────────────
// Cette route créait un compte (ou réutilisait un compte EXISTANT) et posait une
// session SANS vérification OTP → prise de contrôle de compte possible en tapant
// directement l'API. RÈGLE SANS EXCEPTION : toute commande exige une identité
// vérifiée par OTP. Le checkout passe désormais par /api/auth/otp/request+verify.
router.post('/guest-checkout', (req, res) => {
  return res.status(410).json({
    error: 'Cette voie a été retirée. Vérifiez votre numéro par OTP pour commander.',
    code: 'guest_checkout_removed',
  });
});

// ─── POST /api/auth/auto-register ─────────────────────────────────────────────────

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

function requireInternalKey(req, res, next) {
  if (!INTERNAL_API_KEY) return res.status(503).json({ error: 'Endpoint désactivé' });
  const provided = req.headers['x-internal-key'];
  if (!provided || provided !== INTERNAL_API_KEY) return res.status(401).json({ error: 'Clé interne invalide ou absente' });
  next();
}

router.post('/auto-register', requireInternalKey, validate(auth.autoRegister), async (req, res, next) => {
  try {
    const { full_name, phone, email, country = 'KM', whatsapp_phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Téléphone obligatoire' });
    const resolvedEmail = email || (phone.replace(/\D/g, '') + '@komerce.km');
    const { rows: existing } = await db.query(
      `SELECT id FROM users WHERE email = $1 OR phone = $2 LIMIT 1`, [resolvedEmail, phone]
    );
    if (existing.length) {
      const { rows: [user] } = await db.query(`SELECT * FROM users WHERE id = $1`, [existing[0].id]);
      setAuthCookie(res, generateToken(user));
      return res.json({ user: userResponse(user), created: false });
    }
    const password_hash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
    const { rows: [user] } = await db.query(
      `INSERT INTO users (full_name, email, phone, whatsapp_phone, password_hash, role, country, currency_pref)
       VALUES ($1, $2, $3, $4, $5, 'client', $6, 'KMF') RETURNING *`,
      [full_name || 'Client Komerce', resolvedEmail, phone, whatsapp_phone || null, password_hash, country]
    );
    setAuthCookie(res, generateToken(user));
    res.status(201).json({ user: userResponse(user), created: true });
  } catch(err) { next(err); }
});

// ─── POST /api/auth/orders-by-phone ───────────────────────────────────────────────

const _phoneLookupAttempts = new Map();

function checkPhoneLookupRateLimit(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const now = Date.now();
  const WIN = 15 * 60 * 1000; const MAX = 5;
  let entry = _phoneLookupAttempts.get(ip);
  if (!entry || now > entry.resetAt) entry = { count: 0, resetAt: now + WIN };
  entry.count++; _phoneLookupAttempts.set(ip, entry);
  if (entry.count > MAX) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans 15 minutes.' });
  next();
}

router.post('/orders-by-phone', checkPhoneLookupRateLimit, validate(auth.ordersByPhone), async (req, res, next) => {
  try {
    const { phone } = req.body;
    if (!phone || typeof phone !== 'string' || phone.trim().length < 6)
      return res.status(400).json({ error: 'Numéro de téléphone invalide' });
    const cleanPhone = phone.trim();
    const { rows } = await db.query(
      `SELECT id, full_name, phone FROM users WHERE phone = $1 LIMIT 1`, [cleanPhone]
    );
    if (!rows.length) return res.json({ orders: [], name: null });
    const user = rows[0];
    const token = jwt.sign({ id: user.id, role: user.role, scope: 'orders_read' }, _JWT_SECRET, { expiresIn: '2h' });
    res.json({ token, name: user.full_name });
  } catch(err) { next(err); }
});

// ─── POST /api/auth/logout ──────────────────────────────────────────────────────────
// N4 — révocation du token JWT actif au moment du logout (migration 072)
// jwt.decode() est utilisé (pas verify) car on veut révoquer même un token
// qu'on ne pourrait pas vérifier (edge case). Non-fatal : si la DB échoue,
// le cookie est quand même supprimé (le token expire naturellement sous 30j).
router.post('/logout', async (req, res) => {
  try {
    const token =
      req.cookies?.[COOKIE_NAME] ||
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.split(' ')[1]
        : null);
    if (token) {
      const decoded = jwt.decode(token);
      if (decoded?.jti && decoded?.exp) {
        await db.query(
          `INSERT INTO revoked_tokens (jti, expires_at)
           VALUES ($1, to_timestamp($2))
           ON CONFLICT (jti) DO NOTHING`,
          [decoded.jti, decoded.exp]
        );
      }
    }
  } catch (err) {
    log.warn({ err }, 'logout: échec INSERT revoked_tokens — non-fatal');
  }
  clearAuthCookie(res);
  res.json({ message: 'Déconnexion réussie' });
});

// ─── POST /api/auth/admin-reset ─────────────────────────────────────────────────
// [P0-3] Sécurisé v2 :
//   · Bloqué en production sauf si ADMIN_RESET_KEY explicitement définie ET ≥ 32 chars
//   · Plus de fallback 'komerce-dev-2026' — la variable d'env est OBLIGATOIRE
//   · Log chaque tentative (succès ou échec) pour audit
router.post('/admin-reset', validate(auth.adminReset), async (req, res, next) => {
  try {
    const resetKey = process.env.ADMIN_RESET_KEY;

    // Sécurité 1 : pas de clé configurée → route désactivée
    if (!resetKey) {
      log.warn(`[admin-reset] ⛔ ADMIN_RESET_KEY non définie — tentative refusée (IP: ${req.ip})`);
      return res.status(503).json({
        error: 'Route de reset désactivée (ADMIN_RESET_KEY non configurée)'
      });
    }

    // Sécurité 2 : clé trop faible (< 32 chars) → route désactivée
    if (resetKey.length < 32) {
      log.warn(`[admin-reset] ⛔ ADMIN_RESET_KEY trop faible (< 32 chars) — tentative refusée (IP: ${req.ip})`);
      return res.status(503).json({
        error: 'Route de reset désactivée (ADMIN_RESET_KEY doit faire au moins 32 caractères)'
      });
    }

    // Sécurité 3 : bloqué en production sauf si ALLOW_ADMIN_RESET=true explicitement
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_ADMIN_RESET !== 'true') {
      log.warn(`[admin-reset] ⛔ Tentative en production sans ALLOW_ADMIN_RESET=true (IP: ${req.ip})`);
      return res.status(403).json({
        error: 'Route désactivée en production',
        hint: 'Définir ALLOW_ADMIN_RESET=true pour autoriser temporairement'
      });
    }

    const { key, new_password } = req.body;

    // Comparaison constante pour éviter le timing attack
    const crypto = require('crypto');
    const keyBuf      = Buffer.from(String(key || ''));
    const resetKeyBuf = Buffer.from(resetKey);
    const keysMatch   = keyBuf.length === resetKeyBuf.length &&
                        crypto.timingSafeEqual(keyBuf, resetKeyBuf);

    if (!keysMatch) {
      log.warn(`[admin-reset] ⛔ Clé invalide (IP: ${req.ip})`);
      return res.status(403).json({ error: 'Clé de reset invalide' });
    }

    if (!new_password || new_password.length < 12) {
      return res.status(400).json({ error: 'Mot de passe minimum 12 caractères' });
    }

    const hash = await bcrypt.hash(new_password, 12);
    const { rowCount } = await db.query(
      "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE email = 'admin@komerce.km'",
      [hash]
    );
    if (rowCount === 0) {
      await db.query(
        `INSERT INTO users (full_name, email, phone, role, currency_pref, country, password_hash)
         VALUES ('Admin Komerce', 'admin@komerce.km', '+269000000', 'admin', 'KMF', 'KM', $1)
         ON CONFLICT (email) DO UPDATE SET password_hash = $1, role = 'admin'`, [hash]
      );
    }

    log.info(`[admin-reset] ✅ Admin password reset OK (IP: ${req.ip}, UA: ${req.get('user-agent')})`);
    res.json({ success: true, message: 'Mot de passe admin réinitialisé avec succès' });
  } catch(err) { next(err); }
});

module.exports = router;
