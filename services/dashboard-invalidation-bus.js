/**
 * @komerce-arch
 * @role          dashboard-post-commit-invalidation-bus
 * @domain        dashboard
 * @layer         infrastructure
 * @criticality   high
 * @inputs        postgres_notify
 * @outputs       cache_invalidation, dashboard_change_hints
 * @depends       db, dashboard-cache
 * @used-by       routes/admin-dashboard-events.js, server.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      after_commit_revalidate_canonical_read_models
 * @impact-areas  dashboard, hub, admin-dashboard
 * @version       2026-11
 */
'use strict';

const db = require('../db');
const log = require('../utils/logger').child({ module: 'dashboard-invalidation-bus' });
const CHANNEL = 'komerce_dashboard_refresh';
const subscribers = new Set();
let client = null;
let connecting = null;
let retryTimer = null;
let stopped = false;

function dispatch() {
  try {
    // Un événement PG NOTIFY n'est délivré qu'après COMMIT (jamais après rollback).
    // La source de vérité reste la relecture des API officielles.
    require('./dashboard-cache').invalidateAllDashboards();
  } catch (error) {
    log.error({ err:error.message }, '[dashboard-live] cache invalidation failed');
  }
  for (const listener of subscribers) {
    try { listener(); } catch (error) {
      log.warn({ err:error.message }, '[dashboard-live] subscriber callback failed');
    }
  }
}

function scheduleRetry() {
  if (stopped || retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    start().catch(() => {});
  }, 5000);
  retryTimer.unref?.();
}

function detach(connection) {
  if (!connection) return;
  connection.removeAllListeners('notification');
  connection.removeAllListeners('error');
  connection.removeAllListeners('end');
  try { connection.release(true); } catch (_) { /* pool déjà fermé */ }
}

function lost(connection, error) {
  if (client !== connection) return;
  client = null;
  log.warn({ err: error && error.message }, '[dashboard-live] LISTEN disconnected');
  detach(connection);
  scheduleRetry();
}

function start() {
  stopped = false;
  if (client) return Promise.resolve();
  if (connecting) return connecting;
  connecting = (async () => {
    const connection = await db.getClient();
    try {
      connection.on('notification', message => {
        if (message.channel === CHANNEL) dispatch();
      });
      connection.on('error', error => lost(connection, error));
      connection.on('end', () => lost(connection));
      await connection.query('LISTEN ' + CHANNEL);
      if (stopped) { detach(connection); return; }
      client = connection;
      log.info('[dashboard-live] LISTEN connected');
    } catch (error) {
      detach(connection);
      throw error;
    }
  })()
    .catch(error => {
      log.warn({ err:error.message }, '[dashboard-live] LISTEN unavailable; retry scheduled');
      scheduleRetry();
    })
    .finally(() => { connecting = null; });
  return connecting;
}

function subscribe(fn) {
  if (typeof fn !== 'function') throw new TypeError('dashboard-live subscriber must be function');
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function stop() {
  stopped = true;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (client) {
    const previous = client;
    client = null;
    detach(previous);
  }
}

module.exports = { CHANNEL, start, subscribe, stop, dispatch };
