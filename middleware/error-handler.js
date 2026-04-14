/**
 * KOMERCE — Error Handler Middleware (V3.2 enhanced)
 *
 * Integrates with:
 *   - Pino structured logger (V3.1)
 *   - Monitoring service (V3.2) — error tracking + Sentry
 *   - Request ID (V2.2) — error correlation
 *
 * Replaces the previous error handler with:
 *   - Structured error logging (JSON in prod, pretty in dev)
 *   - Automatic error classification (validation, auth, DB, unknown)
 *   - Request ID correlation in error responses
 *   - Monitoring/alerting integration
 */

'use strict';

const log = require('../utils/logger').child({ module: 'error-handler' });
const monitor = require('../services/monitoring');

// ── Error classification ────────────────────────────────────────────────────

function classifyError(err) {
  if (err.isJoi || err.type === 'entity.parse.failed') return 'validation';
  if (err.name === 'UnauthorizedError' || err.status === 401) return 'auth';
  if (err.name === 'ForbiddenError' || err.status === 403) return 'forbidden';
  if (err.code === '23505') return 'duplicate';       // PostgreSQL unique violation
  if (err.code === '23503') return 'foreign_key';     // PostgreSQL FK violation
  if (err.code === '23502') return 'not_null';         // PostgreSQL not null violation
  if (err.code?.startsWith('23')) return 'db_constraint';
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') return 'network';
  if (err.message?.includes('CORS')) return 'cors';
  return 'unknown';
}

function getStatusCode(err, classification) {
  if (err.status || err.statusCode) return err.status || err.statusCode;

  switch (classification) {
    case 'validation':     return 400;
    case 'auth':           return 401;
    case 'forbidden':      return 403;
    case 'duplicate':      return 409;
    case 'foreign_key':    return 400;
    case 'not_null':       return 400;
    case 'db_constraint':  return 400;
    case 'cors':           return 403;
    case 'network':        return 502;
    default:               return 500;
  }
}

function getUserMessage(classification, err) {
  switch (classification) {
    case 'validation':     return err.message || 'Données invalides';
    case 'auth':           return 'Authentification requise';
    case 'forbidden':      return 'Accès interdit';
    case 'duplicate':      return 'Cet élément existe déjà';
    case 'foreign_key':    return 'Référence invalide — élément lié introuvable';
    case 'not_null':       return 'Champ obligatoire manquant';
    case 'db_constraint':  return 'Contrainte de données violée';
    case 'cors':           return 'Origine non autorisée';
    case 'network':        return 'Service externe indisponible';
    default:               return 'Erreur interne du serveur';
  }
}

// ── Main error handler ──────────────────────────────────────────────────────

function errorHandler(err, req, res, _next) {
  const classification = classifyError(err);
  const statusCode = getStatusCode(err, classification);
  const requestId = req.id || req.headers?.['x-request-id'] || null;
  const userMessage = getUserMessage(classification, err);

  // Track in monitoring (only 500s and above)
  if (statusCode >= 500) {
    monitor.trackError(err, {
      module: 'http',
      requestId,
      method: req.method,
      url: req.originalUrl,
      userId: req.user?.id,
      classification,
    });
  }

  // Log with appropriate level
  const logData = {
    err: statusCode >= 500 ? err : undefined, // full stack only for 500s
    requestId,
    method: req.method,
    url: req.originalUrl,
    status: statusCode,
    classification,
    userId: req.user?.id || null,
  };

  if (statusCode >= 500) {
    log.error(logData, `${req.method} ${req.originalUrl} → ${statusCode} [${classification}]`);
  } else if (statusCode >= 400) {
    log.warn(logData, `${req.method} ${req.originalUrl} → ${statusCode} [${classification}]`);
  }

  // Build response
  const response = {
    error: userMessage,
    code: classification,
    requestId,
  };

  // In dev, include detailed error info
  if (process.env.NODE_ENV !== 'production') {
    response.detail = err.message;
    response.stack = err.stack?.split('\n').slice(0, 5);
  }

  // Joi validation errors — include field details
  if (err.isJoi && err.details) {
    response.validation = err.details.map(d => ({
      field: d.path?.join('.'),
      message: d.message,
    }));
  }

  res.status(statusCode).json(response);
}

// ── 404 handler ─────────────────────────────────────────────────────────────

function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Route introuvable',
    code: 'not_found',
    path: req.originalUrl,
    requestId: req.id || null,
  });
}

module.exports = { errorHandler, notFoundHandler };
