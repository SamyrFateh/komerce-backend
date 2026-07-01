/**
 * @komerce-arch
 * @role          auth-validate
 * @domain        infrastructure
 * @layer         middleware
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @db-write      @unknown
 * @db-read      @unknown
 * @used-by       @unknown
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  auth
 * @version       2026-06
 */

/**
 * KOMERCE — Middleware de validation centralisé
 * 
 * Usage dans les routes :
 *   const { validate } = require('../middleware/validate');
 *   const { createOrder } = require('../validators/orders');
 *   router.post('/', authenticate, validate(createOrder), async (req, res) => { ... });
 * 
 * Fonctionnalités :
 *   · Validation de schéma (Joi) sur body, params, query
 *   · Sanitisation automatique (trim, strip HTML, normalisation)
 *   · Messages d'erreur en français
 *   · Réponse JSON structurée en cas d'erreur
 */

'use strict';

// ── Sanitisation ────────────────────────────────────────────────────────────────

/**
 * Nettoie une valeur string :
 * - Trim whitespace
 * - Supprime les balises HTML/scripts
 * - Normalise les espaces multiples
 * - Limite la longueur maximale
 */
function sanitizeString(value, maxLength = 10000) {
  if (typeof value !== 'string') return value;
  return value
    .trim()
    .replace(/<[^>]*>/g, '')               // strip HTML tags
    .replace(/&[a-z]+;/gi, '')             // strip HTML entities
    .replace(/javascript\s*:/gi, '')        // strip javascript: URIs
    .replace(/on\w+\s*=/gi, '')            // strip inline event handlers
    .replace(/\s+/g, ' ')                  // normalize whitespace
    .slice(0, maxLength);                  // enforce max length
}

/**
 * Sanitise récursivement un objet (body, query, params)
 */
function sanitizeDeep(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitizeString(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeDeep);
  if (typeof obj === 'object') {
    const clean = {};
    for (const [key, val] of Object.entries(obj)) {
      // Sanitiser aussi les clés (anti-prototype pollution)
      const cleanKey = sanitizeString(key, 100);
      if (cleanKey === '__proto__' || cleanKey === 'constructor' || cleanKey === 'prototype') continue;
      clean[cleanKey] = sanitizeDeep(val);
    }
    return clean;
  }
  return obj;
}

// ── Middleware de validation ─────────────────────────────────────────────────────

/**
 * Crée un middleware Express qui :
 * 1. Sanitise les entrées (body, params, query)
 * 2. Valide contre un schéma Joi
 * 3. Remplace req.body par les valeurs nettoyées + validées
 * 4. Retourne 400 avec détails si invalide
 * 
 * @param {Object} schema - { body?, params?, query? } chacun un schéma Joi
 * @param {Object} options - { stripUnknown: true, sanitize: true }
 */
function validate(schema, options = {}) {
  const { stripUnknown = true, sanitize = true } = options;

  return (req, res, next) => {
    // Étape 1 : Sanitisation
    if (sanitize) {
      if (req.body && typeof req.body === 'object') req.body = sanitizeDeep(req.body);
      if (req.query && typeof req.query === 'object') req.query = sanitizeDeep(req.query);
      // params : pas de sanitize deep, juste trim
      if (req.params) {
        for (const key of Object.keys(req.params)) {
          if (typeof req.params[key] === 'string') {
            req.params[key] = req.params[key].trim();
          }
        }
      }
    }

    // Étape 2 : Validation Joi
    const errors = [];

    for (const source of ['body', 'params', 'query']) {
      if (!schema[source]) continue;

      const { error, value } = schema[source].validate(req[source], {
        abortEarly: false,
        stripUnknown,
        allowUnknown: !stripUnknown,
        messages: {
          'any.required': '{{#label}} est obligatoire',
          'string.empty': '{{#label}} ne peut pas être vide',
          'string.email': '{{#label}} doit être un email valide',
          'string.min': '{{#label}} doit contenir au moins {{#limit}} caractères',
          'string.max': '{{#label}} ne peut pas dépasser {{#limit}} caractères',
          'string.uri': '{{#label}} doit être une URL valide',
          'number.min': '{{#label}} doit être supérieur ou égal à {{#limit}}',
          'number.max': '{{#label}} ne peut pas dépasser {{#limit}}',
          'number.positive': '{{#label}} doit être un nombre positif',
          'number.integer': '{{#label}} doit être un nombre entier',
          'array.min': '{{#label}} doit contenir au moins {{#limit}} élément(s)',
          'any.only': '{{#label}} doit être une des valeurs : {{#valids}}',
        },
      });

      if (error) {
        errors.push(...error.details.map(d => ({
          source,
          field: d.path.join('.'),
          message: d.message,
          type: d.type,
        })));
      } else {
        req[source] = value; // Remplacer par les valeurs nettoyées
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Données invalides',
        details: errors,
        hint: 'Vérifiez les champs listés ci-dessous et réessayez.',
      });
    }

    next();
  };
}

/**
 * Middleware de sanitisation pure (sans validation Joi).
 * Utile pour les routes où on veut juste nettoyer sans schéma strict.
 */
function sanitize() {
  return (req, _res, next) => {
    if (req.body && typeof req.body === 'object') req.body = sanitizeDeep(req.body);
    if (req.query && typeof req.query === 'object') req.query = sanitizeDeep(req.query);
    next();
  };
}

module.exports = { validate, sanitize, sanitizeString, sanitizeDeep };
