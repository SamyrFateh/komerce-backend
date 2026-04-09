/**
 * KOMERCE — Gestion centralisée des erreurs (Vague 3)
 * TEMPORARY DEBUG VERSION — shows error details
 */

'use strict';

class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name        = 'AppError';
    this.statusCode  = statusCode;
    this.code        = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
  static notFound(resource = 'Ressource') { return new AppError(`${resource} introuvable`, 404, 'NOT_FOUND'); }
  static forbidden(msg = 'Accès refusé') { return new AppError(msg, 403, 'FORBIDDEN'); }
  static unauthorized(msg = 'Non authentifié') { return new AppError(msg, 401, 'UNAUTHORIZED'); }
  static badRequest(msg) { return new AppError(msg, 400, 'BAD_REQUEST'); }
  static conflict(msg) { return new AppError(msg, 409, 'CONFLICT'); }
  static payment(msg) { return new AppError(msg, 402, 'PAYMENT_ERROR'); }
  static tooMany(msg = 'Trop de requêtes, réessayez plus tard') { return new AppError(msg, 429, 'RATE_LIMITED'); }
  static unprocessable(msg) { return new AppError(msg, 422, 'UNPROCESSABLE'); }
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err.isOperational) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }
  if (err.message?.startsWith('Not allowed by CORS')) {
    return res.status(403).json({ error: 'Origine non autorisée', code: 'CORS_BLOCKED' });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Fichier trop volumineux (max 5 Mo)', code: 'FILE_TOO_LARGE' });
  }
  if (err.message?.includes('Format image non supporté') || err.message?.includes('magic bytes')) {
    return res.status(415).json({ error: err.message, code: 'UNSUPPORTED_MEDIA_TYPE' });
  }
  if (err.isJoi || err.name === 'ValidationError') {
    const msg = err.details?.[0]?.message ?? err.message;
    return res.status(400).json({ error: msg, code: 'VALIDATION_ERROR' });
  }
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Token invalide', code: 'INVALID_TOKEN' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token expiré', code: 'TOKEN_EXPIRED' });
  }
  if (err.code === '23505') { return res.status(409).json({ error: 'Ressource déjà existante', code: 'DUPLICATE' }); }
  if (err.code === '23503') { return res.status(400).json({ error: 'Référence invalide', code: 'FOREIGN_KEY' }); }
  if (err.code === '22P02') { return res.status(400).json({ error: 'Identifiant invalide (UUID malformé)', code: 'INVALID_UUID' }); }
  if (err.code === '23502') { return res.status(400).json({ error: 'Champ obligatoire manquant', code: 'MISSING_FIELD' }); }
  if (err.code === '42P01') { return res.status(500).json({ error: 'Erreur de schéma base de données', code: 'DB_SCHEMA_ERROR' }); }
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'JSON invalide dans le body', code: 'INVALID_JSON' });
  }

  // ── DEBUG: Return actual error details ────────────────────────────────────
  console.error('[ERROR] Unhandled exception:', {
    method:  req.method,
    path:    req.path,
    message: err.message,
    stack:   err.stack,
  });

  return res.status(500).json({
    error: 'Erreur serveur interne',
    code: 'INTERNAL_ERROR',
    _debug_message: err.message,
    _debug_stack: err.stack?.split('\n').slice(0, 5),
  });
}

module.exports = { AppError, errorHandler };
