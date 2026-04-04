/**
 * KOMERCE — Serveur API v8.5 (sécurisé)
 *
 * Point d'entrée Node.js + Express
 * Déployé sur Railway — PORT fourni par la variable d'environnement
 *
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

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const path       = require('path');
const db         = require('./db');

const {
  globalLimiter,
  authLimiter,
  cashConfirmLimiter,
  scanCollectLimiter,
  orderCreateLimiter,
  dashboardLimiter,
} = require('./middleware/rate-limit');

const app = express();

app.set('trust proxy', 1);

const FRONTEND_URL = process.env.FRONTEND_URL || '';

// ── CORS — politique corrigée ────────────────────────────────────────────────

function isAllowedOrigin(origin) {
  // Pas d'origin = requête same-origin ou mobile app → OK
  if (!origin) return true;
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

app.use(helmet());

app.use(cors(corsOptions));

// ── Body parsing ─────────────────────────────────────────────────────────────

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── Rate limiting (middleware/rate-limit.js) ─────────────────────────────────

app.use('/api/', globalLimiter);                            // 100 req/15min global
app.use('/api/auth/login', authLimiter);                    // 5 req/15min brute-force
app.use('/api/auth/register', authLimiter);                 // 5 req/15min anti-spam
app.use('/api/payments/cash/confirm', cashConfirmLimiter);  // 3 req/min cash code
app.use('/api/scans/collect', scanCollectLimiter);          // 5 req/min QR brute-force
app.use('/api/orders', orderCreateLimiter);                 // 10 req/min spam commandes
app.use('/api/dashboard', dashboardLimiter);                // 30 req/min anti-DoS queries

app.use(express.static(path.join(__dirname, 'public')));

// ── Routes API ────────────────────────────────────────────────────────────────

const authRouter       = require('./routes/auth');
const productsRouter   = require('./routes/products');
const ordersRouter     = require('./routes/orders');
const relaisRouter     = require('./routes/relais');
const adminRouter      = require('./routes/admin');
const dashboardRouter  = require('./routes/dashboard');
const pricingRouter    = require('./routes/pricing');
const modulesRouter    = require('./routes/modules');
const pilotageRouter   = require('./routes/pilotage');
const basketsRouter    = require('./routes/baskets');
const logisticsRouter  = require('./routes/logistics');
const paymentsRouter   = require('./routes/payments');
const scansRouter      = require('./routes/scans');
const financeRouter    = require('./routes/finance');
const purchasingRouter = require('./routes/purchasing');
const loyaltyRouter    = require('./routes/loyalty');
const unsoldRouter     = require('./routes/unsold');
const healthRouter     = require('./routes/health');

app.use('/api/auth',       authRouter);
app.use('/api/products',   productsRouter);
app.use('/api/orders',     ordersRouter);
app.use('/api/relais',     relaisRouter);
app.use('/api/admin',      adminRouter);
app.use('/api/dashboard',  dashboardRouter);
app.use('/api/pricing',    pricingRouter);
app.use('/api/modules',    modulesRouter);
app.use('/api/pilotage',   pilotageRouter);
app.use('/api/baskets',    basketsRouter);
app.use('/api/logistics',  logisticsRouter);
app.use('/api/payments',   paymentsRouter);
app.use('/api/scans',      scansRouter);
app.use('/api/finance',    financeRouter);
app.use('/api/purchasing', purchasingRouter);
app.use('/api/loyalty',    loyaltyRouter);
app.use('/api/unsold',     unsoldRouter);
app.use('/health',         healthRouter);    // Railway readiness probe

// ── Healthcheck (avec test DB) ───────────────────────────────────────────────

app.get('/api/health', async (req, res) => {
  try {
    const start = Date.now();
    await db.query('SELECT 1');
    res.json({
      status:        'ok',
      version:       '8.8',
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
  res.sendFile(path.join(__dirname, 'public', 'Komerce_Boutique.html'));
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

let cronRunning = false;
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
}, 60 * 60 * 1000);

// ── Démarrage + Graceful Shutdown ────────────────────────────────────────────

// ── Auto-migration : fix admin bcrypt hash (one-time) ──────────────────────
// Le seed original stockait un hash SHA-256 incompatible avec bcrypt.compare().
// Cette migration corrige automatiquement au premier démarrage.

const bcryptMigrate = require('bcryptjs');

async function fixAdminHash() {
  try {
    // Force-reset admin password to known bcrypt hash — always runs
    const newAdminHash = await bcryptMigrate.hash('Komerce2026!', 10);
    const adminResult = await db.query(
      "UPDATE users SET password_hash = $1 WHERE email = 'admin@komerce.km'",
      [newAdminHash]
    );
    console.log(`✅ Migration: admin hash forcé — ${adminResult.rowCount} row(s) updated`);

    // If admin doesn't exist at all, create it
    if (adminResult.rowCount === 0) {
      await db.query(
        `INSERT INTO users (full_name, email, phone, role, currency_pref, country, password_hash)
         VALUES ('Admin Komerce', 'admin@komerce.km', '+269000000', 'admin', 'KMF', 'KM', $1)
         ON CONFLICT (email) DO UPDATE SET password_hash = $1, role = 'admin'`,
        [newAdminHash]
      );
      console.log('✅ Migration: admin user créé/upserted');
    }

    // Also fix demo clients
    const newClientHash = await bcryptMigrate.hash('client123', 10);
    const clientResult = await db.query(
      "UPDATE users SET password_hash = $1 WHERE role = 'client' AND password_hash NOT LIKE '$2b$%'",
      [newClientHash]
    );
    if (clientResult.rowCount > 0) {
      console.log(`✅ Migration: ${clientResult.rowCount} demo client hashes corrigés`);
    }
  } catch (err) {
    console.error('Migration admin hash error (non-fatal):', err.message);
  }
}

// ── Auto-migration : tables/colonnes manquantes ─────────────────────────────

async function fixMissingSchema() {
  const run = async (label, sql) => {
    try {
      await db.query(sql);
      console.log(`  ✅ ${label}`);
    } catch (err) {
      console.error(`  ⚠️ ${label}: ${err.message}`);
    }
  };

  console.log('🔧 Running schema migrations...');

  // 1. customs_history — colonnes manquantes pour admin/customs
  await run('customs_history.customs_estimated_kmf',
    `ALTER TABLE customs_history ADD COLUMN IF NOT EXISTS customs_estimated_kmf INTEGER DEFAULT 0`);
  await run('customs_history.notes',
    `ALTER TABLE customs_history ADD COLUMN IF NOT EXISTS notes TEXT`);
  await run('customs_history.customs_agent_id',
    `ALTER TABLE customs_history ADD COLUMN IF NOT EXISTS customs_agent_id UUID`);

  // 2. partners — table manquante pour admin/partners
  await run('partners table', `
    CREATE TABLE IF NOT EXISTS partners (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      partner_type TEXT NOT NULL DEFAULT 'relais',
      contact_name TEXT,
      contact_phone TEXT,
      contact_email TEXT,
      address TEXT,
      island TEXT,
      zone TEXT,
      commission_kmf INTEGER DEFAULT 0,
      notes TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // 3. loyalty_tiers — table nécessaire pour pilotage/clients
  await run('loyalty_tiers table', `
    CREATE TABLE IF NOT EXISTS loyalty_tiers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      label TEXT NOT NULL UNIQUE,
      min_orders INT NOT NULL DEFAULT 0,
      discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
      badge TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // 4. users.loyalty_tier_id — colonne FK pour pilotage/clients
  await run('users.loyalty_tier_id',
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS loyalty_tier_id UUID`);

  // 5. customs_taux_mensuel — vue pour pilotage.js
  await run('customs_taux_mensuel view', `
    CREATE OR REPLACE VIEW customs_taux_mensuel AS
    SELECT
      TO_CHAR(created_at, 'YYYY-MM') AS mois,
      ROUND(AVG(customs_delta_pct)::numeric, 2) AS taux_effectif_pct
    FROM customs_history
    WHERE customs_real_kmf > 0
    GROUP BY TO_CHAR(created_at, 'YYYY-MM')
  `);

  // 6. Seed default loyalty tiers si vide
  try {
    const { rows } = await db.query('SELECT COUNT(*)::int AS c FROM loyalty_tiers');
    if (rows[0].c === 0) {
      await run('loyalty tiers seed', `
        INSERT INTO loyalty_tiers (label, min_orders, discount_pct, badge) VALUES
          ('Bronze',   0,  0, '🥉'),
          ('Silver',   3,  2, '🥈'),
          ('Gold',    10,  5, '🥇'),
          ('Platinum', 25, 8, '💎')
        ON CONFLICT DO NOTHING
      `);
    }
  } catch (err) {
    console.error(`  ⚠️ loyalty seed: ${err.message}`);
  }

  console.log('🔧 Schema migrations complete.');
}

const PORT = process.env.PORT || 3000;

fixAdminHash().then(() => fixMissingSchema()).then(() => {
  const server = app.listen(PORT, () => {
    console.log(`KOMERCE API v8.8 — port ${PORT} — helmet OK — rate-limit OK — CORS hardened — migrations OK`);
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM reçu — fermeture gracieuse...');
    server.close(() => {
      console.log('Serveur fermé proprement.');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000);
  });
});

module.exports = app;
