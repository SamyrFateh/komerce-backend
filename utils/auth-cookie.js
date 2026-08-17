'use strict';

/**
 * AUTH-8 — Source unique de vérité du cookie d'authentification Komerce.
 *
 * Politique :
 *   - SameSite=Lax : compatible avec les navigations entrantes WhatsApp/email ;
 *     les mutations cookie sont protégées séparément par AUTH-8b (Origin).
 *   - httpOnly=true : le JWT n'est jamais exposé au JavaScript.
 *   - staging/production : cookie `__Host-kmrc_jwt`, Secure, Path=/, sans Domain.
 *   - development/test : cookie `kmrc_jwt` pour rester utilisable en HTTP local.
 *   - si KOMERCE_ENV est absent, NODE_ENV=production conserve un comportement
 *     sécurisé et active aussi le préfixe __Host- (compatibilité fail-closed).
 *
 * Le runtime sécurisé ne lit PAS l'ancien cookie `kmrc_jwt` : le passage à
 * __Host- invalide volontairement les anciennes sessions une fois, plutôt que
 * de maintenir une fenêtre de compatibilité qui annulerait le durcissement.
 */

const LEGACY_COOKIE_NAME = 'kmrc_jwt';
const HOST_COOKIE_NAME = '__Host-kmrc_jwt';
const SECURE_KOMERCE_ENVS = new Set(['staging', 'production']);

// --- Runtime / options -------------------------------------------------------

function _useHostCookie() {
  const komerceEnv = String(process.env.KOMERCE_ENV || '').trim().toLowerCase();
  if (komerceEnv) return SECURE_KOMERCE_ENVS.has(komerceEnv);
  return process.env.NODE_ENV === 'production';
}

function _isSecureRuntime() {
  return _useHostCookie() || process.env.NODE_ENV === 'production';
}

function getAuthCookieName() {
  return _useHostCookie() ? HOST_COOKIE_NAME : LEGACY_COOKIE_NAME;
}

function _parseMaxAge() {
  const raw = process.env.JWT_EXPIRES || '30d';
  const match = raw.match(/(\d+)(d|h|m)/);
  if (!match) return 30 * 24 * 60 * 60 * 1000;
  const val = parseInt(match[1], 10);
  if (match[2] === 'd') return val * 24 * 60 * 60 * 1000;
  if (match[2] === 'h') return val * 60 * 60 * 1000;
  if (match[2] === 'm') return val * 60 * 1000;
  return 30 * 24 * 60 * 60 * 1000;
}

/**
 * @param {'Strict'|'Lax'} [sameSite='Lax']
 */
function cookieOptions(sameSite = 'Lax') {
  return {
    httpOnly: true,
    secure: _isSecureRuntime(),
    sameSite,
    maxAge: _parseMaxAge(),
    path: '/',
    // IMPORTANT __Host- : ne jamais ajouter Domain ici.
  };
}

function _clearOptions() {
  return {
    httpOnly: true,
    secure: _isSecureRuntime(),
    path: '/',
  };
}

// --- Émission / suppression / lecture ---------------------------------------

function setAuthCookie(res, token, sameSite) {
  res.cookie(getAuthCookieName(), token, cookieOptions(sameSite));
}

function clearAuthCookie(res) {
  const activeName = getAuthCookieName();
  res.clearCookie(activeName, _clearOptions());

  // Lors du déploiement AUTH-8c, purge explicite de l'ancien cookie. Il n'est
  // jamais lu en runtime __Host-, mais le supprimer évite de laisser un artefact
  // ambigu dans le navigateur jusqu'à son expiration naturelle.
  if (activeName === HOST_COOKIE_NAME) {
    res.clearCookie(LEGACY_COOKIE_NAME, {
      httpOnly: true,
      secure: true,
      path: '/',
    });
  }
}

/**
 * Extrait le JWT :
 *   1) cookie httpOnly actif pour CE runtime ;
 *   2) Bearer (surface auditée séparément en AUTH-8e).
 *
 * Un runtime __Host- ne retombe jamais sur `kmrc_jwt`.
 */
function readAuthToken(req) {
  const cookieName = getAuthCookieName();
  if (req.cookies && req.cookies[cookieName]) return req.cookies[cookieName];

  const header = req.headers && req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice('Bearer '.length);
  return null;
}

module.exports = {
  // Compatibilité de code pour les consommateurs historiques : ce nom désigne
  // explicitement le cookie local/legacy. Le code runtime doit appeler
  // getAuthCookieName().
  AUTH_COOKIE_NAME: LEGACY_COOKIE_NAME,
  LEGACY_AUTH_COOKIE_NAME: LEGACY_COOKIE_NAME,
  HOST_AUTH_COOKIE_NAME: HOST_COOKIE_NAME,
  getAuthCookieName,
  cookieOptions,
  setAuthCookie,
  clearAuthCookie,
  readAuthToken,
};
