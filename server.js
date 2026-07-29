/**
 * @komerce-arch
 * @role          api-server-entrypoint
 * @domain        bootstrap
 * @layer         entrypoint
 * @criticality   critical
 * @inputs        http_requests, env_vars, raw_webhooks, static_assets
 * @outputs       mounted_api, boutique_static, crons, server_lifecycle
 * @depends       bootstrap/env.js, bootstrap/security.js, bootstrap/api-routes.js, bootstrap/html-routes.js, bootstrap/crons.js, bootstrap/feature-wiring.js, routes/shared-cart.js
 * @db-write      none
 * @db-read      none
 * @used-by       railway-runtime
 * @doctrine      raw_body_webhook_intact, routes_canoniques, static_boutique_served
 * @impact-areas  all-api, shared-cart, payments, boutique, crons, auth
 * @version       2026-06
 */

/**
 * KOMERCE — Serveur API
 *
 * Point d'entrée Node.js + Express.
 * Déployé sur Railway — PORT fourni par la variable d'environnement.
 *
 * Convention versioning : `package.json` est la source de vérité. `/api/health`
 * expose `require('./package.json').version`.
 */

const { loadAndValidateEnv } = require('./bootstrap/env');
loadAndValidateEnv();

const { wireFeatureBoundaries } = require('./bootstrap/feature-wiring');
wireFeatureBoundaries();

const log          = require('./utils/logger').child({ module: 'server' });
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

const { verifyAuthkeyWebhook } = require('./middleware/verify-authkey-webhook');

app.get('/webhook/authkey-whatsapp', verifyAuthkeyWebhook, async (req, res) => {
  try {
    const mobile = req.query.Mobile || null;
    const email  = req.query.Email  || null;
    const status = req.query.Status || null;
    const logId  = req.query['Log ID'] || req.query.LogID || req.query.log_id || null;
    const time   = req.query.Time   || null;
    // FRESH-041: log structuré sur champs extraits uniquement (pas req.query brut — PII)
    log.info({ mobile, status, logId, time, hasEmail: !!email }, '[AUTHKEY-WA][WEBHOOK]');

    return res.status(200).send('OK');
  } catch (e) {
    log.error({ err: e }, '[AUTHKEY-WA][WEBHOOK][ERROR]');
    return res.status(500).send('ERROR');
  }
});

const { applySecurity } = require('./bootstrap/security');



// ── Security headers + CORS ───────────────────────────────────────────────
applySecurity(app);

