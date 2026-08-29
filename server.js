/**
 * @komerce-arch
 * @role          api-server-entrypoint
 * @domain        bootstrap
 * @layer         entrypoint
 * @criticality   critical
 * @inputs        http_requests, env_vars, raw_webhooks, static_assets
 * @outputs       mounted_api, boutique_static, crons, server_lifecycle
 * @depends       bootstrap/env.js, bootstrap/security.js, bootstrap/api-routes.js, bootstrap/html-routes.js, bootstrap/crons.js, bootstrap/feature-wiring.js, routes/shared-cart.js, middleware/csrf-origin.js
 * @db-write      none
 * @db-read      currency_parities
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
const { csrfOriginGuard } = require('./middleware/csrf-origin');

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
// PayPal webhook — raw body avant express.json (I-07). Migration 079.
app.use('/api/payments/paypal/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
// AUTH-8b — SameSite=Lax reste compatible WhatsApp ; les mutations portées
// par le cookie de session doivent en plus venir d'une Origin autorisée.
app.use(csrfOriginGuard);
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
const { authenticate } = require('./middleware/auth');

mountApiRoutesBeforeStripeOwnedBlocks(app);

// ═══ Panier Partagé (Boutique First, domaine minimal — migration 124) ═══
// Plus de webhook Stripe ni de paiement groupé propre à la liste : chaque
// participant réclame un article en achetant individuellement via
// POST /api/orders (migration 123). sharedCart.router/.adminRouter
// couvrent tout le domaine réduit (open/closed/cancelled).
app.use('/api/shared-carts',       sharedCart.router);
app.use('/api/admin/shared-carts', sharedCart.adminRouter);

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
// currency_parities (P1, source unique) exposée en totalité — pas un seul
// scalaire — pour que l'adapter client (P2, b-utils.js) puisse projeter
// KMF vers N'IMPORTE quelle devise de marché (XAF, EUR...) sans round-trip
// supplémentaire. Toujours dérivé via EUR côté client, jamais un axe
// direct KMF-XAF (invariant 9) — le client reproduit exactement la même
// formule que utils/currency.js#projectAmount(), sur les mêmes lignes DB.
app.get('/api/public/config', async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  let currency_parities = [];
  try {
    const { rows } = await db.query(
      `SELECT currency, eur_rate FROM currency_parities ORDER BY currency`
    );
    currency_parities = rows.map(r => ({ currency: r.currency, eur_rate: Number(r.eur_rate) }));
  } catch (e) {
    log.warn({ err: e.message }, '[public-config] currency_parities indisponible, table vide renvoyée');
  }
  res.json({
    stripe_public_key: process.env.STRIPE_PUBLIC_KEY || process.env.STRIPE_PK || '',
    paypal_client_id:  process.env.PAYPAL_CLIENT_ID  || '',
    paypal_env:        process.env.PAYPAL_ENV        || 'sandbox',
    currency_parities,
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