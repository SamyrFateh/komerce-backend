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
}

module.exports = {
  startOperationalCrons,
  startCashRelaisCron,
  startBackorderCron,
};
