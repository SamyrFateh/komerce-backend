/**
 * KOMERCE — Serveur API v10.15 (Hub dashboard + Relay dashboard + suivi.html public)
 *
 * Point d'entrée Node.js + Express
 * Déployé sur Railway — PORT fourni par la variable d'environnement
 *
 * Changelog v10.15: routes/transit-dashboard.js ajouté (parcel-first)
 * Changelog v10.14: routes/hub-dashboard.js ajouté, hub.html
 * Changelog v10.13: routes/relay-dashboard.js ajouté, suivi.html exempté auth-guard
 * Changelog v10.12: F34 stock constraint garantit admin au démarrage
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

const { fixAdminHash, fixMissingSchema } = require('./scripts/fix-schema');
const { runAllSeeds }                     = require('./scripts/seed');
const { errorHandler } = require('./middleware/error-handler');
const { requestIdMiddleware } = require('./middleware/request-id');

const app = express();

app.set('trust proxy', 1);

const FRONTEND_URL = process.env.FRONTEND_URL || '';

// ── CORS ──────────────────────────────────────────────────────────────────────

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
      scriptSrc:   ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://unpkg.com", "https://cdn.jsdelivr.net", "https://js.stripe.com"],
      styleSrc:    ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:     ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com", "data:"],
      imgSrc:      ["'self'", "data:", "https:", "http:"],
      connectSrc:  ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com", "https://unpkg.com", "https://cdn.jsdelivr.net", "https://api.stripe.com"],
      frameSrc:    ["'self'", "https://js.stripe.com", "https://hooks.stripe.com"],
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

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use(requestIdMiddleware);

// ── Rate limiting ────────────────────────────────────────────────────────────

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


// ── Auth guard injection — auto-injects session checker into admin pages ────
const _fs = require('fs');
app.get('/*.html', (req, res, next) => {
  // Skip boutique, portal, and public pages
  if (req.path.includes('Boutique') || req.path === '/portal.html' || req.path === '/suivi.html') return next();
  const filePath = path.join(__dirname, 'public', req.path);
  _fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) return next();
    html = html.replace('</body>', '<script src="/js/auth-guard.js"></script>\n</body>');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(html);
  });
});

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
const parcelsRouter    = require('./routes/parcels');
const hubRouter        = require('./routes/hub');
const carriersRouter   = require('./routes/carriers');
const walletRouter     = require('./routes/wallet');
const relayDashRouter  = require('./routes/relay-dashboard');
const hubDashRouter    = require('./routes/hub-dashboard');
const transitDashRouter = require('./routes/transit-dashboard');
const walletService    = require('./services/wallet-service');
const routingService   = require('./services/routing');
const parcelSecurity   = require('./services/parcel-security');

app.use('/api/auth',       authRouter);
app.use('/api/products',   productsRouter);
app.use('/api/orders',     ordersRouter);
app.use('/api/relais',     relaisRouter);
app.use('/api/admin/finance',  financeRouter);
app.use('/api/admin/pilotage', dashboardRouter);
app.use('/api/admin/stats',    dashboardRouter);
app.use('/api/admin',      adminRouter);
app.use('/api/dashboard',  dashboardRouter);
app.use('/api/relay',      relayDashRouter);
app.use('/api/hub-dash',   hubDashRouter);
app.use('/api/transit',    transitDashRouter);
app.use('/api/pricing',    pricingRouter);
app.use('/api/modules',    modulesRouter);
app.use('/api/baskets',    basketsRouter);
app.use('/api/logistics',  logisticsRouter);
app.use('/api/parcels',    parcelsRouter);
app.use('/api/hub',        hubRouter);
app.use('/api/carriers',   carriersRouter);
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
app.use('/health',         healthRouter);

// ── Healthcheck ─────────────────────────────────────────────────────────────

app.get('/api/health', async (req, res) => {
  try {
    const start = Date.now();
    await db.query('SELECT 1');
    res.json({
      status:        'ok',
      version:       '10.15',
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

app.use(errorHandler);

// ── Cron cash relais ──────────────────────────────────────────────────────────

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

// ── Démarrage + Graceful Shutdown ──────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

walletService.ensureWalletTables().catch(e => console.error('Wallet init error:', e.message));
routingService.ensureRoutingColumns(db).catch(e => console.error('Routing init error:', e.message));
parcelSecurity.ensureSecurityTables(db).catch(e => console.error('Security init error:', e.message));

const server = app.listen(PORT, () => {
  console.log(`KOMERCE API v10.15 — port ${PORT} — démarrage immédiat — migrations en background`);

  setImmediate(async () => {
    try {
      await fixAdminHash();
      await fixMissingSchema();
      await runAllSeeds();

      try {
        await db.query(`
          DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'orders' AND column_name = 'transit_comores_at')
            THEN ALTER TABLE orders RENAME COLUMN transit_comores_at TO in_transit_at;
                 RAISE NOTICE 'Phase1: renamed transit_comores_at → in_transit_at';
            END IF;
          END$$
        `);
      } catch(e) { console.warn('Phase1 migration (non-fatal):', e.message); }

      try {
        await db.query(`
          DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
              WHERE t.typname = 'scan_step' AND e.enumlabel = 'in_transit')
            THEN ALTER TYPE scan_step ADD VALUE 'in_transit' AFTER 'shipped';
                 RAISE NOTICE 'Phase1: added in_transit to scan_step';
            END IF;
          END$$
        `);
      } catch(e) { console.warn('Phase1 scan_step migration (non-fatal):', e.message); }

      try {
        await db.query(`DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_stock_nonneg')
          THEN ALTER TABLE products ADD CONSTRAINT chk_stock_nonneg CHECK (stock >= 0 OR stock IS NULL);
               RAISE NOTICE 'F34: stock CHECK constraint added';
          END IF;
        END$$`);
      } catch(e) { console.warn('F34 stock CHECK (non-fatal):', e.message); }

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
