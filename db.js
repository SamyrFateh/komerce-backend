/**
 * KOMERCE — Connexion PostgreSQL (pool) — V2.8 Optimized
 *
 * CHANGEMENTS V2.8:
 *   - max: 10 → 20 (supporte plus de connexions concurrentes)
 *   - idleTimeoutMillis: 30s → 20s (libère plus vite les connexions idle)
 *   - connectionTimeoutMillis: 5s (inchangé)
 *   - statement_timeout: 30s (empêche les queries qui tournent en boucle)
 *   - Pool monitoring: log pool size toutes les 5 min si actif
 *   - Healthcheck function exportée
 *
 * Utilise la variable d'environnement DATABASE_URL fournie par Railway.
 * En local : créer un fichier .env avec DATABASE_URL=postgres://...
 */

require('dotenv').config();
const { Pool } = require('pg');
const log = require('./utils/logger').forModule('db');
const { rewriteLegacyAlertInsert, LEGACY_ALERTS_RE } = require('./utils/alerts-compat');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('sslmode=require')
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : false,

  // ── V2.8 Optimized pool settings ────────────────────────────────────
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  idleTimeoutMillis: 20_000,
  connectionTimeoutMillis: 5_000,

  // Prevent runaway queries (30s max per statement)
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT || '30000', 10),
});

pool.on('error', (err) => {
  log.error({ err }, 'PostgreSQL pool error');
});

// ── V2.8: Pool health monitoring ────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  const MONITOR_INTERVAL = 5 * 60 * 1000; // 5 min
  setInterval(() => {
    const { totalCount, idleCount, waitingCount } = pool;
    if (totalCount > 0 || waitingCount > 0) {
      log.info({ totalCount, idleCount, waitingCount }, 'DB pool status');
    }
    // Alert if pool is under pressure
    if (waitingCount > 5) {
      log.warn({ waitingCount }, 'DB pool under pressure — consider increasing DB_POOL_MAX');
    }
  }, MONITOR_INTERVAL);
}

// ── V2.8: Healthcheck helper ────────────────────────────────────────────────
async function healthcheck() {
  const start = Date.now();
  try {
    await pool.query('SELECT 1');
    return {
      status: 'ok',
      latency_ms: Date.now() - start,
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      },
    };
  } catch (err) {
    return {
      status: 'error',
      latency_ms: Date.now() - start,
      error: err.message,
    };
  }
}

// ── PR563: alerts-compat interceptor ────────────────────────────────────────
// Réécrit silencieusement les INSERT INTO alerts legacy (level, source, message, payload)
// vers le schéma réel (type, entity_type, entity_id, severity, title, description).
// Pas d'impact sur les autres requêtes.
function patchedQuery(...args) {
  const [text, params] = args;
  if (typeof text === 'string' && LEGACY_ALERTS_RE.test(text)) {
    const rewritten = rewriteLegacyAlertInsert(text, params || []);
    return pool.query(rewritten.sql, rewritten.params);
  }
  return pool.query(...args);
}

// Client patché (getClient) : surcharge query() sur le client acquis
async function patchedGetClient() {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  client.query = (...args) => {
    const [text, params] = args;
    if (typeof text === 'string' && LEGACY_ALERTS_RE.test(text)) {
      const rewritten = rewriteLegacyAlertInsert(text, params || []);
      return originalQuery(rewritten.sql, rewritten.params);
    }
    return originalQuery(...args);
  };
  return client;
}

module.exports = {
  query: patchedQuery,
  getClient: patchedGetClient,
  pool,
  healthcheck,
};