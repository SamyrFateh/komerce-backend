/**
 * @komerce-arch
 * @role          operational-crons
 * @domain        infrastructure
 * @layer         cron
 * @criticality   critical
 * @inputs        timers, database_state, rules
 * @outputs       automatic_transitions, purges, reminders
 * @depends       services/cash-reminder-service.js, services/inventory-service.js, utils/rules.js
 * @db-write      economic_snapshots, pickup_print_tokens, pickup_reveal_codes, revoked_tokens
 * @db-read      economic_snapshots, pickup_print_tokens, pickup_reveal_codes, revoked_tokens
 * @used-by       server.js
 * @doctrine      idempotence_cron, retention_snapshots
 * @impact-areas  cash-reminders, inventory, auth-security, economic-engine
 * @version       2026-06
 */

'use strict';

const log = require('../utils/logger').child({ module: 'bootstrap-crons' });

function startCashRelaisCron({ processCashRelaisReminders, processBackorderReminders, getRuleNumber }) {
  let cronRunning = false;

  (async () => {
    let intervalMin = 60;
    try {
      intervalMin = await getRuleNumber('CASH_REMINDER_INTERVAL_MIN', 60);
    } catch (_) {
      // fallback 60min
    }

    log.info({ interval_min: intervalMin }, 'Cash reminder cron started');

    setInterval(async () => {
      try {
        const inv = require('../services/inventory-service');
        const result = await inv.autoConfirmExpired();
        if (result.auto_confirmed > 0) {
          log.info({ auto_confirmed: result.auto_confirmed }, 'Inventory proposals auto-confirmed');
        }
      } catch (_) {
        // non-fatal
      }
    }, 30 * 60 * 1000);

    setInterval(async () => {
      if (cronRunning) return;
      cronRunning = true;
      try {
        await processCashRelaisReminders();
      } catch (err) {
        log.error({ err }, 'Cash reminder cron failed');
      } finally {
        cronRunning = false;
      }
    }, intervalMin * 60 * 1000);
  })();
}

function startBackorderCron({ processBackorderReminders }) {
  const BACKORDER_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
  let backorderCronRunning = false;

  setInterval(async () => {
    if (backorderCronRunning) return;
    backorderCronRunning = true;
    try {
      const result = await processBackorderReminders();
      if (result.processed > 0) {
        log.info({ processed: result.processed, sms_sent: result.sms_sent }, 'Backorder check processed');
      }
    } catch (err) {
      log.error({ err }, 'Backorder check failed');
    } finally {
      backorderCronRunning = false;
    }
  }, BACKORDER_CHECK_INTERVAL_MS);

  setTimeout(() => {
    processBackorderReminders()
      .then(result => {
        if (result.processed > 0) {
          log.info({ processed: result.processed }, 'Initial backorder check processed');
        }
      })
      .catch(err => log.error({ err }, 'Initial backorder check failed'));
  }, 30 * 1000);
}

function startOperationalCrons() {
  // ZG-1: migré de utils/sms (Africa's Talking, désactivé) → services/cash-reminder-service (WhatsApp)
  const { processCashRelaisReminders, processBackorderReminders } = require('../services/cash-reminder-service');
  const { getRuleNumber } = require('../utils/rules');

  startCashRelaisCron({ processCashRelaisReminders, processBackorderReminders, getRuleNumber });
  startBackorderCron({ processBackorderReminders });
  startSnapshotRetentionCron();
  startPickupTokenCleanupCron(); // SEC-1 migration 070
  startJwtRevocationCleanupCron(); // N4 migration 072
}

// D1 FIX — Rétention economic_snapshots : purge les lignes > 90 jours, toutes les 24h.
// Le debounce (P2-6) réduit le flux d'insertion mais ne nettoie pas l'historique.
function startSnapshotRetentionCron() {
  const RETENTION_DAYS = 90;
  const INTERVAL_MS = 24 * 60 * 60 * 1000;

  const run = async () => {
    try {
      const db = require('../db');
      const { rowCount } = await db.query(
        `DELETE FROM economic_snapshots WHERE created_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`
      );
      if (rowCount > 0) {
        log.info({ deleted: rowCount, retention_days: RETENTION_DAYS }, 'economic_snapshots retention purge done');
      }
    } catch (err) {
      log.error({ err }, 'economic_snapshots retention cron failed');
    }
  };

  // Première exécution 5 min après démarrage (pas au boot immédiat)
  setTimeout(run, 5 * 60 * 1000);
  setInterval(run, INTERVAL_MS);

  log.info({ retention_days: RETENTION_DAYS, interval_h: 24 }, 'Snapshot retention cron scheduled');
}

// SEC-1 — Purge des tokens éphémères pickup (migration 070)
// pickup_print_tokens : TTL 2 min / pickup_reveal_codes : TTL 30 min
// Toutes les 5 minutes, supprime les lignes expirées.
function startPickupTokenCleanupCron() {
  const INTERVAL_MS = 5 * 60 * 1000;

  const run = async () => {
    try {
      const db = require('../db');
      const [r1, r2] = await Promise.all([
        db.query('DELETE FROM pickup_print_tokens WHERE expires_at < NOW()'),
        db.query('DELETE FROM pickup_reveal_codes WHERE expires_at < NOW()'),
      ]);
      const deleted = (r1.rowCount || 0) + (r2.rowCount || 0);
      if (deleted > 0) {
        log.info({ deleted }, 'pickup ephemeral tokens purge done');
      }
    } catch (err) {
      log.error({ err }, 'pickup token cleanup cron failed');
    }
  };

  // Première exécution 5 min après démarrage
  setTimeout(run, 5 * 60 * 1000);
  setInterval(run, INTERVAL_MS);

  log.info({ interval_min: 5 }, 'Pickup token cleanup cron scheduled');
}

// N4 — Purge des tokens JWT révoqués (migration 072)
// Supprime les lignes dont expires_at < NOW() toutes les heures.
// Les tokens expirés naturellement sont ignorés par jwt.verify — la purge évite
// une table qui grossit sans fin pour des tokens qui ne seraient de toute façon
// plus acceptés par l'authentification.
function startJwtRevocationCleanupCron() {
  const INTERVAL_MS = 60 * 60 * 1000; // 1h

  const run = async () => {
    try {
      const db = require('../db');
      const { rowCount } = await db.query(
        'DELETE FROM revoked_tokens WHERE expires_at < NOW()'
      );
      if (rowCount > 0) {
        log.info({ deleted: rowCount }, 'revoked_tokens cleanup done');
      }
    } catch (err) {
      log.error({ err }, 'revoked_tokens cleanup cron failed');
    }
  };

  // Première exécution 10 min après démarrage
  setTimeout(run, 10 * 60 * 1000);
  setInterval(run, INTERVAL_MS);

  log.info({ interval_h: 1 }, 'JWT revocation cleanup cron scheduled');
}

// V4.1 — Machine d'état panier partagé.
module.exports = {
  startOperationalCrons,
  startCashRelaisCron,
  startBackorderCron,
  startSnapshotRetentionCron,
  startPickupTokenCleanupCron,
  startJwtRevocationCleanupCron,
};
