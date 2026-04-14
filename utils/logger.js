/**
 * KOMERCE — Structured Logger (Pino)
 *
 * Replaces all console.log/warn/error throughout the codebase.
 * Structured JSON logging for production, pretty-print for dev.
 *
 * Usage:
 *   const log = require('../utils/logger');
 *   log.info({ orderId, userId }, 'Order created');
 *   log.warn({ phone }, 'SMS skipped — invalid phone');
 *   log.error({ err, orderId }, 'Payment failed');
 *
 * Child loggers for modules:
 *   const log = require('../utils/logger').child({ module: 'sms' });
 *   log.info({ to, type }, 'SMS sent');
 */

'use strict';

const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),

  // Structured fields added to every log line
  base: {
    service: 'komerce-backend',
    env: process.env.NODE_ENV || 'development',
  },

  // Pretty-print in dev, JSON in production
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname,service,env',
          singleLine: false,
        },
      }
    : undefined,

  // Standardize error serialization
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

  // Redact sensitive fields
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'token',
      'secret',
      'creditCard',
    ],
    censor: '[REDACTED]',
  },

  // Timestamp as ISO string (Railway/Datadog friendly)
  timestamp: pino.stdTimeFunctions.isoTime,
});

// ── Express middleware — request logging ─────────────────────────────────────

/**
 * Express middleware that logs every request with timing.
 * Place after requestIdMiddleware, before routes.
 *
 * Usage in server.js:
 *   const { httpLogger } = require('./utils/logger');
 *   app.use(httpLogger);
 */
function httpLogger(req, res, next) {
  const start = Date.now();
  const child = logger.child({
    requestId: req.id || req.headers['x-request-id'],
    module: 'http',
  });

  // Log on response finish
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error'
               : res.statusCode >= 400 ? 'warn'
               : 'info';

    child[level]({
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration_ms: duration,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      userId: req.user?.id || null,
    }, `${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`);
  });

  next();
}

// Attach httpLogger as a property for easy import
logger.httpLogger = httpLogger;

module.exports = logger;