// ── Stripe webhook MUST receive raw body for signature verification ──────────
app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));
app.use('/api/shared-carts/stripe/webhook', express.raw({ type: 'application/json' }));
// PayPal webhook — raw body avant express.json (I-07). Migration 079.
app.use('/api/payments/paypal/webhook', express.raw({ type: 'application/json' }));
// /api/collective-payments/stripe/webhook supprimé — collective_workspaces démonté 2026-05-30

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
// FRESH-081 : allowlist explicite pour éviter tout path traversal.
// Express normalise req.path (decode + normalize) mais on ajoute une seconde
// couche : seuls les chemins connus reçoivent l'injection auth-guard.
const _fs = require('fs');
const HTML_AUTH_GUARD_ALLOWLIST = new Set([
  '/dashboards/admin/index.html',
  '/dashboards/admin-legacy/control-tower.html',
  '/relais/index.html',
  '/hub/index.html',
]);
app.get('/*.html', (req, res, next) => {
  if (req.path.includes('Boutique') || req.path === '/boutique.html' || req.path === '/portal.html' || req.path === '/suivi.html' || req.path === '/mon-compte.html') return next();
  // Sécurité : uniquement les pages admin connues
  if (!HTML_AUTH_GUARD_ALLOWLIST.has(req.path)) return next();
  const publicDir = path.join(__dirname, 'public');
  const filePath = path.join(publicDir, req.path);
  // Défense en profondeur : le chemin résolu doit rester sous public/
  if (!filePath.startsWith(publicDir + path.sep)) return next();
  _fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) {
      if (err.code === 'ENOENT') log.error({ filePath, code: err.code }, '[auth-guard] fichier introuvable');
      return next();
    }
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
const sharedCartRefundAdmin = require('./routes/shared-cart-refund-admin');
const sharedCartItemsService = require('./services/shared-cart-items-service');
const { authenticate } = require('./middleware/auth');

mountApiRoutesBeforeStripeOwnedBlocks(app);

// ═══ Panier Partagé MVP (Niveau 1) ═══
app.post('/api/shared-carts/stripe/webhook', sharedCart.stripeWebhookHandler);
// FIX B2 — l'ancien app.put('/api/shared-carts/:id/items') inline a été SUPPRIMÉ ici.
// Il masquait le handler complet du router (S2-06, avec notifs WhatsApp participants).
// Le handler canonique est dans routes/shared-cart.js — sharedCart.router le couvre.
app.use('/api/shared-carts',       sharedCart.router);
app.use('/api/admin/shared-carts', sharedCartRefundAdmin.router);
app.use('/api/admin/shared-carts', sharedCart.adminRouter);

// ═══ Panier Événement Collectif V1 — DÉMONTÉ ═══
// collective-workspaces.js est un tombstone 410 depuis 2026-05-26.
// Le module n'est plus chargé pour ne pas alourdir le démarrage.
// Les tables collective_* restent en DB (données historiques).
// Si un ancien client appelle ces routes → 404 (acceptable, le tombstone était déjà 410).
mountApiRoutesAfterStripeOwnedBlocks(app);


// ── Healthcheck ─────────────────────────────────────────────

app.get('/api/health', async (req, res) => {
  try {
    const start = Date.now();
    await db.query('SELECT 1');
    res.json({
      status:        'ok',
      version: require('./package.json').version,
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
    paypal_client_id:  process.env.PAYPAL_CLIENT_ID  || '',
    paypal_env:        process.env.PAYPAL_ENV        || 'sandbox',
    eur_kmf_rate:      Number(process.env.EUR_KMF_RATE)  || 492,
    aed_kmf_rate:      Number(process.env.AED_KMF_RATE)  || 138,
    whatsapp_number:   process.env.SUPPORT_WHATSAPP    || '',
    support_email:     process.env.SUPPORT_EMAIL       || '',
    env:               process.env.NODE_ENV || 'development',
  });
});

// ── HTML routes / SPA fallback ─────────────────────────────────────────────
const fs = require('fs');
log.info({ exists: fs.existsSync(path.join(__dirname, 'public/dashboards/admin/index.html')), dir: path.join(__dirname, 'public') }, '[boot] html-routes check');
mountHtmlRoutes(app, __dirname);

app.use(errorHandler);

// ── Operational crons ───────────────────────────────────────────────────────
// KOMERCE_DISABLE_CRONS=true : utile pour isoler un diagnostic (ex. fuite de
// pool DB) sans le bruit des crons catalogue/wallet en tâche de fond.
const { startOperationalCrons } = require('./bootstrap/crons');
if (process.env.KOMERCE_DISABLE_CRONS === 'true') {
  log.info('[boot-guard] Crons opérationnels désactivés (KOMERCE_DISABLE_CRONS=true)');
} else {
  startOperationalCrons();
}
const { runStartupMigrations } = require('./bootstrap/startup-migrations');

// ── Server lifecycle ────────────────────────────────────────────────────────
const { startServerLifecycle } = require('./bootstrap/server-lifecycle');
const httpServer = startServerLifecycle({
  app,
  db,
  walletService,
  routingService,
  parcelSecurity,
  runStartupMigrations,
  fixAdminHash,
  fixMissingSchema,
  runAllSeeds,
});
// Exposé pour les tests d'intégration qui font require('../../server') dans le
// même process (--runInBand) : sans ça, aucun moyen de libérer le port entre
// deux fichiers → EADDRINUSE :::3000 sur tous les fichiers suivants.
app.set('httpServer', httpServer);
module.exports = app;