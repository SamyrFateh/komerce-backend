'use strict';

/**
 * AUTH-8a — Source unique de vérité du cookie d'authentification Komerce.
 *
 * Pourquoi ce module existe :
 *   Avant AUTH-8, le même cookie « kmrc_jwt » était émis avec des options
 *   différentes dans auth.js (Strict), otp.js (lax) et client-auth.js (lax inline).
 *   Les 4 middlewares de lecture hardcodaient le nom.
 *   → Incohérence de SameSite, pas de __Host-, duplication de logique.
 *
 * Politique actuelle (AUTH-8b ; durcissements complémentaires en AUTH-8c/d) :
 *   - sameSite par défaut = 'Lax'  (compatible liens WhatsApp & magic-link, cf. GOV-07)
 *   - httpOnly = true (toujours — JAMAIS exposé au JS)
 *   - secure = true en production
 *   - __Host- : pas encore activé (AUTH-8c, nécessite HTTPS partout)
 *
 * Usage :
 *   const { setAuthCookie, clearAuthCookie, readAuthToken } = require('../utils/auth-cookie');
 *   setAuthCookie(res, token);            // politique par défaut (Lax)
 *   setAuthCookie(res, token, 'Strict');  // forcer Strict si le parcours le permet
 *   clearAuthCookie(res);
 *   const token = readAuthToken(req);     // cookie OU Bearer
 */

const COOKIE_NAME = 'kmrc_jwt';

// --- Options ----------------------------------------------------------------

function _isProd() {
  return process.env.NODE_ENV === 'production';
}

function _parseMaxAge() {
  const raw = process.env.JWT_EXPIRES || '30d';
  const match = raw.match(/(\d+)(d|h|m)/);
  if (!match) return 30 * 24 * 60 * 60 * 1000;        // fallback 30j
  const val = parseInt(match[1], 10);
  if (match[2] === 'd') return val * 24 * 60 * 60 * 1000;
  if (match[2] === 'h') return val * 60 * 60 * 1000;
  if (match[2] === 'm') return val * 60 * 1000;
  return 30 * 24 * 60 * 60 * 1000;
}

/**
 * Construit les options du cookie.
 * @param {'Strict'|'Lax'} [sameSite='Lax'] — Lax par défaut (compatible cross-site
 *   top-level navigation : liens WhatsApp, magic-links email). Passer 'Strict'
 *   uniquement sur les parcours dont on sait qu'ils ne viennent pas d'une
 *   navigation cross-site entrante.
 */
function cookieOptions(sameSite = 'Lax') {
  return {
    httpOnly: true,
    secure:   _isProd(),
    sameSite,
    maxAge:   _parseMaxAge(),
    path:     '/',
  };
}

// --- Émission / suppression / lecture ----------------------------------------

function setAuthCookie(res, token, sameSite) {
  res.cookie(COOKIE_NAME, token, cookieOptions(sameSite));
}

function clearAuthCookie(res) {
  // Les options de clear doivent correspondre à celles de set (hors maxAge).
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: _isProd(), path: '/' });
}

/**
 * Extrait le token JWT de la requête :
 *   1) cookie httpOnly (prioritaire, sûr)
 *   2) header Authorization: Bearer (pour clients API légitimes)
 * Retourne null si rien trouvé.
 */
function readAuthToken(req) {
  if (req.cookies && req.cookies[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  const header = req.headers && req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.split(' ')[1];
  return null;
}

// --- Exports -----------------------------------------------------------------

module.exports = {
  AUTH_COOKIE_NAME: COOKIE_NAME,
  cookieOptions,
  setAuthCookie,
  clearAuthCookie,
  readAuthToken,
};
