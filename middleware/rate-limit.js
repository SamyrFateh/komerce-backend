/**
 * Rate Limiting Middleware — Komerce Backend
 * ============================================
 * P0 FIX: Zero rate limiting was identified as a critical vulnerability.
 *
 * Changelog v2:
 *   - globalLimiter 100→500/15min (pages dashboard internes font 5-8 appels/chargement)
 *   - authLimiter 5→20/15min (évite lockouts pendant tests)
 *   - globalLimiter skip si JWT Authorization présent (utilisateurs authentifiés légitimes)
 */

const rateLimit = require('express-rate-limit');

// ─── Global limiter: 500 requests per 15 minutes per IP ───
// Augmenté car les pages dashboard (Relais, Hub, Admin) font 5-8 appels API
// par chargement + auto-refresh toutes les 15-30s = ~20 req/min légitimes
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez plus tard' },
  skip: (req) => {
    // Skip pour health checks
    if (req.path === '/health' || req.path === '/ready') return true;
    // Skip pour utilisateurs authentifiés (JWT présent)
    // Les utilisateurs connectés sont des agents internes légitimes
    const auth = req.headers['authorization'];
    if (auth && auth.startsWith('Bearer ')) return true;
    return false;
  },
});

// ─── Auth limiter: 20 attempts per 15 minutes per IP ───
// Protège contre le brute-force login, mais évite les lockouts en dev/test
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de connexion, réessayez dans 15 minutes' },
});

// ─── Cash confirm limiter: 3 attempts per minute per IP ───
// CRITICAL: cash_ref_code a un espace limité, doit empêcher le brute-force
const cashConfirmLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de confirmation, réessayez dans 1 minute' },
});

// ─── Scan collect limiter: 5 attempts per minute per IP ───
// Protège contre le brute-forcing des QR codes
const scanCollectLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de scan, réessayez dans 1 minute' },
});

// ─── Order creation limiter: 10 per minute per IP ───
// Empêche le spam de création de commandes (appliqué POST only dans server.js)
const orderCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de commandes créées, réessayez dans 1 minute' },
});

// ─── Dashboard limiter: 60 per minute per IP ───
// Anti-DoS sur les requêtes lourdes, augmenté pour auto-refresh légitimes
const dashboardLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes dashboard, réessayez dans 1 minute' },
  skip: (req) => {
    const auth = req.headers['authorization'];
    return auth && auth.startsWith('Bearer ');
  },
});

module.exports = {
  globalLimiter,
  authLimiter,
  cashConfirmLimiter,
  scanCollectLimiter,
  orderCreateLimiter,
  dashboardLimiter,
};
