require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const morgan = require('morgan');
const compression = require('compression');
const db = require('./db');
const errorHandler = require('./middleware/errorHandler');
const log = require('./utils/logger').child({ module: 'server' });

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// ── Core middleware ─────────────────────────────────────────────────────────

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
  credentials: true,
}));

app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Stripe-owned raw webhook routes must be registered before express.json().
// The actual handlers are mounted below once route modules are loaded.

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Static assets ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

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
const sharedCartRefundAdmin = require('./routes/shared-cart-refund-admin');

mountApiRoutesBeforeStripeOwnedBlocks(app);

// ═══ Panier Partagé MVP (Niveau 1) ═══
app.post('/api/shared-carts/stripe/webhook', sharedCart.stripeWebhookHandler);
app.use('/api/shared-carts',       sharedCart.router);
app.use('/api/admin/shared-carts', sharedCartRefundAdmin.router);
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

// ── Operational crons ───────────────────────────────────────────────────────
const { startOperationalCrons } = require('./bootstrap/crons');
startOperationalCrons();

app.listen(PORT, () => {
  log.info(`✅ Komerce backend listening on port ${PORT}`);
});

module.exports = app;
