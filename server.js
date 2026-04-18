/**
 * KOMERCE — Serveur API v12.3 (Inventory proposals + Transitaire)
 *
 * Point d'entrée Node.js + Express
 * Déployé sur Railway — PORT fourni par la variable d'environnement
 *
 * Changelog v11.2: Parcel-First API v2 (routes/parcel-api-v2.js) — refonte COLIS-FIRST
 * Changelog v10.18: routes/invoices.js ajouté (mini-facture client)
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

// ── Stripe webhook MUST receive raw body for signature verification ──────────
// This must come BEFORE express.json() so the body stays a Buffer
app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));

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
  if (req.path.includes('Boutique') || req.path === '/boutique.html' || req.path === '/portal.html' || req.path === '/suivi.html' || req.path === '/mon-compte.html') return next();
  const filePath = path.join(__dirname, 'public', req.path);
  _fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) return next();
    html = html.replace('</body>', '<script src="/js/auth-guard.js"></script>\
</body>');
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
const adminRulesRouter = require('./routes/admin-rules');
const adminPricingMatricesRouter = require('./routes/admin-pricing-matrices');
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
const invoicesRouter   = require('./routes/invoices');
const opsApiRouter = require('./routes/ops-api');
const trackingRouter   = require('./routes/tracking');
const clientAuthRouter = require('./routes/client-auth');
const walletService    = require('./services/wallet-service');
const routingService   = require('./services/routing');
const parcelSecurity   = require('./services/parcel-security');

// ── NEW: Parcel-First API v2 (COLIS-FIRST) ──────────────────────────────────
const parcelApiV2Router = require('./routes/parcel-api-v2');
const parcelLabelRouter = require('./routes/parcel-label');
const orderApiV2Router = require('./routes/order-api-v2');
const notificationApiRouter = require('./routes/notification-api');
const otpRouter = require('./routes/otp');
const clientTrackingRouter = require('./routes/client-tracking');
const simulatorRouter = require('./routes/simulator');
const inventoryApiRouter = require('./routes/inventory-api');
const transitaireApiRouter = require('./routes/transitaire-api');
const autoDistributeRouter = require('./routes/auto-distribute-api');
const hubMarkOrderedRouter = require('./routes/hub-mark-ordered');
const transitDashboardRoutes = require('./routes/transit-dashboard');
const sharesRouter = require('./routes/shares');
const metaWhatsAppRoutes = require('./routes/meta-whatsapp');


app.use('/api/transit-dashboard', transitDashboardRoutes);
app.use('/api/auth',       authRouter);
app.use('/api/products',   productsRouter);
app.use('/api/orders',     ordersRouter);
app.use('/api/relais',     relaisRouter);
app.use('/api/admin/finance',  financeRouter);
app.use('/api/admin/pilotage', dashboardRouter);
app.use('/api/admin/stats',    dashboardRouter);
app.use('/api/admin',      adminRouter);
app.use('/api/admin/rules', adminRulesRouter);
app.use('/api/admin/pricing-matrices', adminPricingMatricesRouter);
app.use('/api/dashboard',  dashboardRouter);
app.use('/api/relay',      relayDashRouter);
app.use('/api/hub-dash',   hubDashRouter);
app.use('/api/transit',    transitDashRouter);

// ── Parcel-First API MUST be mounted BEFORE generic /api/v2 ─────────────────
app.use('/api/v2/parcels', parcelApiV2Router);
app.use('/api/v2/parcels', parcelLabelRouter);
app.use('/api/v2/orders', orderApiV2Router);
app.use('/api/v2/notifications', notificationApiRouter);
app.use('/api/v2', opsApiRouter);

app.use('/api/tracking', trackingRouter);
app.use('/api/auth/otp', otpRouter);      // WhatsApp OTP auth
app.use('/api/client/tracking', clientTrackingRouter);
app.use('/api/simulator', simulatorRouter); // Authenticated client tracking
app.use('/api/auth', clientAuthRouter);   // Magic link routes
app.use('/api/client', clientAuthRouter); // Client orders/invoices
app.use('/api/invoices',   invoicesRouter);
app.use('/api/pricing',    pricingRouter);
app.use('/api/modules',    modulesRouter);
app.use('/api/baskets',    basketsRouter);
app.use('/api/logistics',  logisticsRouter);
app.use('/api/parcels',    parcelsRouter);
app.use('/api/hub',        hubRouter);
app.use('/api/hub',        hubMarkOrderedRouter);
app.use('/api/hub/inventory', inventoryApiRouter);
app.use('/api/transitaire', transitaireApiRouter);
app.use('/api/hub', autoDistributeRouter);
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
app.use('/api/shares',     sharesRouter);
app.use('/health',         healthRouter);
app.use(metaWhatsAppRoutes);


// ── Healthcheck ─────────────────────────────────────────────────────────────

app.get('/api/health', async (req, res) => {
  try {
    const start = Date.now();
    await db.query('SELECT 1');
    res.json({
      status:        'ok',
      version:       '12.3',
      db_latency_ms: Date.now() - start,
      timestamp:     new Date().toISOString(),
      env:           process.env.NODE_ENV || 'development',
    });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'unreachable' });
  }
});

// ── SPA fallback ────────────────────────────────────────────────────────────

// ── Tracking short URL: /s/:token → serve suivi.html ──────────────────────
app.get('/s/:token', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'suivi.html'));
});

// ── Mon Compte — serve without auth-guard ─────────────────────────────────
app.get('/mon-compte', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'mon-compte.html'));
});

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

  // ── Auto-confirm expired inventory proposals (every 30min) ──
  setInterval(async () => {
    try {
      const inv = require('./services/inventory-service');
      const result = await inv.autoConfirmExpired();
      if (result.auto_confirmed > 0)
        console.log(`[CRON] Auto-confirmed ${result.auto_confirmed} inventory proposals`);
    } catch (e) { /* non-fatal */ }
  }, 30 * 60 * 1000);

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
  console.log(`KOMERCE API v12.2 — port ${PORT} — démarrage immédiat — migrations en background`);

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

      // ── Migration 023: invoices table ──
      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS invoices (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            invoice_number TEXT NOT NULL UNIQUE,
            order_id UUID NOT NULL REFERENCES orders(id),
            parcel_id UUID REFERENCES parcels(id),
            client_name TEXT NOT NULL,
            client_phone TEXT NOT NULL,
            relay_name TEXT NOT NULL,
            items_snapshot JSONB NOT NULL,
            subtotal_kmf INTEGER NOT NULL,
            shipping_kmf INTEGER NOT NULL DEFAULT 0,
            total_kmf INTEGER NOT NULL,
            payment_mode TEXT NOT NULL,
            payment_status TEXT NOT NULL DEFAULT 'paid',
            delivered_via TEXT,
            delivered_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1;
          CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id);
          CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
        `);
        console.log('✅ Migration 023: invoices table ready');
      } catch(e) { console.warn('Migration 023 (non-fatal):', e.message); }

      // ── Migration 024: notification_log table ──
      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS notification_log (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            parcel_ref VARCHAR(30),
            order_ref VARCHAR(30),
            channel VARCHAR(20) NOT NULL,
            event VARCHAR(50) NOT NULL,
            recipient VARCHAR(100) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            detail JSONB DEFAULT '{}',
            created_at TIMESTAMPTZ DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_notif_parcel ON notification_log(parcel_ref);
          CREATE INDEX IF NOT EXISTS idx_notif_order ON notification_log(order_ref);
          CREATE INDEX IF NOT EXISTS idx_notif_channel ON notification_log(channel);
          CREATE INDEX IF NOT EXISTS idx_notif_created ON notification_log(created_at DESC);
        `);
        console.log('✅ Migration 024: notification_log table ready');
      } catch(e) { console.warn('Migration 024 (non-fatal):', e.message); }

      
      // ── Migration 025: otp_codes table ──
      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS otp_codes (
            id SERIAL PRIMARY KEY,
            phone VARCHAR(20) NOT NULL,
            code VARCHAR(6) NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            attempts INTEGER DEFAULT 0,
            verified BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone);
          CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_codes(expires_at);
        `);
        console.log('✅ Migration 025: otp_codes table ready');
      } catch(e) { console.warn('Migration 025 (non-fatal):', e.message); }

      // ── Migration: ensure 'pending' in order_status enum ──
      try {
        await db.query(`
          DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
              WHERE t.typname = 'order_status' AND e.enumlabel = 'pending')
            THEN ALTER TYPE order_status ADD VALUE 'pending' BEFORE 'confirmed';
                 RAISE NOTICE 'Added pending to order_status enum';
            END IF;
          END$$
        `);
      } catch(e) { console.warn('Pending enum migration (non-fatal):', e.message); }

      // ── Phase 2: Add timestamp columns for pending/confirmed ──
      await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS pending_at TIMESTAMPTZ`);
      await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ`);
      console.log('[MIGRATION] pending_at + confirmed_at columns ensured');


      // ── Migration 026: inventory_items table ──
      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS inventory_items (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            order_item_id UUID,
            order_id UUID,
            product_id UUID,
            quantity INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'received',
            parcel_id UUID,
            received_at TIMESTAMPTZ DEFAULT NOW(),
            assigned_at TIMESTAMPTZ,
            buffer_reason TEXT,
            buffer_until TIMESTAMPTZ,
            received_by UUID,
            notes TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_inventory_order ON inventory_items(order_id);
          CREATE INDEX IF NOT EXISTS idx_inventory_status ON inventory_items(status);
          CREATE INDEX IF NOT EXISTS idx_inventory_parcel ON inventory_items(parcel_id);
          CREATE INDEX IF NOT EXISTS idx_inventory_order_item ON inventory_items(order_item_id);
        `);
        console.log('✅ Migration 026: inventory_items table ready');
      } catch(e) { console.warn('Migration 026 (non-fatal):', e.message); }

      // ── Migration 027: orders enrichment columns ──
      try {
        await db.query(`
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS completion_ratio FLOAT DEFAULT 0;
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS items_received INT DEFAULT 0;
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS items_total INT DEFAULT 0;
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS deadline_dispatch TIMESTAMPTZ;
        `);
        console.log('✅ Migration 027: orders enrichment columns ready');
      } catch(e) { console.warn('Migration 027 (non-fatal):', e.message); }

      // ── Migration 028: seed transitaire user ──
      try {
        const bcrypt = require('bcryptjs');
        const transitPwd = process.env.TRANSITAIRE_PASSWORD || 'KomTransit2025!';
        const transitHash = await bcrypt.hash(transitPwd, 10);
        await db.query(`
          INSERT INTO users (id, full_name, email, phone, role, password_hash)
          VALUES (gen_random_uuid(), 'Transitaire Komerce', 'transitaire@komerce.km', '+2690000003', 'agent_transitaire', $1)
          ON CONFLICT (email) DO UPDATE SET password_hash = $1, role = 'agent_transitaire'
        `, [transitHash]);
        console.log('✅ Migration 028: transitaire user seeded');

      // ── Migration 029: inventory_items proposal columns ──
      try {
        await db.query(`
          ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS proposed_parcel_id UUID;
          ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS proposed_at TIMESTAMPTZ;
        `);
        console.log('✅ Migration 029: inventory_items proposal columns ready');
      } catch(e) { console.warn('Migration 029 (non-fatal):', e.message); }
      } catch(e) { console.warn('Migration 028 (non-fatal):', e.message); }
	  
	        // ── Migration 033: table audit matrices pricing ──
      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS pricing_matrices_audit (
            id             SERIAL PRIMARY KEY,
            matrix_type    VARCHAR(20) NOT NULL CHECK (matrix_type IN ('taxes', 'dims')),
            category       VARCHAR(50) NOT NULL,
            old_value      JSONB NOT NULL,
            new_value      JSONB NOT NULL,
            changed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
            change_reason  TEXT,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_pma_created ON pricing_matrices_audit(created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_pma_matrix_cat ON pricing_matrices_audit(matrix_type, category);
        `);
        console.log('✅ Migration 033: pricing_matrices_audit table ready');
      } catch(e) { console.warn('Migration 033 (non-fatal):', e.message); }
	  
	        // ── Migration 030: cart_shares table (panier partagé) ──
      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS cart_shares (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            share_token VARCHAR(16) NOT NULL,
            cart_items JSONB NOT NULL,
            cart_total_kmf BIGINT NOT NULL,
            items_count SMALLINT NOT NULL,
            sharer_name VARCHAR(50),
            sharer_ip_hash VARCHAR(64),
            sharer_ua_hash VARCHAR(64),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            first_opened_at TIMESTAMPTZ,
            open_count INT NOT NULL DEFAULT 0,
            converted_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
            converted_at TIMESTAMPTZ,
            CONSTRAINT unique_share_token UNIQUE (share_token)
          );
          CREATE INDEX IF NOT EXISTS idx_cart_shares_token ON cart_shares(share_token);
          CREATE INDEX IF NOT EXISTS idx_cart_shares_created ON cart_shares(created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_cart_shares_converted ON cart_shares(converted_order_id)
            WHERE converted_order_id IS NOT NULL;
        `);
        console.log('✅ Migration 030: cart_shares table ready');
      } catch(e) { console.warn('Migration 030 (non-fatal):', e.message); }

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
