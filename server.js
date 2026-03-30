/**
 * KOMERCE — Serveur API v7.5
 *
 * Point d'entrée Node.js + Express
 * Déployé sur Railway — PORT fourni par la variable d'environnement
 *
 * Changelog v7.5 : /api/ceremony → /api/modules · /api/pilotage ajouté
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
//
// Stratégie :
//   1. Toujours autoriser les requêtes sans origin (curl, Postman, mobile natif)
//   2. Autoriser tous les sous-domaines *.up.railway.app (frontend + backend même plateforme)
//   3. Autoriser le domaine custom si défini dans FRONTEND_URL
//   4. Autoriser localhost pour le développement
//
const FRONTEND_URL = process.env.FRONTEND_URL || ''; // ex: https://komerce.km

function isAllowedOrigin(origin) {
  if (!origin) return true;                                      // curl / Postman / mobile
  if (origin === 'null') return true;                           // fichier local (file://)
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;// localhost dev
  if (/^https:\/\/[a-z0-9-]+\.up\.railway\.app$/.test(origin)) return true; // tout Railway
  if (FRONTEND_URL && origin === FRONTEND_URL) return true;     // domaine custom
  return false;
}

app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Not allowed by CORS: ${origin}`));
    }
  },
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
}));

// Pré-flight explicite (certains clients l'exigent)
app.options('*', cors());

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
const pricingRouter   = require('./routes/pricing');
const modulesRouter   = require('./routes/modules');
const pilotageRouter  = require('./routes/pilotage');
const basketsRouter   = require('./routes/baskets');
const logisticsRouter = require('./routes/logistics');
const paymentsRouter  = require('./routes/payments');

app.use('/api/auth',      authRouter);
app.use('/api/products',  productsRouter);
app.use('/api/orders',    ordersRouter);
app.use('/api/relais',    relaisRouter);
app.use('/api/admin',     adminRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/pricing',   pricingRouter);
app.use('/api/modules',   modulesRouter);
app.use('/api/pilotage',  pilotageRouter);
app.use('/api/baskets',   basketsRouter);
app.use('/api/logistics', logisticsRouter);
app.use('/api/payments',  paymentsRouter);

// Note : les scans sont accessibles via POST /api/orders/scans

// ─── Healthcheck ─────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status:    'ok',
    version:   '7.5',
    timestamp: new Date().toISOString(),
    env:       process.env.NODE_ENV || 'development',
  });
});

// ─── SPA fallback ─────────────────────────────────────────────────────────────
// Sert Komerce_Web.html pour toutes les routes non-API

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint introuvable' });
  }
  res.sendFile(path.join(__dirname, 'public', 'Komerce_Web.html'));
});

// ─── Gestion erreurs globale ──────────────────────────────────────────────────

app.use((err, req, res, next) => {
  if (err.message && err.message.startsWith('Not allowed by CORS')) {
    console.warn('CORS blocked:', err.message);
    return res.status(403).json({ error: 'Origine non autorisée' });
  }
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
║   🌊 KOMERCE API v7.5 — en ligne sur :${PORT.toString().padEnd(9)}║
╠══════════════════════════════════════════════════╣
║   Env      : ${(process.env.NODE_ENV || 'development').padEnd(37)}║
║   DB       : ${process.env.DATABASE_URL ? 'Railway PostgreSQL ✓' : 'DATABASE_URL manquante ⚠️ '}║
║   JWT      : ${process.env.JWT_SECRET  ? 'Configuré ✓          ' : 'JWT_SECRET manquante ⚠️  '}║
║   Frontend : ${(FRONTEND_URL || 'auto (*.railway.app)').padEnd(37)}║
║   Modules  : /api/modules ✓ (couture·lunettes·…) ║
║   Pilotage : /api/pilotage ✓                     ║
╚══════════════════════════════════════════════════╝
  `);
});

module.exports = app;
