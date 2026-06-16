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
 * @db-read       P2, orders, parcels
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

router.get('/', async (req, res) => {
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

router.get('/ready', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'not_ready' });
  }
});

// ── GET /health/metrics — Full metrics (admin only) ─────────────────────────

router.get('/metrics', authenticate, requireRole(['admin']), async (req, res) => {
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
    res.status(500).json({ error: 'Metrics unavailable', detail: err.message });
  }
});

module.exports = router;
