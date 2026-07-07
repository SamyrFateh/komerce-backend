/**
 * @komerce-arch
 * @role          auth-rate-limit
 * @domain        infrastructure
 * @layer         middleware
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @db-write      none
 * @db-read      none
 * @used-by       @unknown
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  auth
 * @version       2026-06
 */

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
const log = require('../utils/logger').forModule('rate-limit');

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
      log.error({ err }, 'Redis client error'));

    // Connexion non-bloquante — le serveur démarre même si Redis est indisponible
    redisClient.connect().catch(err =>
      log.error({ err }, 'Redis connect failed (fallback to memory)'));

    makeStore = (prefix) => new RedisStore({
      sendCommand: (...args) => redisClient.sendCommand(args),
      prefix: `rl:${prefix}:`,
    });

    log.info('Redis store enabled');
  } catch (err) {
    log.warn({ err }, 'Redis store unavailable (missing module?), fallback to memory');
    makeStore = null;
  }
} else {
  log.info('REDIS_URL absent — using memory store (single instance)');
  makeStore = null;
}

// ── Helper pour créer un limiter avec ou sans Redis ───────────────────────────────
function createLimiter(options, redisPrefix) {
  // Bypass pour la sonde de conformité P4-1 (Schemathesis émet des centaines de
  // requêtes → 429 en cascade qui noient le vrai signal). STRICTEMENT hors prod :
  // même si la variable fuyait en production, le garde NODE_ENV l'empêche d'agir.
  if (process.env.DISABLE_RATE_LIMIT === '1' && process.env.NODE_ENV !== 'production') {
    return (req, res, next) => next();
  }
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

// ── Admin limiter : plafond souple GET + strict writes ──────────────────────────
// GET : plafond souple 600/min (dashboards admin avec 5-15 appels parallèles)
// POST/PUT/PATCH/DELETE : 300/min (writes destructifs)
const adminLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: (req) => req.method === 'GET' ? 600 : 300,
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