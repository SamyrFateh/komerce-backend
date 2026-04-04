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


// ── SEED : Produits (20 articles — match DEMO_PRODUCTS Boutique) ─────────────
async function seedProducts() {
  const products = [
    // Téléphones & accessoires
    { name: 'Samsung Galaxy A35 (128Go)', price_kmf: 99000, price_eur: 200, category: 'electronics', stock: 15, emoji: '📱', badge: 'Populaire', description: 'Écran AMOLED 6.6", 50MP, double SIM, batterie 5000mAh. Réseau 4G stable aux Comores.' },
    { name: 'Écouteurs Samsung Galaxy Buds2', price_kmf: 39600, price_eur: 80, category: 'electronics', stock: 20, emoji: '🎧', badge: null, description: 'Réduction de bruit active, 5h autonomie + 15h boîtier. Compatible Android & iOS.' },
    { name: 'Pack coques + accessoires (5 pièces)', price_kmf: 14850, price_eur: 30, category: 'electronics', stock: 30, emoji: '📱', badge: 'Nouveau', description: 'Coque renforcée + verre trempé + chargeur rapide 25W + câble USB-C + support voiture.' },
    { name: 'Chargeur rapide 65W GaN (multi-ports)', price_kmf: 19800, price_eur: 40, category: 'electronics', stock: 25, emoji: '🔌', badge: null, description: '3 ports (2 USB-C + 1 USB-A), compact. Charge téléphone + tablette + PC simultanément.' },
    // Électroménager
    { name: 'Ventilateur sur pied 16\"', price_kmf: 24750, price_eur: 50, category: 'home', stock: 25, emoji: '🌀', badge: 'Best-seller', description: 'Oscillant 3 vitesses, silencieux, télécommande. Indispensable aux Comores toute année.' },
    { name: 'Fer à repasser vapeur 2400W', price_kmf: 17325, price_eur: 35, category: 'home', stock: 18, emoji: '👕', badge: null, description: 'Semelle céramique anti-adhésive, réservoir 300ml, départ rapide 30s.' },
    { name: 'Multiprise 6 prises + 2 USB', price_kmf: 9900, price_eur: 20, category: 'home', stock: 35, emoji: '🔌', badge: null, description: 'Câble 2m, disjoncteur sécurité, 2 ports USB-A. Indispensable pour les foyers connectés.' },
    { name: 'Bouilloire électrique 1.7L inox', price_kmf: 12375, price_eur: 25, category: 'home', stock: 22, emoji: '☕', badge: null, description: 'Arrêt automatique, protection anti-surchauffe, ébullition en 3 min.' },
    // Mariage & Bijoux
    { name: 'Montre homme acier brossé', price_kmf: 99000, price_eur: 200, category: 'wedding', stock: 8, emoji: '⌚', badge: 'Exclusif', description: 'Boîtier 42mm, bracelet acier, étanchéité 50m, verre saphir.' },
    { name: 'Collier or 18K (8g)', price_kmf: 277200, price_eur: 560, category: 'wedding', stock: 5, emoji: '📿', badge: 'Premium', description: 'Or 18 carats certifié Dubai, chaîne maille forçat 45cm. Certificat authenticité inclus.' },
    { name: 'Parfum Oud Al Shuyukh 100ml', price_kmf: 59400, price_eur: 120, category: 'wedding', stock: 12, emoji: '🌹', badge: null, description: 'Parfum de luxe Dubai, notes de oud, ambre et rose. Longue tenue 12h+.' },
    { name: 'Coffret cadeau mariage (4 pièces)', price_kmf: 49500, price_eur: 100, category: 'wedding', stock: 15, emoji: '🎁', badge: 'Populaire', description: 'Parfum + crème corps + savon artisanal + bracelet fantaisie.' },
    // Vêtements
    { name: 'Djellaba homme brodée (L/XL/XXL)', price_kmf: 34650, price_eur: 70, category: 'fashion', stock: 20, emoji: '🧥', badge: 'Best-seller', description: 'Tissu Bazin premium, broderie traditionnelle dorée.' },
    { name: 'Abaya femme dentelle Dubai (M/L/XL)', price_kmf: 39600, price_eur: 80, category: 'fashion', stock: 15, emoji: '👗', badge: 'Populaire', description: 'Tissu crêpe fluide, broderie dentelle sur les manches.' },
    { name: 'Boubou enfant 3-12 ans', price_kmf: 19800, price_eur: 40, category: 'fashion', stock: 18, emoji: '👕', badge: null, description: 'Tissu wax africain, coupe ample confortable.' },
    { name: 'Caftan femme soiree (S/M/L/XL)', price_kmf: 54450, price_eur: 110, category: 'fashion', stock: 10, emoji: '🥻', badge: 'Nouveau', description: 'Tissu satiné Dubai, encolure brodée de perles.' },
    // Cosmétiques
    { name: 'Crème visage éclat au safran', price_kmf: 24750, price_eur: 50, category: 'services', stock: 20, emoji: '✨', badge: null, description: 'Soin hydratant au safran de Perse + vitamine C. 50ml.' },
    { name: 'Parfum Oud Rose (50ml)', price_kmf: 34650, price_eur: 70, category: 'services', stock: 18, emoji: '🌸', badge: 'Best-seller', description: 'Eau de parfum Dubai, concentrée 20%, notes de rose et oud boisé.' },
    { name: 'Huile argan pure Maroc (100ml)', price_kmf: 17325, price_eur: 35, category: 'services', stock: 25, emoji: '💧', badge: null, description: 'Argan bio certifié, pressée à froid. Soin cheveux + peau + ongles.' },
    { name: 'Coffret soins corps luxe (5 pièces)', price_kmf: 44550, price_eur: 90, category: 'services', stock: 12, emoji: '🧴', badge: 'Nouveau', description: 'Gommage + lait corps + huile + beurre de karité + savon noir.' },
  ];

  for (const p of products) {
    try {
      const exists = await db.query('SELECT id FROM products WHERE name = $1', [p.name]);
      if (exists.rows.length === 0) {
        await db.query(
          `INSERT INTO products (name, price_kmf, price_eur, category, stock, emoji, badge, description)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [p.name, p.price_kmf, p.price_eur, p.category, p.stock, p.emoji, p.badge, p.description]
        );
      }
    } catch(e) { console.warn('Seed product skip:', p.name, e.message); }
  }
  console.log('🌱 Seed produits OK');
}



// ── SEED : Points relais (5 relais Comores) ─────────────────────────────────
async function seedRelais() {
  const relais = [
    { name: 'Relais Moroni Centre', address: 'Avenue de la République, Moroni', zone: 'Moroni centre', island: 'Grande Comore', phone: '0321001001' },
    { name: 'Relais Mutsamudu Centre', address: 'Rue du Port, Mutsamudu', zone: 'Mutsamudu centre', island: 'Anjouan', phone: '0321002002' },
    { name: 'Relais Fomboni', address: 'Place du Marché, Fomboni', zone: 'Fomboni centre', island: 'Mohéli', phone: '0321003003' },
    { name: 'Relais Domoni', address: 'Centre-ville, Domoni', zone: 'Domoni', island: 'Anjouan', phone: '0321004004' },
    { name: 'Relais Sima', address: 'Route principale, Sima', zone: 'Sima', island: 'Anjouan', phone: '0321005005' },
  ];

  for (const r of relais) {
    try {
      const exists = await db.query('SELECT id FROM relais WHERE name = $1', [r.name]);
      if (exists.rows.length === 0) {
        await db.query(
          'INSERT INTO relais (name, address, zone, island, phone, is_active) VALUES ($1,$2,$3,$4,$5,TRUE)',
          [r.name, r.address, r.zone, r.island, r.phone]
        );
      }
    } catch(e) { console.warn('Seed relais skip:', r.name, e.message); }
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
