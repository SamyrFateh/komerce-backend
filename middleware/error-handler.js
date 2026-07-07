/**
 * @komerce-arch
 * @role          auth-error-handler
 * @domain        infrastructure
 * @layer         middleware
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       services/monitoring.js, utils/logger.js
 * @db-write      none
 * @db-read      none
 * @used-by       server.js
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  auth
 * @version       2026-06
 */

/**
 * KOMERCE — Error Handler Middleware (V3.2 enhanced — resilient)
 *
 * Gracefully degrades if logger or monitoring service is unavailable.
 */

'use strict';

let log;
try {
  log = require('../utils/logger').child({ module: 'error-handler' });
} catch (_) {
  log = {
    error: (...args) => console.error('[error-handler]', ...args),
    warn:  (...args) => console.warn('[error-handler]', ...args),
    info:  (...args) => console.log('[error-handler]', ...args),
  };
}

let monitor;
try {
  monitor = require('../services/monitoring');
} catch (_) {
  monitor = { trackError: () => {}, trackMetric: () => {} };
}

function classifyError(err) {
  if (err.isJoi || err.type === 'entity.parse.failed') return 'validation';
  if (err.name === 'UnauthorizedError' || err.status === 401) return 'auth';
  if (err.name === 'ForbiddenError' || err.status === 403) return 'forbidden';
  if (err.code === '23505') return 'duplicate';
  if (err.code === '23503') return 'foreign_key';
  if (err.code === '23502') return 'not_null';
  if (err.code?.startsWith('23')) return 'db_constraint';
  // 22P02 = invalid_text_representation (ex: uuid/integer malformé passé en :id ou query).
  // Entrée client mal formée → 400, pas un 500 (détecté par la sonde P4-1).
  if (err.code === '22P02') return 'invalid_input';
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
    case 'invalid_input':  return 400;
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
    case 'invalid_input':  return 'Identifiant ou paramètre invalide';
    case 'cors':           return 'Origine non autorisée';
    case 'network':        return 'Service externe indisponible';
    default:               return 'Erreur interne du serveur';
  }
}

function errorHandler(err, req, res, _next) {
  const classification = classifyError(err);
  const statusCode = getStatusCode(err, classification);
  const requestId = req.requestId || req.headers?.['x-request-id'] || null;
  const userMessage = getUserMessage(classification, err);

  if (statusCode >= 500) {
    try {
      monitor.trackError(err, {
        module: 'http', requestId,
        method: req.method, url: req.originalUrl,
        userId: req.user?.id, classification,
      });
    } catch (_) {}
  }

  const logData = {
    err: statusCode >= 500 ? err : undefined,
    requestId, method: req.method, url: req.originalUrl,
    status: statusCode, classification, userId: req.user?.id || null,
  };

  if (statusCode >= 500) {
    log.error(logData, `${req.method} ${req.originalUrl} → ${statusCode} [${classification}]`);
  } else if (statusCode >= 400) {
    log.warn(logData, `${req.method} ${req.originalUrl} → ${statusCode} [${classification}]`);
  }

  const response = { error: userMessage, code: classification, requestId };

  if (process.env.NODE_ENV !== 'production') {
    response.detail = err.message;
    response.stack = err.stack?.split('\n').slice(0, 5);
  }

  if (err.isJoi && err.details) {
    response.validation = err.details.map(d => ({
      field: d.path?.join('.'),
      message: d.message,
    }));
  }

  res.status(statusCode).json(response);
}

function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Route introuvable',
    code: 'not_found',
    path: req.originalUrl,
    requestId: req.requestId || null,
  });
}

module.exports = { errorHandler, notFoundHandler };
