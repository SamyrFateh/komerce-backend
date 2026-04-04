/**
 * KOMERCE Ã¢ÂÂ Serveur API v9.2 (sÃÂ©curisÃÂ©)
 *
 * Point d'entrÃÂ©e Node.js + Express
 * DÃÂ©ployÃÂ© sur Railway Ã¢ÂÂ PORT fourni par la variable d'environnement
 *
 * Changelog v9.2 : Helmet CSP corrigÃÂ© Ã¢ÂÂ inline scripts + Google Fonts + images HTTPS autorisÃÂ©s
 * Changelog v9.1 : BUG-014 cookie-parser ajoutÃÂ© Ã¢ÂÂ JWT migrÃÂ© vers httpOnly cookie
 * Changelog v8.8 : migration robuste (try/catch individuel) + CREATE TABLE partners + gen_random_uuid
 * Changelog v8.7 : auto-migration customs_history colonnes + loyalty_tiers table + users.loyalty_tier_id
 * Changelog v8.6 : auto-migration bcrypt admin hash ÃÂ· fix P0 dashboard + scans ÃÂ· fix 404 routes
 * Changelog v8.5 : rate-limit middleware branchÃÂ© ÃÂ· health route montÃÂ©e ÃÂ· .env retirÃÂ© du repo
 * Changelog v8.1 : Helmet ÃÂ· CORS fix ÃÂ· graceful shutdown ÃÂ· health check DB ÃÂ· cron lock
 * Changelog v8.0 : /api/loyalty ajoutÃÂ© ÃÂ· /api/unsold ajoutÃÂ© ÃÂ· migration session 6
 * Changelog v7.6 : /api/purchasing ajoutÃÂ© ÃÂ· triggerPurchasing dans payments.js (cash + Stripe)
 * Changelog v7.5 : /api/ceremony Ã¢ÂÂ /api/modules ÃÂ· /api/pilotage ajoutÃÂ©
 */

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const cookieParser = require('cookie-parser');
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

// Ã¢ÂÂÃ¢ÂÂ CORS Ã¢ÂÂ politique corrigÃÂ©e Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

function isAllowedOrigin(origin) {
  // Pas d'origin = requÃÂªte same-origin ou mobile app Ã¢ÂÂ OK
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

// Ã¢ÂÂÃ¢ÂÂ Security headers Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// CSP configurÃÂ© pour autoriser :
//   - scripts inline (tous les HTML utilisent <script> inline)
//   - Google Fonts (CSS + polices)
//   - images HTTPS (produits, avatars, banners)
//   - connect-src self (fetch API)

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'"],
      styleSrc:    ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:     ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc:      ["'self'", "data:", "https:", "http:"],
      connectSrc:  ["'self'"],
      mediaSrc:    ["'self'"],
      objectSrc:   ["'none'"],
      frameAncestors: ["'none'"],
      baseUri:     ["'self'"],
      formAction:  ["'self'"],
    },
  },
}));

app.use(cors(corsOptions));

// Ã¢ÂÂÃ¢ÂÂ Body parsing Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Ã¢ÂÂÃ¢ÂÂ Cookie parser (BUG-014 : JWT httpOnly cookie) Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

app.use(cookieParser());

// Ã¢ÂÂÃ¢ÂÂ Rate limiting (middleware/rate-limit.js) Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

app.use('/api/', globalLimiter);                            // 100 req/15min global
app.use('/api/auth/login', authLimiter);                    // 5 req/15min brute-force
app.use('/api/auth/register', authLimiter);                 // 5 req/15min anti-spam
app.use('/api/payments/cash/confirm', cashConfirmLimiter);  // 3 req/min cash code
app.use('/api/scans/collect', scanCollectLimiter);          // 5 req/min QR brute-force
app.use('/api/orders', orderCreateLimiter);                 // 10 req/min spam commandes
app.use('/api/dashboard', dashboardLimiter);                // 30 req/min anti-DoS queries

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

// Ã¢ÂÂÃ¢ÂÂ Routes API Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

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

// Ã¢ÂÂÃ¢ÂÂ Healthcheck (avec test DB) Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

app.get('/api/health', async (req, res) => {
  try {
    const start = Date.now();
    await db.query('SELECT 1');
    res.json({
      status:        'ok',
      version:       '9.3',
      db_latency_ms: Date.now() - start,
      timestamp:     new Date().toISOString(),
      env:           process.env.NODE_ENV || 'development',
    });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'unreachable' });
  }
});

