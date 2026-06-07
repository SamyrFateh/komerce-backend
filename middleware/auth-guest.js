'use strict';

/**
 * KOMERCE — Middleware d'authentification avec auto-création (guest checkout)
 *
 * authenticateOrCreateGuest :
 *   1. Si token valide (cookie kmrc_jwt ou Bearer) → charge req.user classique
 *   2. Sinon → crée un user customer à la volée basé sur les téléphones du body :
 *        - tracking_phone (priorité : le payeur, peut être +33 diaspora ou +269 local)
 *        - recipient_phone (fallback : si pas de tracking_phone, le payeur = bénéficiaire)
 *   3. Si un user existe déjà avec ce phone_payer → on le réutilise (historique préservé)
 *   4. Met à jour phone_beneficiary sur le user à chaque commande (dernier bénéficiaire connu)
 *   5. Génère un JWT + pose le cookie httpOnly kmrc_jwt dans la réponse
 *   6. Injecte req.user (identique à authenticate classique)
 *
 * Utilisation :
 *   router.post('/', authenticateOrCreateGuest, validate(orders.create), handler)
 *
 * Pourquoi "tracking_phone" et pas "recipient_phone" comme clé ?
 *   - Le tracking_phone est le tél du PAYEUR (celui qui clique Payer)
 *   - Le payeur est stable dans le temps (diaspora garde son +33)
 *   - Le bénéficiaire peut changer à chaque commande (cadeau à la mère, puis au frère...)
 *   - Donc le user_id doit être rattaché au payeur, pas au bénéficiaire
 *
 * Cas couverts :
 *   A) Client local Comores achète pour lui-même
 *      → tracking_phone vide, recipient_phone = +269...
 *      → user.phone_payer = +269... (payeur = bénéficiaire)
 *   B) Diaspora achète pour un proche
 *      → tracking_phone = +33..., recipient_phone = +269...
 *      → user.phone_payer = +33..., user.phone_beneficiary = +269...
 *   C) Diaspora achète pour elle-même (ex: part en vacances)
 *      → tracking_phone = +33..., recipient_phone = +269...
 *      → idem B (on ne détecte pas la nuance)
 */

const crypto = require('crypto');
const jwt  = require('jsonwebtoken');
const db   = require('../db');
const log = require('../utils/logger').child({ module: 'auth-guest' });
// N2 FIX: cache partagé avec auth.js (même Map, même TTL, même invalidation)
const userCache = require('../utils/user-cache');
// A-BE-04 FIX: normalisation téléphone centralisée (back-end conservateur, sans devinette pays)
const { normalizePhone } = require('../utils/phone');

const _JWT_SECRET  = process.env.JWT_SECRET;
const JWT_EXPIRES  = process.env.JWT_EXPIRES || '90d';
const COOKIE_NAME  = 'kmrc_jwt';

// ── Cache utilisateur partagé via utils/user-cache.js (N2 FIX) ────────
function getCachedUser(userId) { return userCache.get(userId); }
function setCachedUser(userId, user) { userCache.set(userId, user); }

// ── Options cookie (alignées sur auth.js) ─────────────────────────────
function cookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  const match = JWT_EXPIRES.match(/(\d+)(d|h|m)/);
  let maxAge = 90 * 24 * 60 * 60 * 1000;
  if (match) {
    const val = parseInt(match[1]);
    if (match[2] === 'd') maxAge = val * 24 * 60 * 60 * 1000;
    if (match[2] === 'h') maxAge = val * 60 * 60 * 1000;
    if (match[2] === 'm') maxAge = val * 60 * 1000;
  }
  return { httpOnly: true, secure: isProd, sameSite: 'Strict', maxAge, path: '/' };
}

function extractToken(req) {
  if (req.cookies && req.cookies.kmrc_jwt) return req.cookies.kmrc_jwt;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.split(' ')[1];
  return null;
}

