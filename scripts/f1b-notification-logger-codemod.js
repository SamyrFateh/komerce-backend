#!/usr/bin/env node
'use strict';

/**
 * F1B notification-service logger codemod.
 *
 * Usage:
 *   node scripts/f1b-notification-logger-codemod.js --check
 *   node scripts/f1b-notification-logger-codemod.js --write
 *   git diff -- services/notification-service.js
 *   npm test
 *
 * This script intentionally handles a limited set of known console.* patterns
 * from services/notification-service.js. It refuses to write if the expected
 * anchors are missing or if the file appears already migrated.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'services', 'notification-service.js');
const MODE = process.argv.includes('--write') ? 'write' : 'check';

function fail(message) {
  console.error(`❌ F1B codemod refused: ${message}`);
  process.exit(1);
}

function replaceRequired(source, from, to, label) {
  if (!source.includes(from)) fail(`${label}: pattern not found`);
  return source.replace(from, to);
}

const original = fs.readFileSync(TARGET, 'utf8');
let next = original;

if (next.includes("require('../utils/logger').child({ module: 'notification-service' })")) {
  fail('notification-service.js already appears to have logger import');
}

next = replaceRequired(
  next,
  "const db = require('../db');\n",
  "const db = require('../db');\nconst log = require('../utils/logger').child({ module: 'notification-service' });\n",
  'logger import'
);

const replacements = [
  ["console.warn('[notification-service] table notification_log absente, log skipped');", "log.warn({ table: 'notification_log' }, 'Notification log table missing, log skipped');"],
  ["console.error('[notification-service] log error', err.message);", "log.error({ err }, 'Notification log write failed');"],
  ["console.warn('[notif][order-created] no phone', order.reference);", "log.warn({ order_ref: order.reference }, 'Order created notification skipped: no phone');"],
  ["console.error(`[notif][order-created][${role}]`, err.message);", "log.error({ err, order_ref: order.reference, phone, role }, 'Order created notification failed');"],
  ["console.warn('[notif][payment-confirmed] order not found', orderId);", "log.warn({ order_id: orderId, order_ref: orderReference }, 'Payment confirmed notification skipped: order not found');"],
  ["console.error('[notif][payment-confirmed]', err.message);", "log.error({ err, order_id: orderId, order_ref: orderReference }, 'Payment confirmed notification failed');"],
  ["console.error(`[notif][${entry.event}][${role}]`, err.message);", "log.error({ err, order_ref: order.reference, event: entry.event, phone, role }, 'Status change notification failed');"],
  ["console.error('[notif][cancellation]', err.message);", "log.error({ err, order_ref: order.reference, phone }, 'Cancellation notification failed');"],
  ["console.error('[notif][load-order-from-parcel]', err.message);", "log.error({ err, parcel_id: parcelId }, 'Load order from parcel failed');"],
  ["console.warn('[notif][parcel-scan] missing params', { parcelId, parcelStatus });", "log.warn({ parcel_id: parcelId, parcel_status: parcelStatus }, 'Parcel scan notification skipped: missing params');"],
  ["console.warn('[notif][parcel-scan] unmapped status', parcelStatus);", "log.warn({ parcel_status: parcelStatus }, 'Parcel scan notification skipped: unmapped status');"],
  ["console.warn('[notif][parcel-scan] order not found for parcel', parcelReference);", "log.warn({ parcel_id: parcelId, parcel_ref: parcelReference }, 'Parcel scan notification skipped: order not found');"],
  ["console.log('[notif][parcel-scan] ▶', {\n    parcelRef: parcelReference,\n    orderRef: order.reference,\n    parcelStatus,\n    orderStatus,\n  });", "log.info({ parcel_ref: parcelReference, order_ref: order.reference, parcel_status: parcelStatus, order_status: orderStatus }, 'Parcel scan notification dispatched');"],
  ["console.warn('[wa-otp] template OTP failed, no fallback configured:', result.error);", "log.warn({ error: result.error, phone }, 'WhatsApp OTP template failed, no fallback configured');"],
  ["console.error('[wa-otp] exception:', err.message);", "log.error({ err, phone }, 'WhatsApp OTP send failed');"],
  ["console.warn('[wa-otp] WID_OTP not configured in env — cannot send OTP');", "log.warn({ phone }, 'WhatsApp OTP skipped: template not configured');"],
  ["console.warn('[notif][parcel-created] missing orderId');", "log.warn({ parcel_ref: parcelRef, order_ref: orderReference }, 'Parcel created notification skipped: missing orderId');"],
  ["console.warn('[notif][parcel-created] order not found', orderId);", "log.warn({ order_id: orderId, order_ref: orderReference, parcel_ref: parcelRef }, 'Parcel created notification skipped: order not found');"],
  ["console.log('[notif][parcel-created] ▶', {\n      parcelRef, orderRef: order.reference,\n    });", "log.info({ parcel_ref: parcelRef, order_ref: order.reference }, 'Parcel created notification logged');"],
  ["console.error('[notif][parcel-created]', err.message);", "log.error({ err, order_id: orderId, order_ref: orderReference, parcel_ref: parcelRef }, 'Parcel created notification failed');"],
  ["console.warn('[wa-magic-link] Aucun template WID_MAGIC_LINK ni WID_OTP configuré');", "log.warn({ phone }, 'Magic link skipped: no WhatsApp template configured');"],
  ["console.log(`[wa-magic-link] ✅ → ${phone} (messageId: ${result.messageId})`);", "log.info({ phone, message_id: result.messageId }, 'Magic link sent');"],
  ["console.warn(`[wa-magic-link] ❌ ${phone}: ${result.error}`);", "log.warn({ phone, error: result.error }, 'Magic link rejected by provider');"],
  ["console.error('[wa-magic-link] exception:', err.message);", "log.error({ err, phone }, 'Magic link send failed');"],
];

let changedCount = 0;
for (const [from, to] of replacements) {
  if (next.includes(from)) {
    next = next.replace(from, to);
    changedCount++;
  }
}

if (changedCount < 12) {
  fail(`too few replacements applied (${changedCount})`);
}

const safetyNeedles = [
  'async function notifyOrderCreated',
  'async function notifyPaymentConfirmed',
  'async function notifyStatusChange',
  'async function notifyCancellation',
  'async function notifyParcelScan',
  'async function sendOtpMessage',
  'async function notifyParcelCreated',
  'async function sendMagicLink',
  'module.exports',
];
for (const needle of safetyNeedles) {
  if (!next.includes(needle)) fail(`safety check missing after transform: ${needle}`);
}

console.log('✅ F1B notification-service codemod checks passed');
console.log(`Mode: ${MODE}`);
console.log(`Replacements: ${changedCount}`);
console.log(`File length: ${original.length} → ${next.length}`);

if (MODE === 'write') {
  fs.writeFileSync(TARGET, next, 'utf8');
  console.log('✅ services/notification-service.js updated. Review with git diff.');
} else {
  console.log('No file written. Re-run with --write to apply.');
}
