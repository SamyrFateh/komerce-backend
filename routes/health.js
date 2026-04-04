/**
 * Health Check Endpoint — Komerce Backend
 * =========================================
 * P2 FIX #19: No health check endpoint existed for monitoring.
 *
 * Usage in server.js:
 *   const healthRoutes = require('./routes/health');
 *   app.use('/health', healthRoutes);
 *
 * Endpoints:
 *   GET /health       — Basic health check (DB connectivity)
 *   GET /health/ready  — Readiness check (same for now)
 */

const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const db = require('../db'); // Adjust path to your db module
    const start = Date.now();
    await db.query('SELECT 1');
    const dbLatency = Date.now() - start;

    res.json({
      status: 'ok',
      db: 'connected',
      db_latency_ms: dbLatency,
      uptime_s: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Health check failed:', err.message);
    res.status(503).json({
      status: 'error',
      db: 'disconnected',
      timestamp: new Date().toISOString(),
    });
  }
});

router.get('/ready', async (req, res) => {
  try {
    const db = require('../db');
    await db.query('SELECT 1');
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'not_ready' });
  }
});

module.exports = router;
