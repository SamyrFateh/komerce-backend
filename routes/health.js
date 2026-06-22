/**
 * @komerce-arch
 * @role          health
 * @domain        operations
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       orders, parcels
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  operations
 * @version       2026-06
 */

/**
 * KOMERCE — Health Check + Metrics Endpoints (V3.2 enhanced)
 *
 * GET /health         — Basic health check (DB connectivity + latency)
 * GET /health/ready   — Readiness check
 * GET /health/metrics — Full metrics dashboard (admin only)
 *
 * Enhanced from P2 FIX #19 with monitoring integration.
 */

'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { getMetrics } = require('../services/monitoring');
const { authenticate, requireRole } = require('../middleware/auth');

// ── GET /health — Basic health ──────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const start = Date.now();
    await db.query('SELECT 1');
    const dbLatency = Date.now() - start;

    res.json({
      status: 'ok',
      db: 'connected',
      db_latency_ms: dbLatency,
      uptime_s: Math.floor(process.uptime()),
      version: process.env.npm_package_version || 'unknown',
      node_env: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      db: 'disconnected',
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// ── GET /health/ready — Readiness ───────────────────────────────────────────

router.get('/ready', async (req, res, next) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'not_ready' });
  }
});

// ── GET /health/metrics — Full metrics (admin only) ─────────────────────────

router.get('/metrics', authenticate, requireRole(['admin']), async (req, res, next) => {
  try {
    const appMetrics = getMetrics();

    // Add DB pool stats if available
    let poolStats = null;
    if (db.pool) {
      poolStats = {
        total: db.pool.totalCount,
        idle: db.pool.idleCount,
        waiting: db.pool.waitingCount,
      };
    }

    // Active orders count
    const { rows: [orderStats] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status NOT IN ('collected', 'cancelled')) AS active_orders,
        COUNT(*) FILTER (WHERE status = 'confirmed' AND payment_mode = 'cash_relais' AND payment_status = 'pending') AS pending_cash,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS orders_24h
      FROM orders
    `);

    // Parcel stats
    const { rows: [parcelStats] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status NOT IN ('collected', 'cancelled')) AS active_parcels,
        COUNT(*) FILTER (WHERE status = 'in_transit') AS in_transit,
        COUNT(*) FILTER (WHERE type = 'backorder' AND status NOT IN ('collected', 'cancelled')) AS backorders
      FROM parcels
    `);

    res.json({
      app: appMetrics,
      db_pool: poolStats,
      business: {
        orders: orderStats,
        parcels: parcelStats,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /health/detailed — Dépendances externes (admin only) ────────────────
// AUD-02 : Redis (optionnel), Stripe, PayPal — probe non-bloquante

async function _probeRedis() {
  if (!process.env.REDIS_URL) return { status: 'disabled', reason: 'REDIS_URL absent' };
  try {
    const { createClient } = require('redis');
    const client = createClient({ url: process.env.REDIS_URL });
    await client.connect();
    const start = Date.now();
    await client.ping();
    const latency = Date.now() - start;
    await client.disconnect();
    return { status: 'ok', latency_ms: latency };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

async function _probeStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return { status: 'disabled', reason: 'STRIPE_SECRET_KEY absent' };
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const start = Date.now();
    await stripe.balance.retrieve();
    return { status: 'ok', latency_ms: Date.now() - start };
  } catch (err) {
    // Stripe retourne une erreur structurée : on masque le détail
    return { status: 'error', error: err.type || 'stripe_error' };
  }
}

async function _probePaypal() {
  const id     = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) return { status: 'disabled', reason: 'PAYPAL_CLIENT_ID/SECRET absent' };
  try {
    const base = (process.env.PAYPAL_ENV === 'production')
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';
    const basic = Buffer.from(`${id}:${secret}`).toString('base64');
    const start = Date.now();
    const res = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const latency = Date.now() - start;
    if (!res.ok) return { status: 'error', http_status: res.status };
    return { status: 'ok', latency_ms: latency };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

router.get('/detailed', authenticate, requireRole(['admin']), async (req, res, next) => {
  try {
    const [dbResult, redisResult, stripeResult, paypalResult] = await Promise.allSettled([
      (async () => {
        const start = Date.now();
        await db.query('SELECT 1');
        return { status: 'ok', latency_ms: Date.now() - start };
      })(),
      _probeRedis(),
      _probeStripe(),
      _probePaypal(),
    ]);

    const deps = {
      db:     dbResult.status     === 'fulfilled' ? dbResult.value     : { status: 'error', error: dbResult.reason?.message },
      redis:  redisResult.status  === 'fulfilled' ? redisResult.value  : { status: 'error', error: redisResult.reason?.message },
      stripe: stripeResult.status === 'fulfilled' ? stripeResult.value : { status: 'error', error: stripeResult.reason?.message },
      paypal: paypalResult.status === 'fulfilled' ? paypalResult.value : { status: 'error', error: paypalResult.reason?.message },
    };

    const allOk = Object.values(deps).every(d => d.status === 'ok' || d.status === 'disabled');

    res.status(allOk ? 200 : 503).json({
      status: allOk ? 'ok' : 'degraded',
      dependencies: deps,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /health/version — Version info (toy route P2-2) ─────────────────────

router.get('/version', (req, res) => {
  res.json({
    version: process.env.npm_package_version || 'unknown',
    commit: process.env.GIT_SHA || 'local',
  });
});

module.exports = router;
