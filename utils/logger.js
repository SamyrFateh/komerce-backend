/**
 * @komerce-arch
 * @role          logger
 * @domain        infrastructure
 * @layer         util
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       none
 * @db-write      none
 * @db-read      none
 * @used-by       bootstrap/crons.js, bootstrap/env.js, bootstrap/html-routes.js, bootstrap/server-lifecycle.js, bootstrap/startup-migrations.js, middleware/auth-guest.js, middleware/auth.js, middleware/error-handler.js, middleware/rate-limit.js, middleware/require-verified-identity.js, middleware/soft-auth.js, middleware/verify-authkey-webhook.js, routes/admin-costing.js, routes/admin-dashboard.js, routes/admin-finance-config.js, routes/admin-loyalty.js, routes/admin-pricing-matrices.js, routes/admin/customs.js, routes/admin/dashboard.js, routes/admin/orders.js, routes/admin/partners.js, routes/admin/system.js, routes/admin/users.js, routes/auth.js, routes/auto-distribute-api.js, routes/baskets.js, routes/cash.js, routes/client-auth.js, routes/client-tracking.js, routes/collective-workspaces.js, routes/config.js, routes/dashboard-clients.js, routes/dashboard-hub.js, routes/dashboard-ops.js, routes/economic.js, routes/hub-dashboard.js, routes/invoices.js, routes/logistics.js, routes/loyalty.js, routes/meta-whatsapp.js, routes/ops-api.js, routes/order-api-v2.js, routes/orders/cancel.js, routes/orders/create.js, routes/orders/qr.js, routes/orders/status.js, routes/otp.js, routes/parcel-api-v2/helpers.js, routes/parcel-api-v2/scans.js, routes/parcel-label.js, routes/parcels.js, routes/payments-paypal.js, routes/payments.js, routes/pickup-secret.js, routes/products.js, routes/purchasing.js, routes/relay-dashboard.js, routes/shared-cart-refund-admin.js, routes/shared-cart.js, routes/shares.js, routes/signals.js, routes/tracking.js, routes/transit-dashboard.js, routes/transitaire-api.js, routes/wallet.js, server.js, services/admin-order-refund.js, services/apply-pricing-updates.js, services/authkey-client.js, services/auto-parcel.js, services/cancel-order-purchase-orders.js, services/cancel-shared-cart-with-refunds.js, services/cash-operations.js, services/cash-reminder-service.js, services/catalog-approval.js, services/catalog-enrichment.js, services/collective-payment-orchestrator.js, services/confirm-pickup-cash-payment.js, services/create-stripe-order-intent.js, services/dashboard-clients-queries.js, services/dashboard-ops-queries.js, services/documents/customs-invoice.js, services/documents/document-service.js, services/documents/pickup-proof.js, services/documents/refund-receipt.js, services/documents/wallet-receipt.js, services/economic-engine-queries.js, services/finance-metrics/annulations.js, services/finance-metrics/finance-summary.js, services/finance-metrics/payments.js, services/finance-metrics/sales-analysis.js, services/hub-dashboard-queries.js, services/loyalty-service.js, services/monitoring.js, services/notifications/internals.js, services/order-cost-snapshot.js, services/order-payment-confirmation.js, services/order-status-machine.js, services/parcel-auto-create-service.js, services/parcel-operations.js, services/parcel-security.js, services/payment-cash-confirm.js, services/payment-paypal-events.js, services/payment-paypal.js, services/payment-stripe.js, services/paypal-client.js, services/pickup-secret-service.js, services/pricing-dashboard.js, services/pricing-recommend.js, services/product-admin-service.js, services/product-price-audit.js, services/product-publication-guard.js, services/purchasing-admin-service.js, services/purchasing-receive-service.js, services/purchasing-trigger-service.js, services/receive-purchase-order.js, services/reconciliation-service.js, services/refund-service.js, services/relay-dashboard-queries.js, services/routing.js, services/scan-engine.js, services/scan-operations.js, services/shared-cart-cash-service.js, services/shared-cart-estimation-service.js, services/shared-cart-financial-guard.js, services/shared-cart-lifecycle.js, services/shared-cart-refund-queue.js, services/signal-service.js, services/simulator/engine.js, services/simulator/state-advancer.js, services/sourcing-analysis.js, services/verify-qr-collection.js, services/wallet-service.js, utils/categories-cache.js, utils/eco-bridge.js, utils/email.js, utils/orderParcelLinkRules.js, utils/parcelSync.js, utils/parcels.js, utils/pricing-cache.js, utils/rates.js, utils/refunds.js, utils/rules.js, utils/store-credits.js
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */

