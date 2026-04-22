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

// ══════════════════════════════════════════════════════════════════════════════
// WEBHOOK AUTHKEY — réception des statuts de delivery WhatsApp
// ──────────────────────────────────────────────────────────────────────────────
// AuthKey ping ce endpoint à chaque changement de statut d'un message :
//   sent → delivered → read   (ou failed à n'importe quelle étape)
//
// URL configurée dans AuthKey : /webhook/authkey-whatsapp (GET)
// Params query : Mobile, Email, Status, Log ID, Time
//
// Stratégie : répondre 200 IMMÉDIATEMENT (sinon AuthKey retry), 
//             puis stocker en DB en arrière-plan (fire-and-forget).
// ══════════════════════════════════════════════════════════════════════════════
app.get('/webhook/authkey-whatsapp', async (req, res) => {
  // 1. Réponse rapide à AuthKey (évite les retries)
  res.status(200).send('OK');

  try {
    const params = req.query || {};
    const mobile = params.Mobile || params.mobile || null;
    const email  = params.Email || params.email || null;
    const status = params.Status || params.status || null;  // 'sent', 'delivered', 'read', 'failed'
    const logId  = params['Log ID'] || params.LogID || params.log_id || params.logid || null;
    const time   = params.Time || params.time || null;
    const wid    = params.WID || params.wid || null;

    console.log('[AUTHKEY-WA][WEBHOOK]', { mobile, status, logId, time, wid });

    // 2. Persistance en arrière-plan (fire-and-forget)
    if (status || logId) {
      handleAuthkeyWebhook({ mobile, email, status, logId, time, wid })
        .catch(err => console.error('[AUTHKEY-WA][WEBHOOK][BG]', err.message));
    }
  } catch (e) {
    console.error('[AUTHKEY-WA][WEBHOOK][ERROR]', e.message);
    // Déjà répondu 200, on ne fait rien de plus
  }
});

