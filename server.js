/**
 * KOMERCE — Serveur API v12.4 (Cash reconciliation + Inventory proposals + Transitaire)
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

app.get('/webhook/authkey-whatsapp', async (req, res) => {
  try {
    console.log('[AUTHKEY-WA][WEBHOOK]', req.query);

    const mobile = req.query.Mobile || null;
    const email = req.query.Email || null;
    const status = req.query.Status || null;
    const logId = req.query['Log ID'] || req.query.LogID || req.query.log_id || null;
    const time = req.query.Time || null;

    return res.status(200).send('OK');
  } catch (e) {
    console.error('[AUTHKEY-WA][WEBHOOK][ERROR]', e.message);
    return res.status(500).send('ERROR');
  }
});

const { applySecurity } = require('./bootstrap/security');



// ── Security headers + CORS ───────────────────────────────────────────────
applySecurity(app);

// ── Stripe webhook MUST receive raw body for signature verification ──────────
app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));
app.use('/api/shared-carts/stripe/webhook', express.raw({ type: 'application/json' }));
app.use('/api/collective-payments/stripe/webhook', express.raw({ type: 'application/json' }));

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

const {
  mountApiRoutesBeforeStripeOwnedBlocks,
  mountApiRoutesAfterStripeOwnedBlocks,
} = require('./bootstrap/api-routes');
const { mountHtmlRoutes } = require('./bootstrap/html-routes');

const walletService    = require('./services/wallet-service');
const routingService   = require('./services/routing');
const parcelSecurity   = require('./services/parcel-security');
const sharedCart = require('./routes/shared-cart');

mountApiRoutesBeforeStripeOwnedBlocks(app);

// ═══ Panier Partagé MVP (Niveau 1) ═══
app.post('/api/shared-carts/stripe/webhook', sharedCart.stripeWebhookHandler);
app.use('/api/shared-carts',       sharedCart.router);
app.use('/api/admin/shared-carts', sharedCart.adminRouter);

// ═══ Panier Événement Collectif V1 ═══
const collectiveWS = require('./routes/collective-workspaces');
const collectivePaymentOrchestrator = require('./services/collective-payment-orchestrator');
app.post('/api/collective-payments/stripe/webhook', collectiveWS.stripeWebhookHandler);
app.use('/api/collective-workspaces', collectiveWS.router);
app.use('/api/collective-payments',   collectiveWS.paymentsRouter);
if (process.env.NODE_ENV !== 'test') {
  const intervalMs = process.env.NODE_ENV === 'production' ? 5 * 60 * 1000 : 30 * 1000;
  collectivePaymentOrchestrator.startExpirationCron(intervalMs);
}
mountApiRoutesAfterStripeOwnedBlocks(app);


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

// ── Public config ─────────────────────────────────────────────
app.get('/api/public/config', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({
    stripe_public_key: process.env.STRIPE_PUBLIC_KEY || process.env.STRIPE_PK || '',
    eur_kmf_rate:      Number(process.env.EUR_KMF_RATE)  || 492,
    aed_kmf_rate:      Number(process.env.AED_KMF_RATE)  || 138,
    whatsapp_number:   process.env.SUPPORT_WHATSAPP    || '',
    support_email:     process.env.SUPPORT_EMAIL       || '',
    env:               process.env.NODE_ENV || 'development',
  });
});

// ── HTML routes / SPA fallback ─────────────────────────────────────────────
mountHtmlRoutes(app, __dirname);

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
  console.log(`KOMERCE API v12.4 — port ${PORT} — démarrage immédiat — migrations en background`);

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

      await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS pending_at TIMESTAMPTZ`);
      await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ`);
      console.log('[MIGRATION] pending_at + confirmed_at columns ensured');

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

      try {
        await db.query(`
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS completion_ratio FLOAT DEFAULT 0;
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS items_received INT DEFAULT 0;
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS items_total INT DEFAULT 0;
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS deadline_dispatch TIMESTAMPTZ;
        `);
        console.log('✅ Migration 027: orders enrichment columns ready');
      } catch(e) { console.warn('Migration 027 (non-fatal):', e.message); }

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

      try {
        await db.query(`
          ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS proposed_parcel_id UUID;
          ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS proposed_at TIMESTAMPTZ;
        `);
        console.log('✅ Migration 029: inventory_items proposal columns ready');
      } catch(e) { console.warn('Migration 029 (non-fatal):', e.message); }
      } catch(e) { console.warn('Migration 028 (non-fatal):', e.message); }

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

      try {
        await db.query(`
          ALTER TABLE products ADD COLUMN IF NOT EXISTS subcategory TEXT;
          CREATE INDEX IF NOT EXISTS idx_products_category_subcategory 
            ON products(category, subcategory) WHERE is_available = TRUE;
        `);
        console.log('✅ Migration 031: products.subcategory column ready');
      } catch(e) { console.warn('Migration 031 (non-fatal):', e.message); }

      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS cash_collections (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            order_id UUID NOT NULL REFERENCES orders(id),
            amount_kmf INTEGER NOT NULL,
            collected_by UUID NOT NULL,
            relais_id UUID,
            confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_coll_order ON cash_collections(order_id);
          CREATE INDEX IF NOT EXISTS idx_cash_coll_agent ON cash_collections(collected_by);
          CREATE INDEX IF NOT EXISTS idx_cash_coll_date ON cash_collections(confirmed_at DESC);
        `);
        console.log('✅ Migration 034: cash_collections table ready');
      } catch(e) { console.warn('Migration 034 (non-fatal):', e.message); }

      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS cash_deposits (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            agent_id UUID NOT NULL,
            amount_kmf INTEGER NOT NULL,
            deposit_method TEXT NOT NULL,
            reference TEXT,
            proof_url TEXT,
            period_start DATE NOT NULL,
            period_end DATE NOT NULL,
            deposited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            verified_by UUID,
            verified_at TIMESTAMPTZ,
            status TEXT NOT NULL DEFAULT 'pending',
            notes TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_cash_dep_agent ON cash_deposits(agent_id);
          CREATE INDEX IF NOT EXISTS idx_cash_dep_status ON cash_deposits(status);
          CREATE INDEX IF NOT EXISTS idx_cash_dep_period ON cash_deposits(period_start, period_end);
        `);
        console.log('✅ Migration 035: cash_deposits table ready');
      } catch(e) { console.warn('Migration 035 (non-fatal):', e.message); }

      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS cash_reconciliation (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            agent_id UUID NOT NULL,
            period_start DATE NOT NULL,
            period_end DATE NOT NULL,
            expected_kmf INTEGER NOT NULL DEFAULT 0,
            declared_kmf INTEGER NOT NULL DEFAULT 0,
            deposited_kmf INTEGER NOT NULL DEFAULT 0,
            gap_collection INTEGER NOT NULL DEFAULT 0,
            gap_deposit INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending',
            reviewed_by UUID,
            reviewed_at TIMESTAMPTZ,
            notes TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_cash_recon_agent ON cash_reconciliation(agent_id);
          CREATE INDEX IF NOT EXISTS idx_cash_recon_status ON cash_reconciliation(status);
          CREATE INDEX IF NOT EXISTS idx_cash_recon_period ON cash_reconciliation(period_start, period_end);
        `);
        console.log('✅ Migration 036: cash_reconciliation table ready');
      } catch(e) { console.warn('Migration 036 (non-fatal):', e.message); }

      try {
        const migration037 = require('./scripts/migration-037-fix-products');
        await migration037(db);
        console.log('✅ Migration 037: products is_active + subcategory fixed');
      } catch(e) { console.warn('Migration 037 (non-fatal):', e.message); }

      try {
        const migration038 = require('./scripts/migration-038-replace-products');
        await migration038(db);
        console.log('✅ Migration 038: product catalog replaced');
      } catch(e) { console.warn('Migration 038 (non-fatal):', e.message); }

      try {
        const migration039 = require('./scripts/migration-039-french-descriptions');
        await migration039();
        console.log('✅ Migration 039: descriptions updated to French');
      } catch(e) { console.warn('Migration 039 (non-fatal):', e.message); }

      try {
        await db.query(`ALTER TABLE users ALTER COLUMN email DROP NOT NULL;`);
        console.log('✅ Migration 041: users.email now nullable (guest checkout)');
      } catch(e) { console.warn('Migration 041 (non-fatal):', e.message); }

      try {
        await db.query(`
          ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_payer VARCHAR(30);
          ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_beneficiary VARCHAR(30);
          CREATE INDEX IF NOT EXISTS idx_users_phone_payer ON users(phone_payer);
        `);
        console.log('✅ Migration 040: phone_payer + phone_beneficiary columns added');
      } catch(e) { console.warn('Migration 040 (non-fatal):', e.message); }

      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS economic_variables (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            category TEXT NOT NULL,
            key TEXT NOT NULL UNIQUE,
            label TEXT NOT NULL,
            unit TEXT DEFAULT 'KMF',
            value_supposed NUMERIC,
            value_observed NUMERIC,
            value_used NUMERIC,
            source_used TEXT DEFAULT 'supposed',
            description TEXT,
            is_critical BOOLEAN DEFAULT FALSE,
            is_computed BOOLEAN DEFAULT FALSE,
            is_active BOOLEAN DEFAULT TRUE,
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            created_at TIMESTAMPTZ DEFAULT NOW()
          );
        `);
        console.log('✅ Migration 046: economic_variables table created');
      } catch(e) { console.warn('Migration 046 (non-fatal):', e.message); }

      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS charges (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            family TEXT NOT NULL,
            name TEXT NOT NULL,
            amount_kmf NUMERIC NOT NULL,
            is_recurring BOOLEAN DEFAULT FALSE,
            recurrence_period TEXT,
            is_active BOOLEAN DEFAULT TRUE,
            notes TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          );
        `);
        console.log('✅ Migration 047: charges table created');
      } catch(e) { console.warn('Migration 047 (non-fatal):', e.message); }

      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS economic_snapshots (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            snapshot_data JSONB NOT NULL,
            model_status TEXT NOT NULL DEFAULT 'stable',
            trigger_event TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
          );
        `);
        console.log('✅ Migration 048: economic_snapshots table created');
      } catch(e) { console.warn('Migration 048 (non-fatal):', e.message); }

      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS finance_config (
            id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
            cost_fixed_sourcing_kmf     INT NOT NULL DEFAULT 1000,
            cost_fixed_transit_kmf      INT NOT NULL DEFAULT  500,
            cost_fixed_hub_kmf          INT NOT NULL DEFAULT  400,
            cost_fixed_relais_kmf       INT NOT NULL DEFAULT  300,
            cost_fixed_support_kmf      INT NOT NULL DEFAULT  200,
            target_marge_brute_pct      NUMERIC(5,2) NOT NULL DEFAULT 30.00,
            target_panier_moyen_kmf     INT NOT NULL DEFAULT 15000,
            objectif_commandes_mois     INT NOT NULL DEFAULT 100,
            objectif_ca_mensuel_kmf     INT NOT NULL DEFAULT 1500000,
            taux_change_eur_kmf         NUMERIC(10,2) NOT NULL DEFAULT 491.96,
            markup_cible_pct            NUMERIC(5,2) NOT NULL DEFAULT 250.00,
            cout_achat_moyen_eur        NUMERIC(10,2) NOT NULL DEFAULT 5.00,
            delai_transit_jours         INT NOT NULL DEFAULT 25,
            commission_relais_pct       NUMERIC(5,2) NOT NULL DEFAULT 5.00,
            frais_livraison_defaut_kmf  INT NOT NULL DEFAULT 1500,
            seuil_livraison_gratuite_kmf INT NOT NULL DEFAULT 25000,
            taux_conversion_pct         NUMERIC(5,2) NOT NULL DEFAULT 3.00,
            taux_retour_pct             NUMERIC(5,2) NOT NULL DEFAULT 2.00,
            loyalty_active              BOOLEAN NOT NULL DEFAULT TRUE,
            loyalty_threshold_kmf       INT NOT NULL DEFAULT 20000,
            loyalty_trigger_count       INT NOT NULL DEFAULT 3,
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            updated_by UUID
          );
          INSERT INTO finance_config (id) VALUES (1) ON CONFLICT DO NOTHING;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS big_basket_count INT NOT NULL DEFAULT 0;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS big_basket_last_notified_count INT NOT NULL DEFAULT 0;
          CREATE TABLE IF NOT EXISTS loyalty_rewards (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            triggered_by_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
            basket_count_at_trigger INT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'granted', 'skipped')),
            gift_description TEXT,
            granted_at TIMESTAMPTZ,
            granted_by UUID REFERENCES users(id),
            notes TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_loyalty_rewards_user ON loyalty_rewards(user_id);
          CREATE INDEX IF NOT EXISTS idx_loyalty_rewards_status ON loyalty_rewards(status);
          CREATE INDEX IF NOT EXISTS idx_users_big_basket ON users(big_basket_count) WHERE big_basket_count > 0;
        `);
        console.log('✅ Migration 049: finance_config + loyalty_rewards + big_basket');
      } catch(e) { console.warn('Migration 049 (non-fatal):', e.message); }

      try {
        await db.query(`
          ALTER TABLE products ADD COLUMN IF NOT EXISTS sourcing_rail TEXT;
          ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price_kmf INTEGER;
          ALTER TABLE products ADD COLUMN IF NOT EXISTS weight_g INTEGER;
          ALTER TABLE products ADD COLUMN IF NOT EXISTS volume_class TEXT;
          ALTER TABLE products ADD COLUMN IF NOT EXISTS fragility TEXT;
          ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_mode TEXT;
          ALTER TABLE products ADD COLUMN IF NOT EXISTS exposure_mode TEXT;
          ALTER TABLE products ADD COLUMN IF NOT EXISTS lifecycle_status TEXT DEFAULT 'candidate';
          ALTER TABLE products ADD COLUMN IF NOT EXISTS quality_validated BOOLEAN DEFAULT FALSE;
          ALTER TABLE products ADD COLUMN IF NOT EXISTS real_weight_known BOOLEAN DEFAULT FALSE;
          ALTER TABLE products ADD COLUMN IF NOT EXISTS real_price_validated BOOLEAN DEFAULT FALSE;
          ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_delay_days INTEGER;
          ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_notes TEXT;
          ALTER TABLE products ADD COLUMN IF NOT EXISTS last_review_at TIMESTAMPTZ;
          CREATE INDEX IF NOT EXISTS idx_products_sourcing_rail ON products(sourcing_rail) WHERE sourcing_rail IS NOT NULL;
          CREATE INDEX IF NOT EXISTS idx_products_lifecycle ON products(lifecycle_status) WHERE is_active = TRUE;
        `);
        console.log('✅ Migration 050: sourcing columns on products');
      } catch(e) { console.warn('Migration 050 (non-fatal):', e.message); }

      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS signals (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            signal_type TEXT NOT NULL,
            severity TEXT NOT NULL DEFAULT 'info'
              CHECK (severity IN ('info','warning','critical','urgent')),
            title TEXT NOT NULL,
            summary TEXT,
            source_module TEXT NOT NULL DEFAULT 'signal-service',
            target_shell TEXT DEFAULT 'bo',
            target_view TEXT,
            target_filters JSONB DEFAULT '{}',
            owner_role TEXT NOT NULL DEFAULT 'admin',
            status TEXT NOT NULL DEFAULT 'open'
              CHECK (status IN ('open','acknowledged','snoozed','resolved','expired')),
            entity_type TEXT,
            entity_id TEXT,
            recommendation TEXT,
            confidence TEXT DEFAULT 'high'
              CHECK (confidence IN ('low','medium','high')),
            meta JSONB DEFAULT '{}',
            snoozed_until TIMESTAMPTZ,
            escalated_at TIMESTAMPTZ,
            resolved_at TIMESTAMPTZ,
            resolved_by UUID,
            expires_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status) WHERE status IN ('open','acknowledged');
          CREATE INDEX IF NOT EXISTS idx_signals_type ON signals(signal_type);
          CREATE INDEX IF NOT EXISTS idx_signals_severity ON signals(severity);
          CREATE INDEX IF NOT EXISTS idx_signals_owner ON signals(owner_role);
          CREATE INDEX IF NOT EXISTS idx_signals_entity ON signals(entity_type, entity_id);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_dedup
            ON signals(signal_type, entity_type, entity_id) WHERE status = 'open';
        `);
        console.log('✅ Migration 051: signals table created');
      } catch(e) { console.warn('Migration 051 (non-fatal):', e.message); }

      // ── Migration 050b : order_item_cost_imputations (snapshot économique figé) ──
      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS order_item_cost_imputations (
            id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            order_id              UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            order_item_id         UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
            product_id            UUID REFERENCES products(id) ON DELETE SET NULL,
            quantity              INTEGER NOT NULL,
            sale_unit_price_kmf   NUMERIC(12,2) NOT NULL,
            sale_total_kmf        NUMERIC(12,2) NOT NULL,
            estimated_landed_relay_cost_kmf      NUMERIC(12,2),
            estimated_business_complete_cost_kmf NUMERIC(12,2),
            estimated_margin_kmf                 NUMERIC(12,2),
            estimated_margin_pct                 NUMERIC(6,2),
            cost_breakdown         JSONB,
            allocations            JSONB,
            allocation_averages    JSONB,
            allocation_confidence  TEXT,
            data_quality           JSONB,
            pricing_source         TEXT NOT NULL DEFAULT 'pricing-engine',
            created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_oici_order      ON order_item_cost_imputations(order_id);
          CREATE INDEX IF NOT EXISTS idx_oici_product    ON order_item_cost_imputations(product_id);
          CREATE INDEX IF NOT EXISTS idx_oici_created_at ON order_item_cost_imputations(created_at);
          DO $do$ BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'order_item_cost_imputations_order_item_id_unique'
            ) THEN
              ALTER TABLE order_item_cost_imputations
                ADD CONSTRAINT order_item_cost_imputations_order_item_id_unique UNIQUE (order_item_id);
            END IF;
          END $do$;
        `);
        console.log('✅ Migration 050b: order_item_cost_imputations table ready');
      } catch(e) { console.warn('Migration 050b (non-fatal):', e.message); }

      // ── Migration 051b : order_item_real_cost_allocations (réventilation terrain) ──
      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS order_item_real_cost_allocations (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            order_id          UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            order_item_id     UUID REFERENCES order_items(id) ON DELETE CASCADE,
            cost_type         TEXT NOT NULL,
            allocation_method TEXT NOT NULL DEFAULT 'manual',
            amount_kmf        NUMERIC(12,2) NOT NULL,
            is_actual         BOOLEAN NOT NULL DEFAULT TRUE,
            confidence        TEXT DEFAULT 'high',
            source            TEXT,
            parcel_id         UUID REFERENCES parcels(id) ON DELETE SET NULL,
            shipment_id       UUID,
            meta              JSONB DEFAULT '{}',
            allocated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_oirca_order      ON order_item_real_cost_allocations(order_id);
          CREATE INDEX IF NOT EXISTS idx_oirca_item       ON order_item_real_cost_allocations(order_item_id);
          CREATE INDEX IF NOT EXISTS idx_oirca_cost_type  ON order_item_real_cost_allocations(cost_type);
          CREATE INDEX IF NOT EXISTS idx_oirca_is_actual  ON order_item_real_cost_allocations(is_actual);
        `);
        console.log('✅ Migration 051b: order_item_real_cost_allocations table ready');
      } catch(e) { console.warn('Migration 051b (non-fatal):', e.message); }

      try {
        const { rows: existingCharges } = await db.query('SELECT COUNT(*) as c FROM charges');
        if (parseInt(existingCharges[0].c) === 0) {
          await db.query(`
            INSERT INTO charges (family, name, amount_kmf, is_recurring, recurrence_period, is_active, notes) VALUES
            ('logistique', 'Hub Dubai', 40000, true, 'monthly', true, 'Réception & stockage Dubai — défaut 400 KMF/cmd × 100 cmd/mois'),
            ('logistique', 'Relais Comores', 30000, true, 'monthly', true, 'Points relais Comores — défaut 300 KMF/cmd × 100 cmd/mois'),
            ('approvisionnement', 'Sourcing Dubai', 100000, true, 'monthly', true, 'Achat & approvisionnement — défaut 1000 KMF/cmd × 100 cmd/mois'),
            ('support', 'Support client', 20000, true, 'monthly', true, 'SAV & support client — défaut 200 KMF/cmd × 100 cmd/mois'),
            ('logistique', 'Transit Comores', 500, false, null, true, 'Transport Dubai→Comores — variable par commande')
          `);
          console.log('✅ Migration 052: 5 charges seeded with defaults');
        } else {
          console.log('✅ Migration 052: charges already seeded, skipping');
        }
      } catch(e) { console.warn('Migration 052 (non-fatal):', e.message); }

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

// NEW-07 — Crash guards : éviter qu'une promesse non catchée tue le process
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  // Sortir proprement — l'état du process est incertain après uncaughtException
  setTimeout(() => process.exit(1), 500);
});

module.exports = app;
