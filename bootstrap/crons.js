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
  const { processCashRelaisReminders, processBackorderReminders } = require('../utils/sms');
  const { getRuleNumber } = require('../utils/rules');

  startCashRelaisCron({ processCashRelaisReminders, processBackorderReminders, getRuleNumber });
  startBackorderCron({ processBackorderReminders });
  startSnapshotRetentionCron();
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

module.exports = {
  startOperationalCrons,
  startCashRelaisCron,
  startBackorderCron,
  startSnapshotRetentionCron,
};