// Handler DB séparé pour que le webhook réponde toujours vite
async function handleAuthkeyWebhook({ mobile, email, status, logId, time, wid }) {
  // 1. Log brut du webhook (trace complète pour debug)
  try {
    await db.query(
      `INSERT INTO notification_log
         (order_ref, parcel_ref, channel, event, recipient, status, detail, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        null,
        null,
        'whatsapp_delivery',
        'delivery_status_' + (status || 'unknown').toLowerCase(),
        mobile,
        status || 'unknown',
        JSON.stringify({ logId, time, wid, email }),
      ]
    );
  } catch (err) {
    if (err.code !== '42P01') {
      console.warn('[AUTHKEY-WA][WEBHOOK][LOG]', err.message);
    }
    // Si la table n'existe pas encore, on skip silencieusement
  }

  // 2. Si FAILED, on log un warning plus visible pour le monitoring
  if (status && /^fail/i.test(status)) {
    console.warn(`[AUTHKEY-WA][FAILED] mobile=${mobile} logId=${logId} time=${time}`);
  }

  // 3. Si DELIVERED ou READ, pas d'action — juste la trace
  //    (on pourrait ici update notification_log.status de la notif originale
  //     si on matchait via logId, mais ça demande de stocker logId au moment 
  //     de l'envoi, ce qu'AuthKey ne renvoie pas toujours)
}

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
const adminRadarRouter = require('./routes/admin-radar');

// ── NEW: Parcel-First API v2 (COLIS-FIRST) ──────────────────────────────────
const parcelApiV2Router = require('./routes/parcel-api-v2');
const parcelLabelRouter = require('./routes/parcel-label');
const orderApiV2Router = require('./routes/order-api-v2');
const notificationApiRouter = require('./routes/notification-api');
const otpRouter = require('./routes/otp');
const clientTrackingRouter = require('./routes/client-tracking');
const simulatorRouter = require('./routes/simulator');
const cashRouter = require('./routes/cash');
const pickupSecretRouter = require('./routes/pickup-secret'); // Western Union model
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
app.use('/api/admin/radar', adminRadarRouter);
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
app.use('/api/simulator', simulatorRouter);
app.use('/api/cash', cashRouter); // Authenticated client tracking
app.use('/api/pickup', pickupSecretRouter); // Western Union model : code secret au paiement
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


      // ── Migration 031: products.subcategory column ──
      try {
        await db.query(`
          ALTER TABLE products ADD COLUMN IF NOT EXISTS subcategory TEXT;
          CREATE INDEX IF NOT EXISTS idx_products_category_subcategory 
            ON products(category, subcategory) WHERE is_available = TRUE;
        `);
        console.log('✅ Migration 031: products.subcategory column ready');
      } catch(e) { console.warn('Migration 031 (non-fatal):', e.message); }

      // ── Migration 034: cash_collections table (réconciliation Option C) ──
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

      // ── Migration 035: cash_deposits table ──
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

      // ── Migration 036: cash_reconciliation table ──
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


      // ── Migration 037: fix products is_active + subcategory + promo_pct ──
      try {
        const migration037 = require('./scripts/migration-037-fix-products');
        await migration037(db);
        console.log('✅ Migration 037: products is_active + subcategory fixed');
      } catch(e) { console.warn('Migration 037 (non-fatal):', e.message); }

      // ── Migration 038: replace catalog with curated products ──
      try {
        const migration038 = require('./scripts/migration-038-replace-products');
        await migration038(db);
        console.log('✅ Migration 038: product catalog replaced');
      } catch(e) { console.warn('Migration 038 (non-fatal):', e.message); }

      // ── Migration 039: French descriptions ──
      try {
        const migration039 = require('./scripts/migration-039-french-descriptions');
        await migration039();
        console.log('✅ Migration 039: descriptions updated to French');
      } catch(e) { console.warn('Migration 039 (non-fatal):', e.message); }

      // ── Migration 041: make email nullable for guest checkout ──
      try {
        await db.query(`ALTER TABLE users ALTER COLUMN email DROP NOT NULL;`);
        console.log('✅ Migration 041: users.email now nullable (guest checkout)');
      } catch(e) { console.warn('Migration 041 (non-fatal):', e.message); }

      // ── Migration 040: users phone_payer + phone_beneficiary columns ──
      try {
        await db.query(`
          ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_payer VARCHAR(30);
          ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_beneficiary VARCHAR(30);
          CREATE INDEX IF NOT EXISTS idx_users_phone_payer ON users(phone_payer);
        `);
        console.log('✅ Migration 040: phone_payer + phone_beneficiary columns added');
      } catch(e) { console.warn('Migration 040 (non-fatal):', e.message); }

      // ── Migration 042: pickup_secret system (Western Union model) ──
      // Voir /docs/SECURITY-MODEL.md pour la doctrine complète.
      try {
        await db.query(`
          -- Code secret hashé (jamais en clair en DB)
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_secret_hash TEXT;
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_secret_salt TEXT;
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_secret_created_at TIMESTAMPTZ;
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_secret_expires_at TIMESTAMPTZ;

          -- Rate limiting au retrait (visite 2)
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_secret_attempts INT DEFAULT 0;
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_secret_blocked_until TIMESTAMPTZ;

          -- Régénération admin (perte de reçu)
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_secret_regen_count INT DEFAULT 0;
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_secret_regen_reason TEXT;

          -- Traçabilité visite 1 (paiement cash)
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_received_at TIMESTAMPTZ;
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_received_by_agent_id UUID REFERENCES users(id);
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS payer_name TEXT;
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS payer_id_type TEXT;
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS payer_id_number TEXT;
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS payer_note TEXT;

          -- Traçabilité visite 2 (retrait)
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS collected_by_name TEXT;

          -- Index utiles
          CREATE INDEX IF NOT EXISTS idx_orders_pickup_created ON orders(pickup_secret_created_at);
          CREATE INDEX IF NOT EXISTS idx_orders_payment_received ON orders(payment_received_at);
        `);
        console.log('✅ Migration 042: pickup_secret system (Western Union model)');
      } catch(e) { console.warn('Migration 042 (non-fatal):', e.message); }

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
