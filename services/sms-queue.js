/**
 * KOMERCE — SMS Queue Processor (DB-backed)
 *
 * Replaces synchronous SMS sending with a reliable async queue.
 * No Redis/Bull required — uses the existing sms_log table as a queue.
 *
 * Flow:
 *   1. sendSMS() inserts a row with status='pending' (instant return)
 *   2. Queue processor polls every 10s for pending messages
 *   3. Sends via Africa's Talking with retry + exponential backoff
 *   4. Updates status: sent / failed / dead_letter
 *
 * Usage in server.js:
 *   const { startSMSQueue, stopSMSQueue } = require('./services/sms-queue');
 *   startSMSQueue();  // after DB is ready
 *   // On shutdown: stopSMSQueue();
 */

'use strict';

const db = require('../db');
const log = require('../utils/logger').child({ module: 'sms-queue' });
const monitor = require('./monitoring');

// ── Africa's Talking client (same init as utils/sms.js) ─────────────────────

let smsClient = null;

function initATClient() {
  const atKey = process.env.AT_API_KEY;
  const atUser = process.env.AT_USERNAME;

  if (atKey && atUser && atKey !== '...' && atUser !== 'komerce') {
    try {
      const AfricasTalking = require('africastalking');
      const at = AfricasTalking({ apiKey: atKey, username: atUser });
      smsClient = at.SMS;
      log.info('Africa\'s Talking SMS client initialized');
    } catch (err) {
      log.warn({ err }, 'Africa\'s Talking init failed');
    }
  } else {
    log.warn('SMS disabled — Africa\'s Talking keys not configured (dev mode)');
  }
}

initATClient();

// ── Queue configuration ─────────────────────────────────────────────────────

const QUEUE_CONFIG = {
  pollInterval: 10_000,       // 10 seconds
  batchSize: 10,              // Process up to 10 SMS per cycle
  maxAttempts: 3,             // Max retries before dead letter
  backoffBase: 60,            // Base backoff: 60 seconds
  backoffMultiplier: 3,       // Exponential: 60s, 180s, 540s
  lockTimeout: 120,           // Seconds before a "processing" SMS is considered stale
};

let _queueInterval = null;
let _isProcessing = false;

// ── Queue processor ─────────────────────────────────────────────────────────

async function processQueue() {
  if (_isProcessing) return; // prevent overlapping runs
  _isProcessing = true;

  try {
    // Fetch pending SMS, ordered by priority then time
    const { rows: pendingMessages } = await db.query(`
      UPDATE sms_log
      SET processing_started_at = NOW(), status = 'processing'
      WHERE id IN (
        SELECT id FROM sms_log
        WHERE status = 'pending'
          AND attempts < max_attempts
          AND next_attempt_at <= NOW()
        ORDER BY priority ASC, next_attempt_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, recipient, message, type, order_id, attempts, max_attempts
    `, [QUEUE_CONFIG.batchSize]);

    if (pendingMessages.length === 0) {
      _isProcessing = false;
      return;
    }

    log.info({ count: pendingMessages.length }, 'Processing SMS queue batch');

    for (const sms of pendingMessages) {
      try {
        await sendSingleSMS(sms);
      } catch (err) {
        log.error({ err, smsId: sms.id }, 'SMS processing error');
        monitor.trackError(err, { module: 'sms-queue', smsId: sms.id });
      }
    }
  } catch (err) {
    log.error({ err }, 'SMS queue processor error');
    monitor.trackError(err, { module: 'sms-queue' });
  } finally {
    _isProcessing = false;
  }
}

// ── Send individual SMS ─────────────────────────────────────────────────────

