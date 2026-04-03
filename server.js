/**
 * KOMERCE — Serveur API v7.5
 *
 * Point d'entrée Node.js + Express
 * Déployé sur Railway — PORT fourni par la variable d'environnement
 *
 * Changelog v8.0 : /api/loyalty ajouté · /api/unsold ajouté · migration session 6
 * Changelog v7.6 : /api/purchasing ajouté · triggerPurchasing dans payments.js (cash + Stripe)
 * Changelog v7.5 : /api/ceremony → /api/modules · /api/pilotage ajouté
 */

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const rateLimit  = require('express-rate-limit');
const app = express();

app.set('trust proxy', 1);

const FRONTEND_URL = process.env.FRONTEND_URL || '';

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (origin === 'null') return true;
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+\.up\.railway\.app$/.test(origin)) return true;
  if (FRONTEND_URL && origin === FRONTEND_URL) return true;
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

app.options('*', cors());

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

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

// ── Healthcheck ───────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status:    'ok',
    version:   '8.0',
    timestamp: new Date().toISOString(),
    env:       process.env.NODE_ENV || 'development',
  });
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

// ── Cron cash relais ──────────────────────────────────────────────────────────

const { processCashRelaisReminders } = require('./utils/sms');

setInterval(() => {
  processCashRelaisReminders().catch(err =>
    console.error('Cash reminder cron error:', err.message)
  );
}, 60 * 60 * 1000);

// ── Demarrage ─────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`KOMERCE API v8.0 — port ${PORT} — loyalty OK — unsold OK`);
});

module.exports = app;