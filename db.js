/**
 * KOMERCE — Connexion PostgreSQL (pool) — V2.10
 *
 * HOTFIX V2.10 (2026-07-10 — rollback ciblé PR563) :
 *   - Retrait de l'interception alerts-compat (rewriteLegacyAlertInsert /
 *     rewriteArgs / wrapClient / patchedQuery / patchedConnect) introduite
 *     par PR563 au niveau db.js. Cause suspecte de la saturation du pool
 *     (20 connexions idle, aucun lock SQL) : pool.connect et client.query
 *     étaient monkey-patchés pour TOUS les appelants, y compris les chemins
 *     chauds (routes health/relais/categories/products) qui n'ont jamais eu
 *     besoin de réécriture alerts.
 *   - pool.query / pool.connect ne sont plus réassignés : db.query et
 *     db.getClient/db.connect exposent directement les méthodes natives
 *     de node-pg, sans wrapper.
 *   - utils/alerts-compat.js n'est PAS supprimé (16 services alerts en
 *     dépendent encore) : seul le branchement dans db.js est retiré. La
 *     vraie correction (helper métier createAlert()) viendra dans un
 *     correctif séparé.
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

  // ── FIX 2026-07-10 (incident pool mort après crash Postgres) ────────
  // statement_timeout est appliqué CÔTÉ SERVEUR : si Postgres crashe/redémarre
  // (incident 2026-07-09 16:13 UTC), il ne peut plus tuer les requêtes en vol.
  // Les 20 clients du pool sont restés suspendus sur des sockets morts
  // (totalCount=20, idleCount=0 en permanence, "timeout exceeded when trying
  // to connect" en boucle). query_timeout est appliqué CÔTÉ CLIENT (node-pg) :
  // la promesse de query rejette même si le serveur ne répond plus jamais,
  // le client est rendu au pool, le pool se régénère seul.
  // Marge vs statement_timeout (+5s) pour laisser le serveur tuer d'abord.
  query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT || '35000', 10),
  // keepAlive TCP : détecte les connexions mortes (restart DB, NAT Railway)
  // au lieu d'attendre indéfiniment sur un socket fantôme.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

pool.on('error', (err) => {
  log.error({ err }, 'PostgreSQL pool error');
});

// ── FIX 2026-07-09 : filet de sécurité idle_in_transaction ─────────────────
// `statement_timeout` (30s) ne protège que les requêtes SQL actives. Si un
// client fait BEGIN puis reste bloqué côté JS avant COMMIT/ROLLBACK (ex. un
// appel externe — SMS/WhatsApp/paiement — qui ne timeout jamais), la
// transaction reste ouverte indéfiniment et le client ne revient JAMAIS au
// pool, même avec release() appelé correctement en amont dans le code
// applicatif. Incident 2026-07-09 : pool saturé à 20/20 (max), idleCount=0,
// sans qu'aucune fuite classique (getClient sans release) n'ait été trouvée
// après audit des ~44 call-sites — cohérent avec ce scénario.
// idle_in_transaction_session_timeout tue côté Postgres toute session restée
// en transaction sans requête active au-delà du délai — indépendamment
// d'OÙ dans le code la transaction a été abandonnée. Filet de sécurité, pas
// un remplacement de la vraie correction (qui reste à identifier via les
// logs [unhandledRejection] maintenant lisibles).
const IDLE_IN_TX_TIMEOUT_MS = parseInt(process.env.DB_IDLE_IN_TX_TIMEOUT || '20000', 10);
pool.on('connect', (client) => {
  client.query(`SET idle_in_transaction_session_timeout = ${IDLE_IN_TX_TIMEOUT_MS}`)
    .catch((err) => log.error({ err }, 'Échec configuration idle_in_transaction_session_timeout'));
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

module.exports = {
  query: pool.query.bind(pool),
  getClient: pool.connect.bind(pool),
  connect: pool.connect.bind(pool), // alias : services/confirm-pickup-cash-payment.js en dépend
  pool,
  healthcheck,
};