/**
 * KOMERCE — Structured Logger (Pino with console fallback)
 *
 * Uses Pino for structured JSON logging when available.
 * Falls back gracefully to console if pino is not installed.
 *
 * Usage:
 *   const log = require('../utils/logger');
 *   log.info({ orderId, userId }, 'Order created');
 *   log.warn({ phone }, 'SMS skipped');
 *   log.error({ err, orderId }, 'Payment failed');
 *
 * Child loggers for modules:
 *   const log = require('../utils/logger').forModule('sms');
 *   // Backward compatible:
 *   const log = require('../utils/logger').child({ module: 'sms' });
 */

'use strict';

const isTest = process.env.NODE_ENV === 'test';
const isDev = process.env.NODE_ENV !== 'production';

// ─── Masquage PII partiel ─────────────────────────────────────────────────────
// Masquage partiel (pas [REDACTED] total) pour conserver la corrélation ops.
// Ex : "+2690612345"  → "+269•••45"
//      "sam@gmail.com" → "s***@gmail.com"

const PII_PHONE_FIELDS = new Set(['phone', 'mobile', 'whatsapp_phone', 'tracking_phone']);
const PII_EMAIL_FIELDS = new Set(['email', 'user_email', 'contact_email']);

function maskPhone(v) {
  if (typeof v !== 'string' || v.length < 4) return '•••';
  return v.slice(0, 4) + '•••' + v.slice(-2);
}

function maskEmail(v) {
  if (typeof v !== 'string') return '•••';
  const at = v.indexOf('@');
  if (at < 1) return '•••';
  return v[0] + '***' + v.slice(at);
}

/**
 * Applique le masquage PII sur un objet de log (profondeur 1 + champs imbriqués).
 * Ne mute pas l'objet original.
 */
function maskPiiFields(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  let masked = null; // lazy copy — on n'alloue que si nécessaire

  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (PII_PHONE_FIELDS.has(key) && typeof val === 'string') {
      if (!masked) masked = Object.assign({}, obj);
      masked[key] = maskPhone(val);
    } else if (PII_EMAIL_FIELDS.has(key) && typeof val === 'string') {
      if (!masked) masked = Object.assign({}, obj);
      masked[key] = maskEmail(val);
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      const sub = maskPiiFields(val);
      if (sub !== val) {
        if (!masked) masked = Object.assign({}, obj);
        masked[key] = sub;
      }
    }
  }
  return masked || obj;
}
// ─────────────────────────────────────────────────────────────────────────────

let logger;

try {
  const pino = require('pino');

  let transport;
  if (isDev && !isTest) {
    try {
      transport = {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname,service,env',
          singleLine: false,
        },
      };
    } catch (_) {
      transport = undefined;
    }
  }

  logger = pino({
    level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
    base: {
      service: 'komerce-backend',
      env: process.env.NODE_ENV || 'development',
    },
    transport,
    formatters: {
      log: (obj) => maskPiiFields(obj),
    },
    serializers: {
      err: pino.stdSerializers.err,
      req: (req) => ({
        method: req.method,
        url: req.url,
        id: req.id,
        ip: req.ip,
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'password',
        'token',
        'secret',
        'creditCard',
        '*.password',
        '*.token',
        '*.secret',
        '*.creditCard',
      ],
      censor: '[REDACTED]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });

} catch (_) {
  console.warn('⚠️  pino not installed — using console fallback. Run: npm install pino pino-pretty');

  const noop = () => {};

  function makeConsoleLogger(context = {}) {
    const prefix = context.module ? `[${context.module}]` : '[komerce]';

    return {
      trace: noop,
      debug: (...args) => isDev && console.debug(prefix, ...args),
      info:  (...args) => console.log(prefix, ...args),
      warn:  (...args) => console.warn(prefix, ...args),
      error: (...args) => console.error(prefix, ...args),
      fatal: (...args) => console.error('💀', prefix, ...args),
      child: (childCtx) => makeConsoleLogger({ ...context, ...childCtx }),
      level: isDev ? 'debug' : 'info',
    };
  }

  logger = makeConsoleLogger();
}

function forModule(module, extra = {}) {
  return logger.child({ module, ...extra });
}

function httpLogger(req, res, next) {
  const start = Date.now();
  const child = forModule('http', {
    request_id: req.id || req.headers['x-request-id'],
  });

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error'
               : res.statusCode >= 400 ? 'warn'
               : 'info';

    child[level](
      {
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        duration_ms: duration,
        ip: req.ip,
        user_id: req.user?.id || null,
      },
      `${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`
    );
  });

  next();
}

logger.forModule = forModule;
logger.httpLogger = httpLogger;

module.exports = logger;