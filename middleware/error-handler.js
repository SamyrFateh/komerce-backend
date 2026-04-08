/**
 * KOMERCE — Gestion centralisée des erreurs (Vague 3)
 *
 * AppError   : classe d'erreur métier intentionnelle et typée
 * errorHandler : middleware Express final — monté après toutes les routes dans server.js
 *
 * Conventions :
 *   - err.isOperational = true  → erreur connue, message safe à envoyer au client
 *   - err.isOperational = false → bug inattendu → log complet + 500 générique
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
    return res.status(err.statusCode).json({
      error: err.message,
      code:  err.code,
    });
  }

  // ── 2. CORS ───────────────────────────────────────────────────────────────
  if (err.message?.startsWith('Not allowed by CORS')) {
    console.warn('[CORS] Blocked:', err.message);
    return res.status(403).json({ error: 'Origine non autorisée', code: 'CORS_BLOCKED' });
  }

  // ── 3. Multer — fichier trop grand ────────────────────────────────────────
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Fichier trop volumineux (max 5 Mo)', code: 'FILE_TOO_LARGE' });
  }

  // ── 4. Multer — format non autorisé (lancé depuis fileFilter) ────────────
  if (err.message?.includes('Format image non supporté') || err.message?.includes('magic bytes')) {
    return res.status(415).json({ error: err.message, code: 'UNSUPPORTED_MEDIA_TYPE' });
  }

  // ── 5. Validation Joi ─────────────────────────────────────────────────────
  if (err.isJoi || err.name === 'ValidationError') {
    const msg = err.details?.[0]?.message ?? err.message;
    return res.status(400).json({ error: msg, code: 'VALIDATION_ERROR' });
  }

  // ── 6. JWT ────────────────────────────────────────────────────────────────
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Token invalide', code: 'INVALID_TOKEN' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token expiré', code: 'TOKEN_EXPIRED' });
  }

  // ── 7. PostgreSQL ─────────────────────────────────────────────────────────
  if (err.code === '23505') { // unique_violation
    return res.status(409).json({ error: 'Ressource déjà existante', code: 'DUPLICATE' });
  }
  if (err.code === '23503') { // foreign_key_violation
    return res.status(400).json({ error: 'Référence invalide', code: 'FOREIGN_KEY' });
  }
  if (err.code === '22P02') { // invalid_text_representation (UUID malformé)
    return res.status(400).json({ error: 'Identifiant invalide (UUID malformé)', code: 'INVALID_UUID' });
  }
  if (err.code === '23502') { // not_null_violation
    return res.status(400).json({ error: 'Champ obligatoire manquant', code: 'MISSING_FIELD' });
  }
  if (err.code === '42P01') { // undefined_table
    return res.status(500).json({ error: 'Erreur de schéma base de données', code: 'DB_SCHEMA_ERROR' });
  }

  // ── 8. SyntaxError — JSON malformé dans le body ───────────────────────────
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'JSON invalide dans le body', code: 'INVALID_JSON' });
  }

  // ── 9. Erreur non gérée ───────────────────────────────────────────────────
  console.error('[ERROR] Unhandled exception:', {
    method:  req.method,
    path:    req.path,
    message: err.message,
    stack:   process.env.NODE_ENV !== 'production' ? err.stack : '(masqué en prod)',
  });

  return res.status(500).json({ error: 'Erreur serveur interne', code: 'INTERNAL_ERROR' });
}

module.exports = { AppError, errorHandler };
