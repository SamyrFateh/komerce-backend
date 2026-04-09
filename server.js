/**
 * KOMERCE — Serveur API v10.8 (avoirs/credits garantit admin au démarrage)
 *
 * Point d'entrée Node.js + Express
 * Déployé sur Railway — PORT fourni par la variable d'environnement
 *
 * Changelog v10.5 : seedAdmin() ajouté — admin@komerce.km garanti au démarrage
 * Changelog v10.4 : Vague 3 — migrations non-bloquantes (démarrage immédiat),
 *                   gestion centralisée des erreurs (middleware/error-handler.js)
 * Changelog v10.3 : Étape 3 clean-up — pilotage.js supprimé, finance dé-dupliqué,
 *                   seeds + migrations extraits dans scripts/
 * Changelog v10.0 : Dashboards unifiés v11 — pilotage.js absorbé, 0 overlap, auth blindée
 * Changelog v9.2 : Helmet CSP corrigé — inline scripts + Google Fonts + images HTTPS autorisés
 * Changelog v9.1 : BUG-014 cookie-parser ajouté — JWT migré vers httpOnly cookie
 * Changelog v8.8 : migration robuste (try/catch individuel) + CREATE TABLE partners + gen_random_uuid
 * Changelog v8.7 : auto-migration customs_history colonnes + loyalty_tiers table + users.loyalty_tier_id
 * Changelog v8.6 : auto-migration bcrypt admin hash · fix P0 dashboard + scans · fix 404 routes
 * Changelog v8.5 : rate-limit middleware branché · health route montée · .env retiré du repo
 * Changelog v8.1 : Helmet · CORS fix · graceful shutdown · health check DB · cron lock
 * Changelog v8.0 : /api/loyalty ajouté · /api/unsold ajouté · migration session 6
 * Changelog v7.6 : /api/purchasing ajouté · triggerPurchasing dans payments.js (cash + Stripe)
 * Changelog v7.5 : /api/ceremony → /api/modules · /api/pilotage ajouté
 */

require('dotenv').config();

