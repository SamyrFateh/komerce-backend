/**
 * @komerce-arch
 * @role          auth-csrf-origin-guard
 * @domain        auth
 * @layer         middleware
 * @criticality   high
 * @inputs        http_method, auth_cookie, origin_header
 * @outputs       allow_or_403
 * @depends       bootstrap/security.js, utils/auth-cookie.js
 * @db-read       none
 * @db-write      none
 * @doctrine      cookie_auth_mutations_require_trusted_origin, bearer_not_csrf_surface
 * @impact-areas  auth, all-api
 * @version       2026-08
 */

'use strict';

const { isAllowedOrigin } = require('../bootstrap/security');
const { AUTH_COOKIE_NAME } = require('../utils/auth-cookie');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * AUTH-8b — défense CSRF explicite pour la session navigateur.
 *
 * SameSite=Lax reste volontairement compatible avec les navigations entrantes
 * depuis WhatsApp / email. En contrepartie, toute mutation qui transporte le
 * cookie de session Komerce doit provenir d'une Origin explicitement autorisée.
 *
 * Le guard ne s'applique pas aux appels sans cookie d'authentification :
 * - webhooks / server-to-server n'ont pas de surface CSRF navigateur ;
 * - les clients API Bearer sont audités séparément en AUTH-8e.
 */
function csrfOriginGuard(req, res, next) {
  const method = String(req.method || 'GET').toUpperCase();
  if (SAFE_METHODS.has(method)) return next();

  const hasAuthCookie = Boolean(req.cookies && req.cookies[AUTH_COOKIE_NAME]);
  if (!hasAuthCookie) return next();

  const origin = typeof req.get === 'function'
    ? req.get('origin')
    : req.headers && req.headers.origin;

  if (!origin) {
    return res.status(403).json({
      error: 'Origine requise pour cette opération authentifiée',
      code: 'csrf_origin_required',
    });
  }

  if (!isAllowedOrigin(origin)) {
    return res.status(403).json({
      error: 'Origine non autorisée',
      code: 'csrf_origin_invalid',
    });
  }

  return next();
}

module.exports = {
  csrfOriginGuard,
  SAFE_METHODS,
};
