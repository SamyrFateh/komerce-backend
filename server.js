/**
 * KOMERCE — Serveur API v8.1 (sécurisé)
 *
 * Point d'entrée Node.js + Express
 * Déployé sur Railway — PORT fourni par la variable d'environnement
 *
 * Changelog v8.1 : Helmet · CORS fix · graceful shutdown · health check DB · cron lock
 * Changelog v8.0 : /api/loyalty ajouté · /api/unsold ajouté · migration session 6
 * Changelog v7.6 : /api/purchasing ajouté · triggerPurchasing dans payments.js (cash + Stripe)
 * Changelog v7.5 : /api/ceremony → /api/modules · /api/pilotage ajouté
 */

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');           // ← P0 ajouté
const path       = require('path');
const rateLimit  = require('express-rate-limit');
const db         = require('./db');              // ← P1 pour health check
const app = express();

app.set('trust proxy', 1);

const FRONTEND_URL = process.env.FRONTEND_URL || '';

// ── CORS — politique corrigée ────────────────────────────────────────────────

function isAllowedOrigin(origin) {
  // Pas d'origin = requête same-origin ou mobile app → OK
  if (!origin) return true;
  // ❌ SUPPRIMÉ: if (origin === 'null') return true;
  //    → Un attaquant peut forger Origin: null via iframe sandbox
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+\.up\.railway\.app$/.test(origin)) return true;
  if (FRONTEND_URL && origin === FRONTEND_URL) return true;
  return false;
}

const corsOptions = {
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Not allowed by CORS: ${origin}`));
    }
  },
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
};

// ── Security headers ─────────────────────────────────────────────────────────

app.use(helmet());                              // ← P0 X-Content-Type, HSTS, CSP, etc.

app.use(cors(corsOptions));
// ❌ SUPPRIMÉ: app.options('*', cors());
//    → Ce second appel utilisait la config par défaut (origin: *) et bypassait la politique CORS

// ── Body parsing ─────────────────────────────────────────────────────────────

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));  // ← P1 ajout limite

// ── Rate limiting ────────────────────────────────────────────────────────────

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      100,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Trop de requetes, reessayez dans 15 minutes.' },
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

app.use(express.static(path.join(__dirname, 'public')));

// ── Routes API ────────────────────────────────────────────────────────────────

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
const scansRouter     = require('./routes/scans');
const financeRouter   = require('./routes/finance');
const purchasingRouter = require('./routes/purchasing');
const loyaltyRouter   = require('./routes/loyalty');    // v8.0
const unsoldRouter    = require('./routes/unsold');     // v8.0

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
app.use('/api/scans',     scansRouter);
app.use('/api/finance',   financeRouter);
app.use('/api/purchasing', purchasingRouter);
app.use('/api/loyalty',   loyaltyRouter);   // v8.0
app.use('/api/unsold',    unsoldRouter);    // v8.0

// ── Healthcheck (avec test DB) ───────────────────────────────────────────────

app.get('/api/health', async (req, res) => {
  try {
    const start = Date.now();
    await db.query('SELECT 1');
    res.json({
      status:        'ok',
      version:       '8.1',
      db_latency_ms: Date.now() - start,
      timestamp:     new Date().toISOString(),
      env:           process.env.NODE_ENV || 'development',
    });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'unreachable' });
  }
});

// ── SPA fallback ──────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint introuvable' });
  }
  res.sendFile(path.join(__dirname, 'public', 'Komerce_Web.html'));
});

// ── Erreurs globales ──────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  if (err.message && err.message.startsWith('Not allowed by CORS')) {
    console.warn('CORS blocked:', err.message);
    return res.status(403).json({ error: 'Origine non autorisee' });
  }
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Erreur serveur interne' });
});

// ── Cron cash relais (avec verrou anti-concurrence) ──────────────────────────

const { processCashRelaisReminders } = require('./utils/sms');

let cronRunning = false;                        // ← P2 verrou
setInterval(async () => {
  if (cronRunning) return;                      // Skip si encore en cours
  cronRunning = true;
  try {
    await processCashRelaisReminders();
  } catch (err) {
    console.error('Cash reminder cron error:', err.message);
  } finally {
    cronRunning = false;
  }
}, 60 * 60 * 1000);

// ── Démarrage + Graceful Shutdown ────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`KOMERCE API v8.1 — port ${PORT} — helmet OK — CORS hardened`);
});

// Graceful shutdown : ferme proprement les connexions en cours
process.on('SIGTERM', () => {
  console.log('SIGTERM reçu — fermeture gracieuse...');
  server.close(() => {
    console.log('Serveur fermé proprement.');
    process.exit(0);
  });
  // Force exit après 10s si des connexions traînent
  setTimeout(() => process.exit(1), 10_000);
});

module.exports = app;
