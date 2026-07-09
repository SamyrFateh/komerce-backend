/**
 * KOMERCE — Connexion PostgreSQL (pool) — V2.9
 *
 * CHANGEMENTS V2.9 (PR563 — fix récursion + connect manquant) :
 *   - Les références originales pool.query/pool.connect sont capturées
 *     AVANT toute surcharge. Les versions patchées ne s'appellent jamais
 *     elles-mêmes, quel que soit le chemin d'appel (db.query, db.connect,
 *     db.getClient, db.pool.query, db.pool.connect).
 *   - db.connect() est ré-exporté (alias de getClient) — services/
 *     confirm-pickup-cash-payment.js en dépend directement.
 *
 * CHANGEMENTS V2.8 (inchangés) :
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
const { rewriteLegacyAlertInsert } = require('./utils/alerts-compat');

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

// ── PR563: alerts-compat interceptor ────────────────────────────────────────
// Réécrit silencieusement les INSERT INTO alerts legacy (level, source,
// message, payload) vers le schéma réel (type, entity_type, entity_id,
// severity, title, description). Couvre db.query(...), db.pool.query(...),
// db.getClient(), db.connect() et db.pool.connect(), sans masquer les
// autres erreurs SQL ni altérer les signatures pg non concernées.
//
// IMPORTANT : les références originales sont capturées ICI, avant toute
// surcharge de pool.query / pool.connect plus bas. Les fonctions patchées
// n'appellent jamais pool.query/pool.connect (qui seraient elles-mêmes à
// ce stade) — elles appellent originalPoolQuery/originalPoolConnect.
const originalPoolQuery = pool.query.bind(pool);
const originalPoolConnect = pool.connect.bind(pool);

function rewriteArgs(args) {
  const [text, ...rest] = args;
  if (typeof text !== 'string') return null;

  const maybeParams = rest[0];
  const params = Array.isArray(maybeParams) ? maybeParams : [];

  const rewritten = rewriteLegacyAlertInsert(text, params);
  if (!rewritten.rewritten) return null;

  if (typeof maybeParams === 'function') {
    // Forme pool.query(text, callback) — pas de params utilisateur.
    return [rewritten.sql, rewritten.params, maybeParams];
  }

  const cb = rest.find((a) => typeof a === 'function');
  return cb ? [rewritten.sql, rewritten.params, cb] : [rewritten.sql, rewritten.params];
}

function patchedQuery(...args) {
  const rewritten = rewriteArgs(args);
  return rewritten ? originalPoolQuery(...rewritten) : originalPoolQuery(...args);
}

function wrapClient(client) {
  if (!client || client.__komerceAlertsCompatWrapped) return client;

  const originalClientQuery = client.query.bind(client);
  client.query = (...args) => {
    const rewritten = rewriteArgs(args);
    return rewritten ? originalClientQuery(...rewritten) : originalClientQuery(...args);
  };

  Object.defineProperty(client, '__komerceAlertsCompatWrapped', {
    value: true,
    enumerable: false,
  });

  return client;
}

async function patchedConnect() {
  const client = await originalPoolConnect();
  return wrapClient(client);
}

// pool.query / pool.connect sont surchargés pour couvrir les appels directs
// db.pool.query() / db.pool.connect(), mais s'appuient toujours sur les
// références originales ci-dessus — jamais sur pool.query/pool.connect
// eux-mêmes (source de la récursion infinie corrigée par ce patch).
pool.query = patchedQuery;
pool.connect = patchedConnect;

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

module.exports = {
  query: patchedQuery,
  getClient: patchedConnect,
  connect: patchedConnect, // ré-exporté : services/confirm-pickup-cash-payment.js en dépend
  pool,
  healthcheck,
};
