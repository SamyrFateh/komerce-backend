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

const jwt  = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db   = require('../db');

const _JWT_SECRET  = process.env.JWT_SECRET;
const JWT_EXPIRES  = process.env.JWT_EXPIRES || '90d';
const COOKIE_NAME  = 'kmrc_jwt';

// ── Cache utilisateur (5 min) — aligné sur auth.js ────────────────────
const USER_CACHE_TTL = 5 * 60 * 1000;
const userCache = new Map();

function getCachedUser(userId) {
  const entry = userCache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.ts > USER_CACHE_TTL) {
    userCache.delete(userId);
    return null;
  }
  return entry.user;
}

function setCachedUser(userId, user) {
  userCache.set(userId, { user, ts: Date.now() });
  if (userCache.size > 10_000) {
    userCache.delete(userCache.keys().next().value);
  }
}

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
  return jwt.sign({ id: user.id, role: user.role }, _JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

// ── Normalisation téléphone en E.164 ──────────────────────────────────
// Accepte "+33699272526", "0699272526", "+269 321 12 34" etc.
// Retourne un E.164 normalisé ou null.
function normalizePhone(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  // Garder les + et chiffres uniquement
  s = s.replace(/[^\d+]/g, '');
  if (!s) return null;
  // Si déjà E.164 : on retourne
  if (s.startsWith('+')) return s;
  // Si commence par 00 : on remplace par +
  if (s.startsWith('00')) return '+' + s.slice(2);
  // Sinon, on ne peut pas deviner le pays → on refuse
  return null;
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
        // Si token valide mais user introuvable → on crée en guest
      } catch (err) {
        if (err.name !== 'JsonWebTokenError' && err.name !== 'TokenExpiredError') {
          console.warn('[auth-guest] erreur verif token:', err.message);
        }
        // → fallthrough vers création guest
      }
    }

    // ── CAS 2 : Pas de token valide → création guest ─────────────────
    const payerPhone = req.body?.tracking_phone || req.body?.recipient_phone;
    const benefPhone = req.body?.recipient_phone;
    const fullName   = req.body?.recipient_name;

    if (!payerPhone) {
      return res.status(400).json({
        error: 'Téléphone manquant — renseignez au moins le numéro du bénéficiaire',
      });
    }

    const user = await findOrCreateUser({
      payerPhone,
      beneficiaryPhone: benefPhone,
      fullName,
    });

    if (!user) {
      return res.status(400).json({
        error: 'Impossible de créer le compte — format de téléphone invalide (attendu : +33... ou +269...)',
      });
    }

    // Pose du cookie JWT (session 90 jours)
    const newToken = generateToken(user);
    res.cookie(COOKIE_NAME, newToken, cookieOptions());

    setCachedUser(user.id, user);
    req.user = user;
    req.guestCreated = true; // flag pour que la route sache que c'est un nouveau guest
    return next();

  } catch (err) {
    console.error('[auth-guest] erreur inattendue:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de l\'authentification' });
  }
}

// Invalidation de cache (utile si on modifie un user depuis une autre route)
function invalidateUserCache(userId) {
  userCache.delete(userId);
}

module.exports = {
  authenticateOrCreateGuest,
  invalidateUserCache,
  normalizePhone, // exporté au cas où d'autres modules en ont besoin
};
