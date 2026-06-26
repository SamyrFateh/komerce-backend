/**
 * @komerce-arch
 * @role          monitoring
 * @domain        platform-ops
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */

/**
 * KOMERCE — Monitoring & Metrics Service
 *
 * Lightweight monitoring without external dependencies.
 * Tracks: error rates, response times, SMS delivery, DB health.
 * Optional Sentry integration when SENTRY_DSN is set.
 *
 * Usage:
 *   const monitor = require('../services/monitoring');
 *   monitor.trackError(err, { context: 'payment', orderId });
 *   monitor.trackMetric('sms.sent', 1, { type: 'confirmation' });
 *   monitor.getMetrics(); // returns all collected metrics
 */

'use strict';

const log = require('../utils/logger').child({ module: 'monitoring' });

// ── In-memory metrics (reset-safe, no external dep) ──────────────────────────

const metrics = {
  errors: {
    total: 0,
    by_module: {},      // { 'sms': 5, 'payment': 2 }
    last_errors: [],    // circular buffer, last 50
  },
  requests: {
    total: 0,
    by_status: {},      // { '200': 1500, '404': 20, '500': 3 }
    avg_duration_ms: 0,
    _duration_sum: 0,
  },
  sms: {
    sent: 0,
    failed: 0,
    dev_skipped: 0,
  },
  db: {
    queries: 0,
    slow_queries: 0,    // > 1000ms
    pool_errors: 0,
  },
  uptime_start: new Date().toISOString(),
};

const MAX_LAST_ERRORS = 50;

// ── Sentry (optional) ───────────────────────────────────────────────────────

let Sentry = null;

function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  try {
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      release: `komerce-backend@${process.env.npm_package_version || '0.0.0'}`,
      tracesSampleRate: 0.1,   // 10% of transactions
      beforeSend(event) {
        // Scrub sensitive data
        if (event.request?.cookies) delete event.request.cookies;
        if (event.request?.headers?.authorization) {
          event.request.headers.authorization = '[REDACTED]';
        }
        return event;
      },
    });
    log.info('Sentry initialized');
  } catch (err) {
    log.warn({ err }, 'Sentry not available — install @sentry/node for error tracking');
    Sentry = null;
  }
}

initSentry();

// ── Error tracking ──────────────────────────────────────────────────────────

function trackError(err, context = {}) {
  metrics.errors.total++;

  const module = context.module || context.context || 'unknown';
  metrics.errors.by_module[module] = (metrics.errors.by_module[module] || 0) + 1;

  // Circular buffer for last errors
  const entry = {
    message: err.message || String(err),
    module,
    timestamp: new Date().toISOString(),
    stack: err.stack?.split('\n').slice(0, 3).join(' | '),
    context: { ...context, module: undefined },
  };

  metrics.errors.last_errors.push(entry);
  if (metrics.errors.last_errors.length > MAX_LAST_ERRORS) {
    metrics.errors.last_errors.shift();
  }

  // Forward to Sentry if available
  if (Sentry) {
    Sentry.withScope((scope) => {
      scope.setTags({ module });
      for (const [k, v] of Object.entries(context)) {
        if (k !== 'module') scope.setExtra(k, v);
      }
      Sentry.captureException(err);
    });
  }

  // Always log structured
  log.error({ err, ...context }, `[${module}] ${err.message}`);
}

// ── Metric tracking ─────────────────────────────────────────────────────────

function trackMetric(name, value = 1, tags = {}) {
  // Generic metric counter
  const parts = name.split('.');
  let target = metrics;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!target[parts[i]]) target[parts[i]] = {};
    target = target[parts[i]];
  }
  const key = parts[parts.length - 1];
  target[key] = (target[key] || 0) + value;
}

// ── Request tracking (middleware) ────────────────────────────────────────────

function trackRequest(req, res, duration) {
  metrics.requests.total++;
  const statusGroup = String(res.statusCode);
  metrics.requests.by_status[statusGroup] =
    (metrics.requests.by_status[statusGroup] || 0) + 1;

  metrics.requests._duration_sum += duration;
  metrics.requests.avg_duration_ms =
    Math.round(metrics.requests._duration_sum / metrics.requests.total);
}

/**
 * Express middleware — tracks request metrics.
 * Place after httpLogger.
 */
function metricsMiddleware(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    trackRequest(req, res, Date.now() - start);
  });
  next();
}

// ── DB query tracking ───────────────────────────────────────────────────────

function trackDBQuery(duration_ms) {
  metrics.db.queries++;
  if (duration_ms > 1000) {
    metrics.db.slow_queries++;
    log.warn({ duration_ms }, 'Slow DB query detected');
  }
}

function trackDBPoolError() {
  metrics.db.pool_errors++;
}

// ── SMS tracking ────────────────────────────────────────────────────────────

function trackSMS(status) {
  if (status === 'sent') metrics.sms.sent++;
  else if (status === 'failed') metrics.sms.failed++;
  else if (status === 'dev_skipped') metrics.sms.dev_skipped++;
}

// ── Get all metrics ─────────────────────────────────────────────────────────

function getMetrics() {
  return {
    ...metrics,
    uptime_seconds: Math.floor(process.uptime()),
    memory: {
      rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heap_used_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
    timestamp: new Date().toISOString(),
  };
}

// ── Alerting — periodic check ───────────────────────────────────────────────

const ALERT_THRESHOLDS = {
  error_rate_per_minute: 10,
  sms_failure_rate: 0.5,     // 50%
  slow_query_rate: 0.1,      // 10%
};

let _lastAlertCheck = Date.now();
let _lastErrorCount = 0;

function checkAlerts() {
  const now = Date.now();
  const elapsed = (now - _lastAlertCheck) / 60000; // minutes
  if (elapsed < 1) return; // check every minute max

  const newErrors = metrics.errors.total - _lastErrorCount;
  const errorRate = newErrors / elapsed;

  if (errorRate > ALERT_THRESHOLDS.error_rate_per_minute) {
    log.error({
      errorRate: Math.round(errorRate * 10) / 10,
      threshold: ALERT_THRESHOLDS.error_rate_per_minute,
      period_minutes: Math.round(elapsed * 10) / 10,
    }, '🚨 ALERT: High error rate detected');
  }

  // SMS failure rate
  const totalSMS = metrics.sms.sent + metrics.sms.failed;
  if (totalSMS > 10) {
    const failureRate = metrics.sms.failed / totalSMS;
    if (failureRate > ALERT_THRESHOLDS.sms_failure_rate) {
      log.error({
        failureRate: Math.round(failureRate * 100),
        sent: metrics.sms.sent,
        failed: metrics.sms.failed,
      }, '🚨 ALERT: High SMS failure rate');
    }
  }

  _lastAlertCheck = now;
  _lastErrorCount = metrics.errors.total;
}

// Check every 60 seconds
const _alertInterval = setInterval(checkAlerts, 60000);
_alertInterval.unref(); // don't prevent process exit

module.exports = {
  trackError,
  trackMetric,
  trackRequest,
  trackDBQuery,
  trackDBPoolError,
  trackSMS,
  getMetrics,
  metricsMiddleware,
  checkAlerts,
  Sentry,
};
