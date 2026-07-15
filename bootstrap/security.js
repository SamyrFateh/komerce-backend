/**
 * @komerce-arch
 * @role          bootstrap-security
 * @domain        infrastructure
 * @layer         bootstrap
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       none
 * @db-write      none
 * @db-read      none
 * @used-by       server.js
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  bootstrap
 * @version       2026-06
 */

'use strict';

const cors = require('cors');
const helmet = require('helmet');

// Filet de sécurité : domaine(s) de production toujours autorisés, même si
// FRONTEND_URL / ALLOWED_ORIGINS sont absents ou mal configurés au niveau
// de l'environnement de déploiement.
//
// BUGFIX 2026-07 : Safari/WebKit envoie l'en-tête Origin même pour des
// requêtes fetch same-origin dès lors que credentials:'include' est utilisé
// (cf. public/boutique/js/komerce-api.js → _doFetch). Chrome/Firefox
// n'envoient pas cet en-tête pour un GET same-origin classique, donc le
// bug restait invisible sur ces navigateurs. Si FRONTEND_URL n'était pas
// positionnée à https://komerce.co en production, isAllowedOrigin()
// refusait alors cette Origin légitime → la réponse cors() n'incluait pas
// Access-Control-Allow-Origin → Safari bloquait le fetch avec
// "... due to access control checks." (ex. sur GET /api/relais/public,
// provoquant une erreur console bloquante détectée par le test E27).
const DEFAULT_ALLOWED_ORIGINS = ['https://komerce.co', 'https://www.komerce.co'];

function isAllowedOrigin(origin, frontendUrl = process.env.FRONTEND_URL || '', allowedOrigins = process.env.ALLOWED_ORIGINS || '') {
  if (!origin) return true;
  if (process.env.NODE_ENV !== 'production' && /^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
  if (frontendUrl && origin === frontendUrl) return true;
  if (allowedOrigins) {
    const allowed = allowedOrigins.split(',').map(s => s.trim()).filter(Boolean);
    if (allowed.includes(origin)) return true;
  }
  if (DEFAULT_ALLOWED_ORIGINS.includes(origin)) return true;
  return false;
}

function buildCorsOptions() {
  return {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Not allowed by CORS: ${origin}`));
      }
    },
    methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  };
}

function buildHelmetOptions() {
  return {
    contentSecurityPolicy: {
      directives: {
        defaultSrc:  ["'self'"],
        // FRESH-030 / AUD-04: 'unsafe-inline' retiré — script QR externalisé dans public/js/qr-viewer.js.
        //   Si un nouveau script inline est nécessaire, utiliser un nonce CSP généré par le serveur.
        scriptSrc:   ["'self'", "https://cdnjs.cloudflare.com", "https://unpkg.com", "https://cdn.jsdelivr.net", "https://js.stripe.com", "https://www.paypal.com", "https://www.paypalobjects.com"],
        styleSrc:    ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc:     ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com", "data:"],
        imgSrc:      ["'self'", "data:", "https:", "http:"],
        connectSrc:  ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com", "https://unpkg.com", "https://cdn.jsdelivr.net", "https://api.stripe.com", "https://www.paypal.com", "https://api.paypal.com", "https://api.sandbox.paypal.com"],
        frameSrc:    ["'self'", "https://js.stripe.com", "https://hooks.stripe.com", "https://www.paypal.com", "https://www.sandbox.paypal.com"],
        mediaSrc:    ["'self'"],
        objectSrc:   ["'none'"],
        frameAncestors: ["'none'"],
        baseUri:     ["'self'"],
        formAction:  ["'self'"],
        // FRESH-030: scriptSrcAttr — 'unsafe-inline' retiré; event handlers inline à externaliser
        scriptSrcAttr: ["'none'"],
      },
    },
  };
}

function applySecurity(app) {
  app.use(helmet(buildHelmetOptions()));
  app.use(cors(buildCorsOptions()));
}

module.exports = {
  isAllowedOrigin,
  buildCorsOptions,
  buildHelmetOptions,
  applySecurity,
};