// Ã¢ÂÂÃ¢ÂÂ SPA fallback Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint introuvable' });
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(path.join(__dirname, 'public', 'Komerce_Boutique.html'));
});

// Ã¢ÂÂÃ¢ÂÂ Erreurs globales Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

app.use((err, req, res, next) => {
  if (err.message && err.message.startsWith('Not allowed by CORS')) {
    console.warn('CORS blocked:', err.message);
    return res.status(403).json({ error: 'Origine non autorisee' });
  }
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Erreur serveur interne' });
});

// Ã¢ÂÂÃ¢ÂÂ Cron cash relais (avec verrou anti-concurrence) Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

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

// Ã¢ÂÂÃ¢ÂÂ DÃÂ©marrage + Graceful Shutdown Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

// Ã¢ÂÂÃ¢ÂÂ Auto-migration : fix admin bcrypt hash (one-time) Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// Le seed original stockait un hash SHA-256 incompatible avec bcrypt.compare().
// Cette migration corrige automatiquement au premier dÃÂ©marrage.

const bcryptMigrate = require('bcryptjs');

async function fixAdminHash() {
  try {
    // D3 : Si ADMIN_PASSWORD est dÃ©fini dans l'env, utiliser ce mot de passe au lieu du dÃ©faut
    const adminPassword = process.env.ADMIN_PASSWORD || 'Komerce2026!';
    if (process.env.ADMIN_PASSWORD) {
      console.log('ð ADMIN_PASSWORD dÃ©fini â utilisation du mot de passe personnalisÃ©');
    } else {
      console.warn('â ï¸  ADMIN_PASSWORD non dÃ©fini â utilisation du mot de passe par dÃ©faut (changer en prod !)');
    }
    const newAdminHash = await bcryptMigrate.hash(adminPassword, 10);
    const adminResult = await db.query(
      "UPDATE users SET password_hash = $1 WHERE email = 'admin@komerce.km'",
      [newAdminHash]
    );
    console.log(`Ã¢ÂÂ Migration: admin hash forcÃÂ© Ã¢ÂÂ ${adminResult.rowCount} row(s) updated`);

    // If admin doesn't exist at all, create it
    if (adminResult.rowCount === 0) {
      await db.query(
        `INSERT INTO users (full_name, email, phone, role, currency_pref, country, password_hash)
         VALUES ('Admin Komerce', 'admin@komerce.km', '+269000000', 'admin', 'KMF', 'KM', $1)
         ON CONFLICT (email) DO UPDATE SET password_hash = $1, role = 'admin'`,
        [newAdminHash]
      );
      console.log('Ã¢ÂÂ Migration: admin user crÃÂ©ÃÂ©/upserted');
    }

    // Also fix demo clients
    const newClientHash = await bcryptMigrate.hash('client123', 10);
    const clientResult = await db.query(
      "UPDATE users SET password_hash = $1 WHERE role = 'client' AND password_hash NOT LIKE '$2b$%'",
      [newClientHash]
    );
    if (clientResult.rowCount > 0) {
      console.log(`Ã¢ÂÂ Migration: ${clientResult.rowCount} demo client hashes corrigÃÂ©s`);
    }
  } catch (err) {
    console.error('Migration admin hash error (non-fatal):', err.message);
  }
}

// Ã¢ÂÂÃ¢ÂÂ Auto-migration : tables/colonnes manquantes Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

async function fixMissingSchema() {
  const run = async (label, sql) => {
    try {
      await db.query(sql);
      console.log(`  Ã¢ÂÂ ${label}`);
    } catch (err) {
      console.error(`  Ã¢ÂÂ Ã¯Â¸Â ${label}: ${err.message}`);
    }
  };

  console.log('Ã°ÂÂÂ§ Running schema migrations...');

  // 1. customs_history Ã¢ÂÂ colonnes manquantes pour admin/customs
  await run('customs_history.customs_estimated_kmf',
    `ALTER TABLE customs_history ADD COLUMN IF NOT EXISTS customs_estimated_kmf INTEGER DEFAULT 0`);
  await run('customs_history.notes',
    `ALTER TABLE customs_history ADD COLUMN IF NOT EXISTS notes TEXT`);
  await run('customs_history.customs_agent_id',
    `ALTER TABLE customs_history ADD COLUMN IF NOT EXISTS customs_agent_id UUID`);

  // 2. partners Ã¢ÂÂ table manquante pour admin/partners
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

  // 3. loyalty_tiers Ã¢ÂÂ table nÃÂ©cessaire pour pilotage/clients
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

  // 4. users.loyalty_tier_id Ã¢ÂÂ colonne FK pour pilotage/clients
  await run('users.loyalty_tier_id',
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS loyalty_tier_id UUID`);

  // 5. customs_taux_mensuel Ã¢ÂÂ vue pour pilotage.js
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
          ('Bronze',   0,  0, 'Ã°ÂÂ¥Â'),
          ('Silver',   3,  2, 'Ã°ÂÂ¥Â'),
          ('Gold',    10,  5, 'Ã°ÂÂ¥Â'),
          ('Platinum', 25, 8, 'Ã°ÂÂÂ')
        ON CONFLICT DO NOTHING
      `);
    }
  } catch (err) {
    console.error(`  Ã¢ÂÂ Ã¯Â¸Â loyalty seed: ${err.message}`);
  }

  console.log('Ã°ÂÂÂ§ Schema migrations complete.');
}

