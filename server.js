/**
 * KOMERCE — Serveur API v7.1
 *
 * Point d'entrée Node.js + Express
 * Déployé sur Railway — PORT fourni par la variable d'environnement
 */

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const rateLimit  = require('express-rate-limit');
const app = express();

// FIX PROXY (Railway, Render, etc.)
app.set('trust proxy', 1);

// ─── CORS ─────────────────────────────────────────────────────────────────────

const allowedOrigins = [
  'https://komerce-backend-production.up.railway.app',
  'http://localhost:3000',
  'http://localhost:5000',
];

app.use(cors({
  origin: (origin, callback) => {
    // Autoriser les requêtes sans origin (curl, Postman) et les origines listées
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
}));

// ─── Body parser ──────────────────────────────────────────────────────────────

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Rate limiting ────────────────────────────────────────────────────────────

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max:      100,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Trop de requêtes, réessayez dans 15 minutes.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      20,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Trop de tentatives de connexion.' },
});

app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);

// ─── Fichiers statiques (frontend) ───────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));

// ─── Routes API ───────────────────────────────────────────────────────────────

const authRouter      = require('./routes/auth');
const productsRouter  = require('./routes/products');
const ordersRouter    = require('./routes/orders');
const relaisRouter    = require('./routes/relais');
const adminRouter     = require('./routes/admin');
const dashboardRouter = require('./routes/dashboard');

app.use('/api/auth',      authRouter);
app.use('/api/products',  productsRouter);
app.use('/api/orders',    ordersRouter);
app.use('/api/relais',    relaisRouter);
app.use('/api/admin',     adminRouter);
app.use('/api/dashboard', dashboardRouter);

// Note : les scans sont accessibles via POST /api/orders/scans

// ─── Healthcheck ─────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status:    'ok',
    version:   '7.1',
    timestamp: new Date().toISOString(),
  });
});

// ─── SPA fallback ─────────────────────────────────────────────────────────────
// Sert index.html pour toutes les routes non-API (navigation côté client)

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint introuvable' });
  }
  res.sendFile(path.join(__dirname, 'public', 'Komerce_Web.html'));
});

// ─── Gestion erreurs globale ──────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Erreur serveur interne' });
});

// ─── Cron interne — rappels cash relais ──────────────────────────────────────

const { processChashRelaisReminders } = require('./utils/sms');

setInterval(() => {
  processChashRelaisReminders().catch(err =>
    console.error('Cash reminder cron error:', err.message)
  );
}, 60 * 60 * 1000); // toutes les heures

// ─── Démarrage ────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║   🌊 KOMERCE API v7.1 — en ligne sur :${PORT.toString().padEnd(9)}║
╠══════════════════════════════════════════════════╣
║   Env   : ${(process.env.NODE_ENV || 'development').padEnd(39)}║
║   DB    : ${process.env.DATABASE_URL ? 'Railway PostgreSQL ✓' : 'DATABASE_URL manquante ⚠️ '}║
║   JWT   : ${process.env.JWT_SECRET  ? 'Configuré ✓          ' : 'JWT_SECRET manquante ⚠️  '}║
╚══════════════════════════════════════════════════╝
  `);
});

module.exports = app;