// ── Validation des variables d'environnement critiques ───────────────────────
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET'];
const RECOMMENDED_ENV = ['ADMIN_PASSWORD', 'STRIPE_SECRET_KEY'];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ FATAL: ${key} manquant — impossible de démarrer`);
    process.exit(1);
  }
}
for (const key of RECOMMENDED_ENV) {
  if (!process.env[key]) {
    console.warn(`⚠️  ${key} non défini — valeur par défaut utilisée (à configurer avant la prod)`);
  }
}

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const cookieParser = require('cookie-parser');
const path         = require('path');
const db           = require('./db');

const {
  globalLimiter,
  authLimiter,
  cashConfirmLimiter,
  scanCollectLimiter,
  orderCreateLimiter,
  dashboardLimiter,
  adminLimiter,
} = require('./middleware/rate-limit');

// ── Migrations extraites (FIX-012 + Vague 3) ──────────────────────────────
// Les migrations NE BLOQUENT PLUS le démarrage — elles tournent en background
// après que le serveur est prêt à recevoir des requêtes.
const { fixAdminHash, fixMissingSchema } = require('./scripts/fix-schema');
const { runAllSeeds }                     = require('./scripts/seed');

// ── Gestion centralisée des erreurs (Vague 3) ───────────────────────────
const { errorHandler } = require('./middleware/error-handler');

const app = express();

app.set('trust proxy', 1);

const FRONTEND_URL = process.env.FRONTEND_URL || '';

// ── CORS — politique stricte (Vague 1 security hardening) ──────────────────────

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
  if (FRONTEND_URL && origin === FRONTEND_URL) return true;
  const extra = process.env.ALLOWED_ORIGINS;
  if (extra) {
    const allowed = extra.split(',').map(s => s.trim()).filter(Boolean);
    if (allowed.includes(origin)) return true;
  }
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

// ── Security headers ────────────────────────────────────────────────────

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://unpkg.com", "https://cdn.jsdelivr.net"],
      styleSrc:    ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:     ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com", "data:"],
      imgSrc:      ["'self'", "data:", "https:", "http:"],
      connectSrc:  ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com", "https://unpkg.com", "https://cdn.jsdelivr.net"],
      mediaSrc:    ["'self'"],
      objectSrc:   ["'none'"],
      frameAncestors: ["'none'"],
      baseUri:     ["'self'"],
      formAction:  ["'self'"],
      scriptSrcAttr: ["'unsafe-inline'"],
    },
  },
}));

app.use(cors(corsOptions));

// ── Body parsing ─────────────────────────────────────────────────────────

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── Cookie parser (BUG-014 : JWT httpOnly cookie) ────────────────────────────

app.use(cookieParser());

// ── Rate limiting (middleware/rate-limit.js) ────────────────────────────────

app.use('/api/', globalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/payments/cash/confirm', cashConfirmLimiter);
app.use('/api/scans/collect', scanCollectLimiter);
app.use('/api/orders', (req, res, next) => {
  if (req.method === 'POST' && req.path === '/') {
    return orderCreateLimiter(req, res, next);
  }
  next();
});
app.use('/api/dashboard', dashboardLimiter);
app.use('/api/admin/', adminLimiter);

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// ── Routes API ────────────────────────────────────────────────────────────

const authRouter       = require('./routes/auth');
const productsRouter   = require('./routes/products');
const ordersRouter     = require('./routes/orders');
const relaisRouter     = require('./routes/relais');
const adminRouter      = require('./routes/admin');
const dashboardRouter  = require('./routes/dashboard');
const pricingRouter    = require('./routes/pricing');
const modulesRouter    = require('./routes/modules');
const basketsRouter    = require('./routes/baskets');
const logisticsRouter  = require('./routes/logistics');
const paymentsRouter   = require('./routes/payments');
const scansRouter      = require('./routes/scans');
const financeRouter    = require('./routes/finance');
const purchasingRouter = require('./routes/purchasing');
const loyaltyRouter    = require('./routes/loyalty');
const unsoldRouter     = require('./routes/unsold');
const healthRouter     = require('./routes/health');
// P1-001 fix: configRouter removed (no config table in DB)
const parcelsRouter    = require('./routes/parcels');
const hubRouter        = require('./routes/hub');
const carriersRouter   = require('./routes/carriers');
const creditsRouter    = require('./routes/credits');
const walletRouter     = require('./routes/wallet');
const walletService    = require('./services/wallet-service');

app.use('/api/auth',       authRouter);
app.use('/api/products',   productsRouter);
app.use('/api/orders',     ordersRouter);
app.use('/api/relais',     relaisRouter);
app.use('/api/admin/finance',  financeRouter);
app.use('/api/admin/pilotage', dashboardRouter);
app.use('/api/admin/stats',    dashboardRouter);
app.use('/api/admin',      adminRouter);
app.use('/api/dashboard',  dashboardRouter);
app.use('/api/pricing',    pricingRouter);
app.use('/api/modules',    modulesRouter);
app.use('/api/baskets',    basketsRouter);
app.use('/api/logistics',  logisticsRouter);
app.use('/api/parcels',    parcelsRouter);
app.use('/api/hub',        hubRouter);
app.use('/api/carriers',   carriersRouter);
app.use('/api/credits',    creditsRouter);
app.use('/api/wallet',     walletRouter);
app.use('/api/payments',   paymentsRouter);
app.use('/api/scans',      scansRouter);
app.use('/api/finance', (req, res) => {
  res.status(301).json({
    error:    'Endpoint déplacé',
    redirect: `/api/admin/finance${req.path}`,
    message:  'Utilisez /api/admin/finance à la place',
  });
});
app.use('/api/purchasing', purchasingRouter);
app.use('/api/loyalty',    loyaltyRouter);
app.use('/api/unsold',     unsoldRouter);
// P1-001 fix: /api/config route removed (dead route)
app.use('/health',         healthRouter);

// ── Healthcheck (avec test DB) ─────────────────────────────────────────────

app.get('/api/health', async (req, res) => {
  try {
    const start = Date.now();
    await db.query('SELECT 1');
    res.json({
      status:        'ok',
      version:       '10.7',
      db_latency_ms: Date.now() - start,
      timestamp:     new Date().toISOString(),
      env:           process.env.NODE_ENV || 'development',
    });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'unreachable' });
  }
});

// ── SPA fallback ────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint introuvable' });
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(path.join(__dirname, 'public', 'Komerce_Boutique.html'));
});

// ── Gestion centralisée des erreurs (Vague 3) ────────────────────────────
// Doit être monté APRÈS toutes les routes.

app.use(errorHandler);

// ── Cron cash relais (avec verrou anti-concurrence) ───────────────────────────

const { processCashRelaisReminders, processBackorderReminders } = require('./utils/sms');
const { getRuleNumber: _getRuleNum } = require('./utils/rules');

let cronRunning = false;

(async () => {
  let intervalMin = 60;
  try {
    intervalMin = await _getRuleNum('CASH_REMINDER_INTERVAL_MIN', 60);
  } catch (_) { /* fallback 60min */ }

  console.log(`⏰ Cash reminder cron: every ${intervalMin}min`);

  setInterval(async () => {
    if (cronRunning) return;
    cronRunning = true;
    try {
      await processCashRelaisReminders();
    } catch (err) {
      console.error('Cash reminder cron error:', err.message);
    } finally {
      cronRunning = false;
    }
  }, intervalMin * 60 * 1000);
})();

// ── Phase 4 — Backorder checker cron ─────────────────────────────────────────

const BACKORDER_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
let backorderCronRunning = false;

setInterval(async () => {
  if (backorderCronRunning) return;
  backorderCronRunning = true;
  try {
    const result = await processBackorderReminders();
    if (result.processed > 0) {
      console.log(`[CRON] Backorder check: ${result.processed} traités, ${result.sms_sent} SMS envoyés`);
    }
  } catch (err) {
    console.error('[CRON] Backorder check error:', err.message);
  } finally {
    backorderCronRunning = false;
  }
}, BACKORDER_CHECK_INTERVAL_MS);

setTimeout(() => {
  processBackorderReminders()
    .then(result => { if (result.processed > 0) console.log(`[CRON] Initial backorder check: ${result.processed} traités`); })
    .catch(err => console.error('[CRON] Initial backorder check error:', err.message));
}, 30 * 1000);

// ── Démarrage + Graceful Shutdown ──────────────────────────────────────────────────
// Vague 3 : le serveur démarre IMMEDÉDIATEMENT.
// Les migrations tournent en background après listen() — elles ne bloquent plus Railway.

const PORT = process.env.PORT || 3000;

// Init wallet tables at startup
walletService.ensureWalletTables().catch(e => console.error('Wallet init error:', e.message));

const server = app.listen(PORT, () => {
  console.log(`KOMERCE API v10.8 — port ${PORT} — démarrage immédiat — migrations en background`);

  // ── Migrations & seeds non-bloquantes ───────────────────────────────────
  setImmediate(async () => {
    try {
      await fixAdminHash();
      await fixMissingSchema();
      await runAllSeeds();
      console.log('✅ Migrations et seeds terminées');
    } catch (err) {
      console.error('❌ Migration error (non-fatal, serveur opérationnel):', err.message);
    }
  });
});

process.on('SIGTERM', () => {
  console.log('SIGTERM reçu — fermeture gracieuse...');
  server.close(() => {
    console.log('Serveur fermé proprement.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
});

module.exports = app;

