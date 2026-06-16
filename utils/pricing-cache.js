/**
 * @komerce-arch
 * @role          economic-engine-pricing-cache
 * @domain        economic-engine
 * @layer         util
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @db-write      @unknown
 * @db-read      @unknown
 * @used-by       @unknown
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine
 * @version       2026-06
 */

'use strict';

/**
 * utils/pricing-cache.js
 *
 * Invalidation du cache pricing matrices (pricing_category_taxes + pricing_category_dims).
 * Appelé par routes/admin-pricing-matrices.js après toute mutation.
 *
 * Architecture : publish/subscribe léger.
 * Les services qui maintiennent un cache in-memory s'abonnent via onInvalidate().
 * Si aucun service n'a de cache, invalidatePricingMatricesCache() est un no-op propre
 * (plus de TypeError silencieux).
 */

const log = require('./logger').child({ module: 'pricing-cache' });

const _callbacks = new Set();

/**
 * Enregistre un callback appelé à chaque invalidation.
 * @param {Function} fn
 */
function onInvalidate(fn) {
  if (typeof fn === 'function') _callbacks.add(fn);
}

/**
 * Invalide le cache des matrices pricing.
 * Appelé après UPDATE pricing_category_taxes / pricing_category_dims.
 * Déclenche tous les callbacks enregistrés.
 */
function invalidatePricingMatricesCache() {
  log.info({ event: 'pricing_matrices_cache_invalidated' }, 'Pricing matrices cache invalidated');
  for (const fn of _callbacks) {
    try { fn(); } catch (err) {
      log.warn({ err }, 'Erreur dans un listener de cache pricing matrices');
    }
  }
}

module.exports = { invalidatePricingMatricesCache, onInvalidate };