async function sendSingleSMS(sms) {
  const newAttempts = sms.attempts + 1;

  // Dev mode — skip sending
  if (!smsClient) {
    log.debug({ to: sms.recipient, type: sms.type }, '[DEV] SMS skipped');
    await db.query(
      `UPDATE sms_log SET status = 'dev_skipped', sent_at = NOW(), attempts = $1 WHERE id = $2`,
      [newAttempts, sms.id]
    );
    monitor.trackSMS('dev_skipped');
    return;
  }

  try {
    const result = await smsClient.send({
      to: [sms.recipient],
      message: sms.message,
      from: process.env.AT_SENDER_ID || 'Komerce',
    });

    const atId = result?.SMSMessageData?.Recipients?.[0]?.messageId || null;
    const status = result?.SMSMessageData?.Recipients?.[0]?.status === 'Success'
      ? 'sent' : 'failed';

    if (status === 'sent') {
      await db.query(
        `UPDATE sms_log SET status = 'sent', at_message_id = $1, sent_at = NOW(),
         attempts = $2, last_error = NULL WHERE id = $3`,
        [atId, newAttempts, sms.id]
      );
      monitor.trackSMS('sent');
      log.info({ to: sms.recipient, type: sms.type, atId }, 'SMS sent');
    } else {
      await handleRetry(sms, newAttempts, 'AT status not Success');
    }
  } catch (err) {
    await handleRetry(sms, newAttempts, err.message);
  }
}

// ── Retry with exponential backoff ──────────────────────────────────────────

async function handleRetry(sms, attempts, errorMessage) {
  if (attempts >= sms.max_attempts) {
    // Dead letter — max retries exceeded
    await db.query(
      `UPDATE sms_log SET status = 'failed', attempts = $1, last_error = $2 WHERE id = $3`,
      [attempts, errorMessage, sms.id]
    );
    monitor.trackSMS('failed');
    log.error({ smsId: sms.id, attempts, error: errorMessage }, 'SMS permanently failed (max retries)');
  } else {
    // Schedule retry with exponential backoff
    const backoffSeconds = QUEUE_CONFIG.backoffBase *
      Math.pow(QUEUE_CONFIG.backoffMultiplier, attempts - 1);

    await db.query(
      `UPDATE sms_log SET
        status = 'pending',
        attempts = $1,
        last_error = $2,
        next_attempt_at = NOW() + INTERVAL '1 second' * $3,
        processing_started_at = NULL
       WHERE id = $4`,
      [attempts, errorMessage, backoffSeconds, sms.id]
    );
    log.warn({
      smsId: sms.id,
      attempt: attempts,
      nextRetryIn: `${backoffSeconds}s`,
      error: errorMessage,
    }, 'SMS retry scheduled');
  }
}

// ── Stale message recovery ──────────────────────────────────────────────────

async function recoverStaleMessages() {
  const { rowCount } = await db.query(`
    UPDATE sms_log
    SET status = 'pending', processing_started_at = NULL
    WHERE status = 'processing'
      AND processing_started_at < NOW() - INTERVAL '1 second' * $1
  `, [QUEUE_CONFIG.lockTimeout]);

  if (rowCount > 0) {
    log.warn({ count: rowCount }, 'Recovered stale SMS messages');
  }
}

// ── Queue stats (for monitoring) ────────────────────────────────────────────

async function getQueueStats() {
  const { rows: [stats] } = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending') AS pending,
      COUNT(*) FILTER (WHERE status = 'processing') AS processing,
      COUNT(*) FILTER (WHERE status = 'sent' AND sent_at > NOW() - INTERVAL '1 hour') AS sent_1h,
      COUNT(*) FILTER (WHERE status = 'failed' AND created_at > NOW() - INTERVAL '24 hours') AS failed_24h,
      COUNT(*) FILTER (WHERE status = 'dev_skipped') AS dev_skipped
    FROM sms_log
  `);
  return stats;
}

// ── Start / Stop ────────────────────────────────────────────────────────────

function startSMSQueue() {
  if (_queueInterval) return;

  log.info({
    pollInterval: QUEUE_CONFIG.pollInterval,
    batchSize: QUEUE_CONFIG.batchSize,
    maxAttempts: QUEUE_CONFIG.maxAttempts,
  }, 'SMS queue started');

  // Recover stale messages on startup
  recoverStaleMessages().catch(err =>
    log.error({ err }, 'Failed to recover stale SMS messages'));

  // Poll queue
  _queueInterval = setInterval(processQueue, QUEUE_CONFIG.pollInterval);
  _queueInterval.unref();
}

function stopSMSQueue() {
  if (_queueInterval) {
    clearInterval(_queueInterval);
    _queueInterval = null;
    log.info('SMS queue stopped');
  }
}

module.exports = {
  startSMSQueue,
  stopSMSQueue,
  processQueue,
  getQueueStats,
  recoverStaleMessages,
  QUEUE_CONFIG,
};