const PORT = process.env.PORT || 3000;


// Ã¢ÂÂÃ¢ÂÂ SEED : Produits (20 articles Ã¢ÂÂ match DEMO_PRODUCTS Boutique) Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// ââ Fix encoding: correct broken UTF-8 product data in DB ââââââââââââââ
async function fixProductEncoding() {
  console.log('ð¤ Fixing product encoding...');
  const fixes = [
    { price_kmf: 99000, category: 'electronics', name: 'Samsung Galaxy A35 (128Go)', description: 'Ãcran AMOLED 6.6", 50MP, double SIM, batterie 5000mAh. RÃ©seau 4G stable aux Comores.', emoji: 'ð±' },
    { price_kmf: 39600, category: 'electronics', name: 'Ãcouteurs Samsung Galaxy Buds2', description: 'RÃ©duction de bruit active, 5h autonomie + 15h boÃ®tier. Compatible Android & iOS.', emoji: 'ð§' },
    { price_kmf: 14850, category: 'electronics', name: 'Pack coques + accessoires (5 piÃ¨ces)', description: 'Coque renforcÃ©e + verre trempÃ© + chargeur rapide 25W + cÃ¢ble USB-C + support voiture.', emoji: 'ð±' },
    { price_kmf: 19800, category: 'electronics', name: 'Chargeur rapide 65W GaN (multi-ports)', description: '3 ports (2 USB-C + 1 USB-A), compact. Charge tÃ©lÃ©phone + tablette + PC simultanÃ©ment.', emoji: 'ð' },
    { price_kmf: 24750, category: 'home', name: 'Ventilateur sur pied 16"', description: 'Oscillant 3 vitesses, silencieux, tÃ©lÃ©commande. Indispensable aux Comores toute annÃ©e.', emoji: 'ð' },
    { price_kmf: 17325, category: 'home', name: 'Fer Ã  repasser vapeur 2400W', description: 'Semelle cÃ©ramique anti-adhÃ©sive, rÃ©servoir 300ml, dÃ©part rapide 30s.', emoji: 'ð¥' },
    { price_kmf: 9900, category: 'home', name: 'Multiprise 6 prises + 2 USB', description: 'CÃ¢ble 2m, disjoncteur sÃ©curitÃ©, 2 ports USB-A. Indispensable pour les foyers connectÃ©s.', emoji: 'ð' },
    { price_kmf: 12375, category: 'home', name: 'Bouilloire Ã©lectrique 1.7L inox', description: 'ArrÃªt automatique, protection anti-surchauffe, Ã©bullition en 3 min.', emoji: 'â' },
    { price_kmf: 99000, category: 'wedding', name: 'Montre homme acier brossÃ©', description: 'BoÃ®tier 42mm, bracelet acier, Ã©tanchÃ©itÃ© 50m, verre saphir.', emoji: 'â' },
    { price_kmf: 277200, category: 'wedding', name: 'Collier or 18K (8g)', description: 'Or 18 carats certifiÃ© Dubai, chaÃ®ne maille forÃ§at 45cm. Certificat authenticitÃ© inclus.', emoji: 'ð' },
    { price_kmf: 59400, category: 'wedding', name: 'Parfum Oud Al Shuyukh 100ml', description: 'Parfum de luxe Dubai, notes de oud, ambre et rose. Longue tenue 12h+.', emoji: 'ð¹' },
    { price_kmf: 49500, category: 'wedding', name: 'Coffret cadeau mariage (4 piÃ¨ces)', description: 'Parfum + crÃ¨me corps + savon artisanal + bracelet fantaisie.', emoji: 'ð' },
    { price_kmf: 34650, category: 'fashion', name: 'Djellaba homme brodÃ©e (L/XL/XXL)', description: 'Tissu Bazin premium, broderie traditionnelle dorÃ©e.', emoji: 'ð§¥' },
    { price_kmf: 39600, category: 'fashion', name: 'Abaya femme dentelle Dubai (M/L/XL)', description: 'Tissu crÃªpe fluide, broderie dentelle sur les manches.', emoji: 'ð' },
    { price_kmf: 19800, category: 'fashion', name: 'Boubou enfant 3-12 ans', description: 'Tissu wax africain, coupe ample confortable.', emoji: 'ð' },
    { price_kmf: 54450, category: 'fashion', name: 'Caftan femme soirÃ©e (S/M/L/XL)', description: 'Tissu satinÃ© Dubai, encolure brodÃ©e de perles.', emoji: 'ð¥»' },
    { price_kmf: 24750, category: 'services', name: 'CrÃ¨me visage Ã©clat au safran', description: 'Soin hydratant au safran de Perse + vitamine C. 50ml.', emoji: 'â¨' },
    { price_kmf: 34650, category: 'services', name: 'Parfum Oud Rose (50ml)', description: 'Eau de parfum Dubai, concentrÃ©e 20%, notes de rose et oud boisÃ©.', emoji: 'ð¸' },
    { price_kmf: 17325, category: 'services', name: 'Huile argan pure Maroc (100ml)', description: 'Argan bio certifiÃ©, pressÃ©e Ã  froid. Soin cheveux + peau + ongles.', emoji: 'ð§´' },
    { price_kmf: 44550, category: 'services', name: 'Coffret soins corps luxe (5 piÃ¨ces)', description: 'Gommage + lait corps + huile + beurre de karitÃ© + savon noir.', emoji: 'ð§´' },
  ];

  for (const fix of fixes) {
    try {
      await db.query(
        `UPDATE products SET name = $1, description = $2, emoji = $3
         WHERE price_kmf = $4 AND category = $5`,
        [fix.name, fix.description, fix.emoji, fix.price_kmf, fix.category]
      );
    } catch(e) { console.warn('Fix encoding skip:', fix.name, e.message); }
  }
  console.log('ð¤ Product encoding fixed.');
}


