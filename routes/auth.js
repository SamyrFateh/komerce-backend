/**
 * KOMERCE — Authentification
 *
 * POST /api/auth/register   → création de compte
 * POST /api/auth/login      → connexion, retourne JWT
 * GET  /api/auth/me         → profil de l'utilisateur connecté
 * PUT  /api/auth/me         → mise à jour profil
 */

const express      = require('express');
const { randomBytes } = require('crypto');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const db       = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET manquant — démarrage impossible en production');
  if (process.env.NODE_ENV === 'production') process.exit(1);
}
const _JWT_SECRET = JWT_SECRET || 'komerce_secret_dev_UNSAFE';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '30d';

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role },
    _JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function userResponse(user) {
  const { password_hash, ...safe } = user;
  return safe;
}

// ─── POST /api/auth/register ─────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  try {
    const {
      full_name,
      email,
      phone,
      password,
      country = 'KM',
      currency_pref = 'KMF',
    } = req.body;

    // Validation minimale
    if (!phone) {
      return res.status(400).json({ error: 'Le téléphone est obligatoire' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Mot de passe minimum 6 caractères' });
    }

    // Vérifier doublon email
    if (email) {
      const { rows: existing } = await db.query(
        'SELECT id FROM users WHERE email = $1',
        [email.toLowerCase()]
      );
      if (existing.length) {
        return res.status(409).json({ error: 'Cet email est déjà utilisé' });
      }
    }

    // Vérifier doublon téléphone
    const { rows: existingPhone } = await db.query(
      'SELECT id FROM users WHERE phone = $1',
      [phone]
    );
    if (existingPhone.length) {
      return res.status(409).json({ error: 'Ce numéro de téléphone est déjà utilisé' });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const { rows: [user] } = await db.query(
      `INSERT INTO users
         (full_name, email, phone, password_hash, role, country, currency_pref)
       VALUES ($1, $2, $3, $4, 'client', $5, $6)
       RETURNING *`,
      [
        full_name || null,
        email ? email.toLowerCase() : null,
        phone,
        password_hash,
        country,
        currency_pref,
      ]
    );

    const token = generateToken(user);
    res.status(201).json({ token, user: userResponse(user) });

  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Erreur lors de la création du compte' });
  }
});

// ─── POST /api/auth/login ────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  try {
    const { email, phone, password } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Mot de passe obligatoire' });
    }
    if (!email && !phone) {
      return res.status(400).json({ error: 'Email ou téléphone obligatoire' });
    }

    // Chercher par email ou téléphone — deux requêtes explicites, pas d'interpolation de colonne
    let rows;
    if (email) {
      ({ rows } = await db.query(
        'SELECT * FROM users WHERE email = $1',
        [email.toLowerCase()]
      ));
    } else {
      ({ rows } = await db.query(
        'SELECT * FROM users WHERE phone = $1',
        [phone]
      ));
    }

    if (!rows.length) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    const token = generateToken(user);
    res.json({ token, user: userResponse(user) });

  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Erreur lors de la connexion' });
  }
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────

router.get('/me', authenticate, async (req, res) => {
  try {
    const { rows: [user] } = await db.query(
      `SELECT id, full_name, email, phone, role, country, currency_pref, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── PUT /api/auth/me ────────────────────────────────────────────────────────

router.put('/me', authenticate, async (req, res) => {
  try {
    const { full_name, phone, currency_pref } = req.body;

    const { rows: [user] } = await db.query(
      `UPDATE users
       SET full_name     = COALESCE($1, full_name),
           phone         = COALESCE($2, phone),
           currency_pref = COALESCE($3, currency_pref),
           updated_at    = NOW()
       WHERE id = $4
       RETURNING id, full_name, email, phone, role, country, currency_pref`,
      [full_name, phone, currency_pref, req.user.id]
    );

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Erreur mise à jour profil' });
  }
});

// ─── POST /api/auth/auto-register (usage interne uniquement) ─────────────────
// Crée silencieusement un compte avec email généré depuis le téléphone
// si l'utilisateur n'a pas encore de compte.
// Protégé par clé API interne (header X-Internal-Key) — ne jamais exposer au frontend.

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

function requireInternalKey(req, res, next) {
  if (!INTERNAL_API_KEY) {
    console.error('FATAL: INTERNAL_API_KEY non définie — auto-register désactivé');
    return res.status(503).json({ error: 'Endpoint désactivé (configuration manquante)' });
  }
  const provided = req.headers['x-internal-key'];
  if (!provided || provided !== INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Clé interne invalide ou absente' });
  }
  next();
}

router.post('/auto-register', requireInternalKey, async (req, res) => {
  try {
    const {
      full_name,
      phone,
      email,           // optionnel — sinon généré depuis phone
      country = 'KM',
    } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Téléphone obligatoire' });
    }

    const resolvedEmail = email ||
      (phone.replace(/\D/g, '') + '@komerce.km');

    // Vérifier si déjà existant (email OU téléphone)
    const { rows: existing } = await db.query(
      `SELECT id FROM users WHERE email = $1 OR phone = $2 LIMIT 1`,
      [resolvedEmail, phone]
    );

    if (existing.length) {
      // Utilisateur existant : retourner token via login silencieux
      const { rows: [user] } = await db.query(
        `SELECT * FROM users WHERE id = $1`, [existing[0].id]
      );
      const token = generateToken(user);
      return res.json({ token, user: userResponse(user), created: false });
    }

    // Créer le compte — mot de passe aléatoire, inutilisable directement
    // (le compte auto-créé n'est accessible que via token JWT)
    const password_hash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);

    const { rows: [user] } = await db.query(
      `INSERT INTO users
         (full_name, email, phone, password_hash, role, country, currency_pref)
       VALUES ($1, $2, $3, $4, 'client', $5, 'KMF')
       RETURNING *`,
      [full_name || 'Client Komerce', resolvedEmail, phone, password_hash, country]
    );

    const token = generateToken(user);
    res.status(201).json({ token, user: userResponse(user), created: true });

  } catch (err) {
    console.error('Auto-register error:', err.message);
    res.status(500).json({ error: 'Erreur création automatique de compte' });
  }
});

module.exports = router;
