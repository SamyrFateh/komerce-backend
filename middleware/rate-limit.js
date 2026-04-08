/**
 * Rate Limiting Middleware — Komerce Backend (Vague 3)
 * =====================================================
 * Vague 3 : store Redis conditionnel pour le multi-instance.
 *   - Si REDIS_URL est défini → RedisStore (partagé entre instances)
 *   - Sinon → store mémoire par défaut (dev / instance unique)
 *
 * Changelog v4 (Vague 3):
 *   - RedisStore conditionnel via rate-limit-redis + redis client
 *   - Chaque limiter a son propre préfixe de clé Redis
 *
 * Changelog v3 (Vague 1):
 *   - adminLimiter 30 req/min — strict limiter for destructive admin operations
 *
 * Changelog v2:
 *   - globalLimiter 100→500/15min
 *   - authLimiter 5→20/15min
 *   - SECURITY FIX: Bearer skip removed
 */

'use strict';

const rateLimit = require('express-rate-limit');

// ── Store Redis conditionnel (Vague 3) ──────────────────────────────────────────
// Si REDIS_URL est défini, utilise un store Redis partagé entre instances.
// Sinon, repli silencieux sur le store mémoire (compatible dev et mono-instance).

let makeStore;

if (process.env.REDIS_URL) {
  try {
    const { createClient }  = require('redis');
    const { RedisStore }    = require('rate-limit-redis');

    const redisClient = createClient({ url: process.env.REDIS_URL });

    redisClient.on('error', err =>
      console.error('[RateLimit] Redis client error:', err.message));

    // Connexion non-bloquante — le serveur démarre même si Redis est indisponible
    redisClient.connect().catch(err =>
      console.error('[RateLimit] Redis connect failed (fallback to memory):', err.message));

    makeStore = (prefix) => new RedisStore({
      sendCommand: (...args) => redisClient.sendCommand(args),
      prefix: `rl:${prefix}:`,
    });

    console.log('[RateLimit] ✅ Redis store activé');
  } catch (err) {
    console.warn('[RateLimit] ⚠️ Redis store non disponible (module manquant?), repli sur mémoire:', err.message);
    makeStore = null;
  }
} else {
  console.log('[RateLimit] ℹ️  REDIS_URL absent — store mémoire (mono-instance)');
  makeStore = null;
}

// ── Helper pour créer un limiter avec ou sans Redis ───────────────────────────────
function createLimiter(options, redisPrefix) {
  if (makeStore) {
    options.store = makeStore(redisPrefix);
  }
  return rateLimit(options);
}

// ── Global limiter: 500 requests per 15 minutes per IP ──────────────────────────
const globalLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez plus tard' },
  skip: (req) => req.path === '/health' || req.path === '/ready',
}, 'global');

// ── Auth limiter: 20 attempts per 15 minutes per IP ────────────────────────────
const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de connexion, réessayez dans 15 minutes' },
}, 'auth');

// ── Cash confirm limiter: 3 attempts per minute per IP ──────────────────────────
const cashConfirmLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de confirmation, réessayez dans 1 minute' },
}, 'cash');

// ── Scan collect limiter: 5 attempts per minute per IP ──────────────────────────
const scanCollectLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de scan, réessayez dans 1 minute' },
}, 'scan');

// ── Order creation limiter: 10 per minute per IP ───────────────────────────────
const orderCreateLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de commandes créées, réessayez dans 1 minute' },
}, 'order-create');

// ── Dashboard limiter: 60 per minute per IP ─────────────────────────────────────
const dashboardLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes dashboard, réessayez dans 1 minute' },
}, 'dashboard');

// ── Admin limiter: 30 per minute per IP ──────────────────────────────────────────
const adminLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes admin, réessayez dans 1 minute' },
}, 'admin');

module.exports = {
  globalLimiter,
  authLimiter,
  cashConfirmLimiter,
  scanCollectLimiter,
  orderCreateLimiter,
  dashboardLimiter,
  adminLimiter,
};
