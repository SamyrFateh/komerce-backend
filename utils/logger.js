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

const isDev = process.env.NODE_ENV !== 'production';

let logger;

try {
  const pino = require('pino');

  let transport;
  if (isDev) {
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
  log.warn('⚠️  pino not installed — using console fallback. Run: npm install pino pino-pretty');

  const noop = () => {};

  function makeConsoleLogger(context = {}) {
    const prefix = context.module ? `[${context.module}]` : '[komerce]';

    return {
      trace: noop,
      debug: (...args) => isDev && log.debug(prefix, ...args),
      info:  (...args) => log.info(prefix, ...args),
      warn:  (...args) => log.warn(prefix, ...args),
      error: (...args) => log.error(prefix, ...args),
      fatal: (...args) => log.error('💀', prefix, ...args),
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
