/**
 * KOMERCE — Routes authentification
 *
 * POST /api/auth/register  → créer un compte client
 * POST /api/auth/login     → se connecter, reçoit un token JWT
 * GET  /api/auth/me        → profil de l'utilisateur connecté
 *
 * Le token JWT est valide 7 jours.
 * À inclure dans toutes les requêtes protégées :
 *   Header : Authorization: Bearer <token>
 */

const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const db       = require('../db');
const { authenticate } = require('../middleware/auth');

// Hash mot de passe simple (SHA-256 + salt)
// En production, utiliser bcrypt — ajouté en Phase 2
function hashPassword(password) {
  const salt = process.env.JWT_SECRET || 'komerce-salt';
  return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, phone: user.phone, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// ── POST /api/auth/register ───────────────────────────────────────────────────
// Créer un compte client.
// Body : { full_name, email?, phone?, password, timezone?, currency_pref? }
// Email ou phone est requis (au moins l'un des deux)
router.post('/register', async (req, res) => {
  try {
    const { full_name, email, phone, password, timezone, currency_pref } = req.body;

    if (!full_name || !password) {
      return res.status(400).json({ error: 'full_name et password sont requis' });
    }
    if (!email && !phone) {
      return res.status(400).json({ error: 'Email ou numéro de téléphone requis' });
    }

    // Vérifier doublon
    if (email) {
      const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [email]);
      if (rows.length) return res.status(409).json({ error: 'Email déjà utilisé' });
    }
    if (phone) {
      const { rows } = await db.query('SELECT id FROM users WHERE phone = $1', [phone]);
      if (rows.length) return res.status(409).json({ error: 'Numéro déjà utilisé' });
    }

    const password_hash = hashPassword(password);

    const { rows: [user] } = await db.query(
      `INSERT INTO users (full_name, email, phone, role, timezone, currency_pref, password_hash)
       VALUES ($1,$2,$3,'client',$4,$5,$6)
       RETURNING id, full_name, email, phone, role, currency_pref`,
      [full_name, email || null, phone || null, timezone || null,
       currency_pref || 'KMF', password_hash]
    );

    const token = generateToken(user);
    res.status(201).json({ token, user });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création du compte' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
// Se connecter avec email ou téléphone + mot de passe.
// Body : { login, password }   (login = email OU numéro de téléphone)
router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) {
      return res.status(400).json({ error: 'login et password sont requis' });
    }

    const { rows } = await db.query(
      `SELECT id, full_name, email, phone, role, currency_pref, password_hash
       FROM users
       WHERE email = $1 OR phone = $1`,
      [login]
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    const user = rows[0];
    const hash = hashPassword(password);

    if (hash !== user.password_hash) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    const token = generateToken(user);
    const { password_hash, ...safeUser } = user;

    res.json({ token, user: safeUser });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la connexion' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
// Retourne le profil de l'utilisateur connecté
router.get('/me', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, full_name, email, phone, role, timezone, currency_pref, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
