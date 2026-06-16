/**
 * @komerce-arch
 * @role          logger
 * @domain        unknown
 * @layer         util
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @db-write      @unknown
 * @db-read      @unknown
 * @used-by       @unknown
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