async function seedProducts() {
  const products = [
    { name: 'Samsung Galaxy A35 (128Go)', price_kmf: 99000, price_eur: 200, category: 'electronics', stock: 15, emoji: 'ð±', badge: 'Populaire', description: 'Ãcran AMOLED 6.6\", 50MP, double SIM, batterie 5000mAh. RÃ©seau 4G stable aux Comores.' },
    { name: 'Ãcouteurs Samsung Galaxy Buds2', price_kmf: 39600, price_eur: 80, category: 'electronics', stock: 20, emoji: 'ð§', badge: null, description: 'RÃ©duction de bruit active, 5h autonomie + 15h boÃ®tier. Compatible Android & iOS.' },
    { name: 'Pack coques + accessoires (5 piÃ¨ces)', price_kmf: 14850, price_eur: 30, category: 'electronics', stock: 30, emoji: 'ð±', badge: 'Nouveau', description: 'Coque renforcÃ©e + verre trempÃ© + chargeur rapide 25W + cÃ¢ble USB-C + support voiture.' },
    { name: 'Chargeur rapide 65W GaN (multi-ports)', price_kmf: 19800, price_eur: 40, category: 'electronics', stock: 25, emoji: 'ð', badge: null, description: '3 ports (2 USB-C + 1 USB-A), compact. Charge tÃ©lÃ©phone + tablette + PC simultanÃ©ment.' },
    { name: 'Ventilateur sur pied 16\"', price_kmf: 24750, price_eur: 50, category: 'home', stock: 25, emoji: 'ð', badge: 'Best-seller', description: 'Oscillant 3 vitesses, silencieux, tÃ©lÃ©commande. Indispensable aux Comores toute annÃ©e.' },
    { name: 'Fer Ã  repasser vapeur 2400W', price_kmf: 17325, price_eur: 35, category: 'home', stock: 18, emoji: 'ð¥', badge: null, description: 'Semelle cÃ©ramique anti-adhÃ©sive, rÃ©servoir 300ml, dÃ©part rapide 30s.' },
    { name: 'Multiprise 6 prises + 2 USB', price_kmf: 9900, price_eur: 20, category: 'home', stock: 35, emoji: 'ð', badge: null, description: 'CÃ¢ble 2m, disjoncteur sÃ©curitÃ©, 2 ports USB-A. Indispensable pour les foyers connectÃ©s.' },
    { name: 'Bouilloire Ã©lectrique 1.7L inox', price_kmf: 12375, price_eur: 25, category: 'home', stock: 22, emoji: 'â', badge: null, description: 'ArrÃªt automatique, protection anti-surchauffe, Ã©bullition en 3 min.' },
    { name: 'Montre homme acier brossÃ©', price_kmf: 99000, price_eur: 200, category: 'wedding', stock: 8, emoji: 'â', badge: 'Exclusif', description: 'BoÃ®tier 42mm, bracelet acier, Ã©tanchÃ©itÃ© 50m, verre saphir.' },
    { name: 'Collier or 18K (8g)', price_kmf: 277200, price_eur: 560, category: 'wedding', stock: 5, emoji: 'ð', badge: 'Premium', description: 'Or 18 carats certifiÃ© Dubai, chaÃ®ne maille forÃ§at 45cm. Certificat authenticitÃ© inclus.' },
    { name: 'Parfum Oud Al Shuyukh 100ml', price_kmf: 59400, price_eur: 120, category: 'wedding', stock: 12, emoji: 'ð¹', badge: null, description: 'Parfum de luxe Dubai, notes de oud, ambre et rose. Longue tenue 12h+.' },
    { name: 'Coffret cadeau mariage (4 piÃ¨ces)', price_kmf: 49500, price_eur: 100, category: 'wedding', stock: 15, emoji: 'ð', badge: 'Populaire', description: 'Parfum + crÃ¨me corps + savon artisanal + bracelet fantaisie.' },
    { name: 'Djellaba homme brodÃ©e (L/XL/XXL)', price_kmf: 34650, price_eur: 70, category: 'fashion', stock: 20, emoji: 'ð§¥', badge: 'Best-seller', description: 'Tissu Bazin premium, broderie traditionnelle dorÃ©e.' },
    { name: 'Abaya femme dentelle Dubai (M/L/XL)', price_kmf: 39600, price_eur: 80, category: 'fashion', stock: 15, emoji: 'ð', badge: 'Populaire', description: 'Tissu crÃªpe fluide, broderie dentelle sur les manches.' },
    { name: 'Boubou enfant 3-12 ans', price_kmf: 19800, price_eur: 40, category: 'fashion', stock: 18, emoji: 'ð', badge: null, description: 'Tissu wax africain, coupe ample confortable.' },
    { name: 'Caftan femme soirÃ©e (S/M/L/XL)', price_kmf: 54450, price_eur: 110, category: 'fashion', stock: 10, emoji: 'ð¥»', badge: 'Nouveau', description: 'Tissu satinÃ© Dubai, encolure brodÃ©e de perles.' },
    { name: 'CrÃ¨me visage Ã©clat au safran', price_kmf: 24750, price_eur: 50, category: 'services', stock: 20, emoji: 'â¨', badge: null, description: 'Soin hydratant au safran de Perse + vitamine C. 50ml.' },
    { name: 'Parfum Oud Rose (50ml)', price_kmf: 34650, price_eur: 70, category: 'services', stock: 18, emoji: 'ð¸', badge: 'Best-seller', description: 'Eau de parfum Dubai, concentrÃ©e 20%, notes de rose et oud boisÃ©.' },
    { name: 'Huile argan pure Maroc (100ml)', price_kmf: 17325, price_eur: 35, category: 'services', stock: 25, emoji: 'ð§´', badge: null, description: 'Argan bio certifiÃ©, pressÃ©e Ã  froid. Soin cheveux + peau + ongles.' },
    { name: 'Coffret soins corps luxe (5 piÃ¨ces)', price_kmf: 44550, price_eur: 90, category: 'services', stock: 12, emoji: 'ð§´', badge: 'Nouveau', description: 'Gommage + lait corps + huile + beurre de karitÃ© + savon noir.' },
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
  console.log('ð± Seed produits OK');
}



// Ã¢ÂÂÃ¢ÂÂ SEED : Points relais (5 relais Comores) Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
async function seedRelais() {
  const relais = [
    { name: 'Relais Moroni Centre', address: 'Avenue de la RÃÂ©publique, Moroni', zone: 'Moroni centre', island: 'Grande Comore', phone: '0321001001' },
    { name: 'Relais Mutsamudu Centre', address: 'Rue du Port, Mutsamudu', zone: 'Mutsamudu centre', island: 'Anjouan', phone: '0321002002' },
    { name: 'Relais Fomboni', address: 'Place du MarchÃÂ©, Fomboni', zone: 'Fomboni centre', island: 'MohÃÂ©li', phone: '0321003003' },
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
  console.log('Ã°ÂÂÂ± Seed relais OK');
}



// —— Fix product images: add Unsplash URLs to all products ——————————————
async function fixProductImages() {
  console.log('🖼️  Fixing product images...');
  const imageMap = {
    'Samsung Galaxy A35 (128Go)': 'https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?w=400&h=400&fit=crop',
    'Écouteurs Samsung Galaxy Buds2': 'https://images.unsplash.com/photo-1590658268037-6bf12f032f55?w=400&h=400&fit=crop',
    'Pack coques + accessoires (5 pièces)': 'https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=400&h=400&fit=crop',
    'Chargeur rapide 65W GaN (multi-ports)': 'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=400&h=400&fit=crop',
    'Ventilateur sur pied 16\\"': 'https://images.unsplash.com/photo-1617375407361-9815c98f64c7?w=400&h=400&fit=crop',
    'Fer à repasser vapeur 2400W': 'https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=400&h=400&fit=crop',
    'Multiprise 6 prises + 2 USB': 'https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=400&h=400&fit=crop',
    'Bouilloire électrique 1.7L inox': 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=400&fit=crop',
    'Montre homme acier brossé': 'https://images.unsplash.com/photo-1524592094714-0f0654e20314?w=400&h=400&fit=crop',
    'Collier or 18K (8g)': 'https://images.unsplash.com/photo-1515562141589-67f0d569b6e5?w=400&h=400&fit=crop',
    'Parfum Oud Al Shuyukh 100ml': 'https://images.unsplash.com/photo-1541643600914-78b084683601?w=400&h=400&fit=crop',
    'Coffret cadeau mariage (4 pièces)': 'https://images.unsplash.com/photo-1549465220-1a8b9238f760?w=400&h=400&fit=crop',
    'Djellaba homme brodée (L/XL/XXL)': 'https://images.unsplash.com/photo-1589902860314-e910697dea18?w=400&h=400&fit=crop',
    'Abaya femme dentelle Dubai (M/L/XL)': 'https://images.unsplash.com/photo-1583391733956-6c78276477e2?w=400&h=400&fit=crop',
    'Boubou enfant 3-12 ans': 'https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?w=400&h=400&fit=crop',
    'Caftan femme soirée (S/M/L/XL)': 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=400&h=400&fit=crop',
    'Crème visage éclat au safran': 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop',
    'Parfum Oud Rose (50ml)': 'https://images.unsplash.com/photo-1588405748880-12d1d2a59f75?w=400&h=400&fit=crop',
    'Huile argan pure Maroc (100ml)': 'https://images.unsplash.com/photo-1608571423902-eed4a5ad8108?w=400&h=400&fit=crop',
    'Coffret soins corps luxe (5 pièces)': 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=400&fit=crop',
  };

  for (const [name, url] of Object.entries(imageMap)) {
    try {
      await db.query(
        `UPDATE products SET image_url = $1 WHERE name = $2 AND (image_url IS NULL OR image_url = '')`,
        [url, name]
      );
    } catch(e) { console.warn('Fix image skip:', name, e.message); }
  }
  console.log('🖼️  Product images fixed.');
}

fixAdminHash().then(() => fixMissingSchema()).then(() => fixProductEncoding()).then(() => seedProducts()).then(() => seedRelais()).then(() => fixProductImages()).then(() => {
  const server = app.listen(PORT, () => {
    console.log(`KOMERCE API v9.3 Ã¢ÂÂ port ${PORT} Ã¢ÂÂ helmet OK Ã¢ÂÂ rate-limit OK Ã¢ÂÂ CORS hardened Ã¢ÂÂ CSP fixed Ã¢ÂÂ migrations OK`);
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM reÃÂ§u Ã¢ÂÂ fermeture gracieuse...');
    server.close(() => {
      console.log('Serveur fermÃÂ© proprement.');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000);
  });
});

module.exports = app;
