'use strict';

const log = require('../utils/logger').child({ module: 'payment-paypal-events' });

async function markPaypalEventProcessed(event, status, payloadSummary, db) {
  try {
    await db.query(
      `INSERT INTO paypal_events_processed (event_id, event_type, payload_summary, status)
       VALUES ($1, $2, $3, $4) ON CONFLICT (event_id) DO NOTHING`,
      [event.id, event.event_type, JSON.stringify(payloadSummary || {}), status]
    );
  } catch (e) {
    log.warn({ err: e, event_id: event.id }, '[PAYPAL-WEBHOOK] markPaypalEventProcessed failed');
  }
}

module.exports = {
  markPaypalEventProcessed,
};
