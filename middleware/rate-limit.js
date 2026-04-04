/**
 * Rate Limiting Middleware — Komerce Backend
 * ============================================
 * P0 FIX: Zero rate limiting was identified as a critical vulnerability.
 *
 * Usage in server.js:
 *   const { globalLimiter, authLimiter, cashConfirmLimiter, scanCollectLimiter, orderCreateLimiter } = require('./middleware/rate-limit');
 *   app.use(globalLimiter);
 *   app.use('/api/auth/login', authLimiter);
 *   app.use('/api/auth/register', authLimiter);
 *   app.use('/api/payments/cash/confirm', cashConfirmLimiter);
 *   app.use('/api/scans/collect', scanCollectLimiter);
 *   app.use('/api/orders', orderCreateLimiter);  // POST only, but applied globally is fine
 *
 * Requires: npm install express-rate-limit
 */

const rateLimit = require('express-rate-limit');

// ─── Global limiter: 100 requests per 15 minutes per IP ───
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez plus tard' },
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health' || req.path === '/ready';
  },
});

// ─── Auth limiter: 5 attempts per 15 minutes per IP ───
// Protects against brute-force login attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de connexion, réessayez dans 15 minutes' },
});

// ─── Cash confirm limiter: 3 attempts per minute per IP ───
// CRITICAL: cash_ref_code has limited keyspace, must prevent brute-force
const cashConfirmLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de confirmation, réessayez dans 1 minute' },
});

// ─── Scan collect limiter: 5 attempts per minute per IP ───
// Protects against QR code brute-forcing
const scanCollectLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de scan, réessayez dans 1 minute' },
});

// ─── Order creation limiter: 10 per minute per IP ───
// Prevents spam order creation
const orderCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de commandes créées, réessayez dans 1 minute' },
});

// ─── Dashboard limiter: 30 per minute per IP ───
// Prevents DoS on heavy dashboard queries
const dashboardLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes dashboard, réessayez dans 1 minute' },
});

module.exports = {
  globalLimiter,
  authLimiter,
  cashConfirmLimiter,
  scanCollectLimiter,
  orderCreateLimiter,
  dashboardLimiter,
};
