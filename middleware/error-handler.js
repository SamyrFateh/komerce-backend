/**
 * KOMERCE — Gestion centralisée des erreurs (V2.2 — Request ID + operational distinction)
 *
 * AppError   : classe d'erreur métier intentionnelle et typée
 * errorHandler : middleware Express final — monté après toutes les routes dans server.js
 *
 * Conventions :
 *   - err.isOperational = true  → erreur connue, message safe à envoyer au client
 *   - err.isOperational = false → bug inattendu → log complet + 500 générique
 *
 * V2.2 CHANGES:
 *   - Request ID (req.requestId) included in all error responses
 *   - Request ID included in all error logs for correlation
 *   - Structured error logging with timestamp + method + path + requestId
 */

'use strict';

// ── Classe d'erreur métier ───────────────────────────────────────────────────

class AppError extends Error {
  /**
   * @param {string} message   Message lisible par le client
   * @param {number} statusCode Code HTTP (400, 403, 404, 409, etc.)
   * @param {string} code      Identifiant machine (NOT_FOUND, FORBIDDEN, etc.)
   */
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name        = 'AppError';
    this.statusCode  = statusCode;
    this.code        = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  // ── Constructeurs nommés pour les cas fréquents ──────────────────────────

  /** 404 — ressource non trouvée */
  static notFound(resource = 'Ressource') {
    return new AppError(`${resource} introuvable`, 404, 'NOT_FOUND');
  }

  /** 403 — accès refusé (authentifié mais pas autorisé) */
  static forbidden(msg = 'Accès refusé') {
    return new AppError(msg, 403, 'FORBIDDEN');
  }

  /** 401 — non authentifié */
  static unauthorized(msg = 'Non authentifié') {
    return new AppError(msg, 401, 'UNAUTHORIZED');
  }

  /** 400 — requête invalide */
  static badRequest(msg) {
    return new AppError(msg, 400, 'BAD_REQUEST');
  }

  /** 409 — conflit (doublon, état incompatible) */
  static conflict(msg) {
    return new AppError(msg, 409, 'CONFLICT');
  }

  /** 402 — erreur paiement */
  static payment(msg) {
    return new AppError(msg, 402, 'PAYMENT_ERROR');
  }

  /** 429 — rate limit dépassé */
  static tooMany(msg = 'Trop de requêtes, réessayez plus tard') {
    return new AppError(msg, 429, 'RATE_LIMITED');
  }

  /** 422 — entité non traitable (validation métier) */
  static unprocessable(msg) {
    return new AppError(msg, 422, 'UNPROCESSABLE');
  }
}

// ── Helper: build error response with request ID ────────────────────────────

function buildErrorResponse(res, statusCode, error, code, req) {
  const body = { error, code };
  if (req?.requestId) body.requestId = req.requestId;
  return res.status(statusCode).json(body);
}

// ── Structured error logger ─────────────────────────────────────────────────

function logError(level, req, err, extra = {}) {
  const entry = {
    level,
    timestamp: new Date().toISOString(),
    requestId: req?.requestId || 'unknown',
    method:    req?.method,
    path:      req?.path,
    message:   err.message,
    ...extra,
  };
  if (level === 'error') {
    if (process.env.NODE_ENV !== 'production') entry.stack = err.stack;
    console.error('[ERROR]', JSON.stringify(entry));
  } else {
    console.warn(`[WARN]`, JSON.stringify(entry));
  }
}

// ── Middleware Express d'erreurs centralisé ──────────────────────────────────

/**
 * Doit être monté APRÈS toutes les routes dans server.js :
 *   app.use(errorHandler);
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Réponse déjà envoyée (ex : stream) → on ne peut plus écrire
  if (res.headersSent) return next(err);

  // ── 1. Erreurs métier intentionnelles (AppError) ─────────────────────────
  if (err.isOperational) {
    return buildErrorResponse(res, err.statusCode, err.message, err.code, req);
  }

  // ── 2. CORS ───────────────────────────────────────────────────────────────
  if (err.message?.startsWith('Not allowed by CORS')) {
    logError('warn', req, err, { type: 'cors' });
    return buildErrorResponse(res, 403, 'Origine non autorisée', 'CORS_BLOCKED', req);
  }

  // ── 3. Multer — fichier trop grand ────────────────────────────────────────
  if (err.code === 'LIMIT_FILE_SIZE') {
    return buildErrorResponse(res, 413, 'Fichier trop volumineux (max 5 Mo)', 'FILE_TOO_LARGE', req);
  }

  // ── 4. Multer — format non autorisé (lancé depuis fileFilter) ────────────
  if (err.message?.includes('Format image non supporté') || err.message?.includes('magic bytes')) {
    return buildErrorResponse(res, 415, err.message, 'UNSUPPORTED_MEDIA_TYPE', req);
  }

  // ── 5. Validation Joi ─────────────────────────────────────────────────────
  if (err.isJoi || err.name === 'ValidationError') {
    const msg = err.details?.[0]?.message ?? err.message;
    return buildErrorResponse(res, 400, msg, 'VALIDATION_ERROR', req);
  }

  // ── 6. JWT ────────────────────────────────────────────────────────────────
  if (err.name === 'JsonWebTokenError') {
    return buildErrorResponse(res, 401, 'Token invalide', 'INVALID_TOKEN', req);
  }
  if (err.name === 'TokenExpiredError') {
    return buildErrorResponse(res, 401, 'Token expiré', 'TOKEN_EXPIRED', req);
  }

  // ── 7. PostgreSQL ─────────────────────────────────────────────────────────
  if (err.code === '23505') { // unique_violation
    return buildErrorResponse(res, 409, 'Ressource déjà existante', 'DUPLICATE', req);
  }
  if (err.code === '23503') { // foreign_key_violation
    return buildErrorResponse(res, 400, 'Référence invalide', 'FOREIGN_KEY', req);
  }
  if (err.code === '22P02') { // invalid_text_representation (UUID malformé)
    return buildErrorResponse(res, 400, 'Identifiant invalide (UUID malformé)', 'INVALID_UUID', req);
  }
  if (err.code === '23502') { // not_null_violation
    return buildErrorResponse(res, 400, 'Champ obligatoire manquant', 'MISSING_FIELD', req);
  }
  if (err.code === '42P01') { // undefined_table
    logError('error', req, err, { type: 'db_schema' });
    return buildErrorResponse(res, 500, 'Erreur de schéma base de données', 'DB_SCHEMA_ERROR', req);
  }

  // ── 8. SyntaxError — JSON malformé dans le body ───────────────────────────
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return buildErrorResponse(res, 400, 'JSON invalide dans le body', 'INVALID_JSON', req);
  }

  // ── 9. Erreur non gérée ───────────────────────────────────────────────────
  logError('error', req, err, { type: 'unhandled' });

  return buildErrorResponse(res, 500, 'Erreur serveur interne', 'INTERNAL_ERROR', req);
}

module.exports = { AppError, errorHandler };