function generateToken(user) {
  // N4 — jti unique pour permettre la révocation individuelle (migration 072)
  return jwt.sign({ id: user.id, role: user.role, jti: crypto.randomUUID() }, _JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

async function isTokenRevoked(jti) {
  if (!jti) return false;
  const { rows } = await db.query(
    'SELECT 1 FROM revoked_tokens WHERE jti = $1 LIMIT 1',
    [jti]
  );
  return rows.length > 0;
}

// ── Trouve ou crée un user par phone_payer ────────────────────────────
async function findOrCreateUser({ payerPhone, beneficiaryPhone, fullName }) {
  const payerNorm = normalizePhone(payerPhone);
  const benefNorm = normalizePhone(beneficiaryPhone);

  if (!payerNorm && !benefNorm) {
    return null; // Aucune info utilisable
  }

  // Clé d'identification : le payeur d'abord, sinon le bénéficiaire
  const lookupPhone = payerNorm || benefNorm;

  // 1) Chercher par phone_payer (nouvelle colonne)
  let { rows: found } = await db.query(
    `SELECT id, full_name, email, phone, phone_payer, phone_beneficiary, role, currency_pref
       FROM users
      WHERE phone_payer = $1
      LIMIT 1`,
    [lookupPhone]
  );

  // 2) Fallback : chercher par phone classique (user historique créé avant cette migration)
  if (found.length === 0) {
    const { rows: legacy } = await db.query(
      `SELECT id, full_name, email, phone, phone_payer, phone_beneficiary, role, currency_pref
         FROM users
        WHERE phone = $1
        LIMIT 1`,
      [lookupPhone]
    );
    found = legacy;
  }

  if (found.length > 0) {
    const user = found[0];
    // Mise à jour phone_payer si manquant (rattrapage users legacy)
    if (!user.phone_payer && payerNorm) {
      await db.query(`UPDATE users SET phone_payer = $1 WHERE id = $2`, [payerNorm, user.id]);
      user.phone_payer = payerNorm;
    }
    // Mise à jour phone_beneficiary si bénéficiaire fourni (dernier connu)
    if (benefNorm && benefNorm !== user.phone_beneficiary) {
      await db.query(`UPDATE users SET phone_beneficiary = $1 WHERE id = $2`, [benefNorm, user.id]);
      user.phone_beneficiary = benefNorm;
    }
    return user;
  }

  // 3) Création du user
  const newId = crypto.randomUUID();
  const name = (fullName && String(fullName).trim()) || 'Client';

  const { rows: created } = await db.query(
    `INSERT INTO users (id, full_name, phone, phone_payer, phone_beneficiary, role, created_at)
     VALUES ($1, $2, $3, $4, $5, 'client', NOW())
     RETURNING id, full_name, email, phone, phone_payer, phone_beneficiary, role, currency_pref`,
    [newId, name, payerNorm || benefNorm, payerNorm, benefNorm]
  );
  return created[0];
}

// ══════════════════════════════════════════════════════════════════════
// MIDDLEWARE PRINCIPAL
// ══════════════════════════════════════════════════════════════════════

async function authenticateOrCreateGuest(req, res, next) {
  try {
    // ── CAS 1 : Token valide présent ─────────────────────────────────
    const token = extractToken(req);
    if (token) {
      try {
        const decoded = jwt.verify(token, _JWT_SECRET, { algorithms: ['HS256'] });

        // N4 — refuser explicitement les JWT révoqués.
        // Ne pas fallthrough vers création guest : une session révoquée doit rester invalide.
        if (await isTokenRevoked(decoded.jti)) {
          return res.status(401).json({ error: 'Session expirée — reconnectez-vous' });
        }

        let user = getCachedUser(decoded.id);

        if (!user) {
          const { rows } = await db.query(
            `SELECT id, full_name, email, phone, phone_payer, phone_beneficiary, role, currency_pref
               FROM users WHERE id = $1`,
            [decoded.id]
          );
          if (rows.length) {
            user = rows[0];
            setCachedUser(decoded.id, user);
          }
        }

        if (user) {
          // Mise à jour phone_beneficiary si nouveau bénéficiaire pour cette commande
          const newBenef = normalizePhone(req.body?.recipient_phone);
          if (newBenef && newBenef !== user.phone_beneficiary) {
            await db.query(`UPDATE users SET phone_beneficiary = $1 WHERE id = $2`, [newBenef, user.id]);
            user.phone_beneficiary = newBenef;
            setCachedUser(user.id, user);
          }
          req.user = user;
          return next();
        }
        // Token valide mais user introuvable → identité requise (pas de création auto)
        return res.status(401).json({ error: 'Identité requise', code: 'identity_required' });
      } catch (err) {
        if (err.name !== 'JsonWebTokenError' && err.name !== 'TokenExpiredError') {
          log.warn({ err }, '[auth-guest] erreur verif token:');
        }
        // token invalide/expiré → tombe vers le refus ci-dessous
      }
    }

    // ── CAS 2 : Pas de session vérifiée ──────────────────────────────
    // RÈGLE SANS EXCEPTION : aucune commande sans identité vérifiée par OTP.
    // La création de compte se fait UNIQUEMENT via /api/auth/otp/verify
    // (seul endroit où la possession du numéro est prouvée).
    // Le front gère ce 401 en déclenchant requireIdentity() → flux OTP.
    //
    // HOOK AGENT (tablette/comptoir, à câbler le jour venu) :
    //   un agent authentifié pourra créer une commande pour un tiers ici,
    //   borné à son relais — son identité (login) remplace l'OTP client.
    //   Pour l'instant : refus strict, aucune exception.
    return res.status(401).json({
      error: 'Vérification du numéro requise pour commander',
      code: 'identity_required',
    });
    req.guestCreated = true; // flag pour que la route sache que c'est un nouveau guest
    return next();

  } catch (err) {
    log.error('[auth-guest] erreur inattendue:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de l\'authentification' });
  }
}

// Invalidation de cache (partagée — invalide aussi le cache de auth.js)
function invalidateUserCache(userId) {
  userCache.invalidate(userId);
}

module.exports = {
  authenticateOrCreateGuest,
  invalidateUserCache,
  normalizePhone, // exporté au cas où d'autres modules en ont besoin
};





