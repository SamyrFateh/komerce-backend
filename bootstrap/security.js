/**
 * @komerce-arch
 * @role          bootstrap-security
 * @domain        infrastructure
 * @layer         bootstrap
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @db-write      @unknown
 * @db-read      @unknown
 * @used-by       @unknown
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  bootstrap
 * @version       2026-06
 */

'use strict';

const cors = require('cors');
const helmet = require('helmet');

function isAllowedOrigin(origin, frontendUrl = process.env.FRONTEND_URL || '', allowedOrigins = process.env.ALLOWED_ORIGINS || '') {
  if (!origin) return true;
  if (process.env.NODE_ENV !== 'production' && /^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
  if (frontendUrl && origin === frontendUrl) return true;
  if (allowedOrigins) {
    const allowed = allowedOrigins.split(',').map(s => s.trim()).filter(Boolean);
    if (allowed.includes(origin)) return true;
  }
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
