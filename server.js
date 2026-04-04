/**
 * KOMERCE — Serveur API v9.0 (sécurisé)
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


// ── SEED : Produits Comores ──────────────────────────────────────────────────
async function seedProducts() {
  const products = [
    { name: 'Vanille bourbon',    price: 15000, category: 'epices',      stock: 50,  description: 'Vanille premium des Comores, qualité export' },
    { name: 'Girofle',            price: 8000,  category: 'epices',      stock: 100, description: 'Clous de girofle séchés, arôme intense' },
    { name: 'Ylang-ylang huile',  price: 12000, category: 'cosmetiques', stock: 30,  description: 'Huile essentielle pure, distillation artisanale' },
    { name: 'Cannelle',           price: 5000,  category: 'epices',      stock: 80,  description: 'Bâtons de cannelle fraîche' },
    { name: 'Poivre noir',        price: 6000,  category: 'epices',      stock: 70,  description: 'Poivre noir moulu des plantations comoriennes' },
    { name: 'Curcuma',            price: 4000,  category: 'epices',      stock: 90,  description: 'Curcuma bio en poudre' },
    { name: 'Savon ylang',        price: 3000,  category: 'cosmetiques', stock: 60,  description: 'Savon artisanal à l\'huile d\'ylang-ylang' },
    { name: 'Huile de coco',      price: 2500,  category: 'cosmetiques', stock: 100, description: 'Huile de coco vierge pressée à froid' },
    { name: 'Beurre de karité',   price: 4500,  category: 'cosmetiques', stock: 40,  description: 'Beurre de karité pur, hydratant naturel' },
    { name: 'Panier tressé',      price: 7000,  category: 'artisanat',   stock: 25,  description: 'Panier traditionnel en feuilles de cocotier' },
    { name: 'Chapeau kofia',      price: 5000,  category: 'artisanat',   stock: 35,  description: 'Kofia brodé main, tradition comorienne' },
    { name: 'Natte traditionnelle',price: 10000, category: 'artisanat',  stock: 15,  description: 'Natte tissée en fibres naturelles' },
    { name: 'Café des Comores',   price: 6000,  category: 'alimentation',stock: 50,  description: 'Café arabica torréfié artisanalement' },
    { name: 'Miel sauvage',       price: 8000,  category: 'alimentation',stock: 30,  description: 'Miel récolté dans les forêts comoriennes' },
    { name: 'Sel marin',          price: 2000,  category: 'alimentation',stock: 200, description: 'Sel de mer naturel, séché au soleil' },
    { name: 'T-shirt Komerce',    price: 5000,  category: 'textile',     stock: 100, description: 'T-shirt officiel Komerce, coton bio' },
    { name: 'Sac en jute',        price: 3500,  category: 'textile',     stock: 60,  description: 'Sac réutilisable en jute naturel' },
    { name: 'Chiromani',          price: 15000, category: 'textile',     stock: 20,  description: 'Tissu traditionnel comorien, porté en cérémonie' },
    { name: 'Bracelet coco',      price: 2000,  category: 'artisanat',   stock: 80,  description: 'Bracelet artisanal en coque de noix de coco' },
    { name: 'Tableau bois gravé', price: 9000,  category: 'artisanat',   stock: 10,  description: 'Tableau décoratif gravé sur bois local' },
  ];

  for (const p of products) {
    const exists = await db.query('SELECT id FROM products WHERE name = $1', [p.name]);
    if (exists.rows.length === 0) {
      await db.query(
        'INSERT INTO products (name, price, category, stock, description) VALUES ($1,$2,$3,$4,$5)',
        [p.name, p.price, p.category, p.stock, p.description]
      );
    }
  }
  console.log('🌱 Seed produits OK');
}

// ── SEED : Points relais ─────────────────────────────────────────────────────
async function seedRelais() {
  const relais = [
    { name: 'Relais Moroni',     address: 'Avenue de la République, Moroni',   city: 'Moroni',     island: 'Grande Comore', phone: '0321001001', lat: -11.7022, lng: 43.2551 },
    { name: 'Relais Mutsamudu',  address: 'Rue du Port, Mutsamudu',           city: 'Mutsamudu',  island: 'Anjouan',       phone: '0321002002', lat: -12.1637, lng: 44.3940 },
    { name: 'Relais Fomboni',    address: 'Place du Marché, Fomboni',         city: 'Fomboni',    island: 'Mohéli',        phone: '0321003003', lat: -12.2878, lng: 43.7414 },
    { name: 'Relais Domoni',     address: 'Centre-ville, Domoni',             city: 'Domoni',     island: 'Anjouan',       phone: '0321004004', lat: -12.2569, lng: 44.5319 },
    { name: 'Relais Sima',       address: 'Route principale, Sima',           city: 'Sima',       island: 'Anjouan',       phone: '0321005005', lat: -12.1956, lng: 44.2761 },
  ];

  for (const r of relais) {
    const exists = await db.query('SELECT id FROM relais WHERE name = $1', [r.name]);
    if (exists.rows.length === 0) {
      await db.query(
        'INSERT INTO relais (name, address, city, island, phone, lat, lng, active) VALUES ($1,$2,$3,$4,$5,$6,$7,true)',
        [r.name, r.address, r.city, r.island, r.phone, r.lat, r.lng]
      );
    }
  }
  console.log('🌱 Seed relais OK');
}


fixAdminHash().then(() => fixMissingSchema()).then(() => seedProducts()).then(() => seedRelais()).then(() => {
  const server = app.listen(PORT, () => {
    console.log(`KOMERCE API v9.0 — port ${PORT} — helmet OK — rate-limit OK — CORS hardened — migrations OK`);
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
