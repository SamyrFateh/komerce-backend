/**
 * @komerce-arch
 * @role          categories-cache
 * @domain        unknown
 * @layer         util
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @db-write      @unknown
 * @db-read      @unknown
 * @used-by       @unknown
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */

'use strict';

/**
 * utils/categories-cache.js
 *
 * DSC-B1 — Invalidation du cache catégories boutique.
 *
 * Stratégie (§4.3 — l'écriture admin se reflète sans redéploiement) :
 *
 *   1. schema_version : entier monotone incrémenté en mémoire à chaque
 *      mutation (POST/PUT/DELETE catégorie ou sous-catégorie).
 *      Exposé dans GET /api/categories sous la clé X-Schema-Version.
 *
 *   2. ETag : dérivé de la version + timestamp de la dernière mutation.
 *      Permet la revalidation If-None-Match côté front.
 *
 *   3. Cache-Control : « no-cache » (revalidation systématique) au lieu de
 *      max-age=300.  Les clients peuvent mettre en cache la réponse mais
 *      doivent revalider à chaque requête → 304 Not Modified si rien n'a changé,
 *      200 + nouvel arbre si la version a changé.
 *
 *   4. Publish/subscribe léger (même pattern que pricing-cache.js) :
 *      les services in-memory s'abonnent via onCategoriesInvalidate().
 *
 * Architecture :
 *   - routes/admin-boutique-categories.js appelle invalidateCategoriesCache()
 *     après chaque mutation réussie.
 *   - routes/categories.js lit getCategoriesETag() et getCategoriesVersion()
 *     pour poser les headers de revalidation.
 */

const log = require('./logger').child({ module: 'categories-cache' });

let _version   = 1;
let _updatedAt = Date.now();
const _callbacks = new Set();

/**
 * Retourne la version courante du schéma catégories.
 * @returns {number}
 */
function getCategoriesVersion() {
  return _version;
}

/**
 * Retourne un ETag stable pour la version courante.
 * Format : "v<version>-<timestamp>"
 * @returns {string}
 */
function getCategoriesETag() {
  return `"v${_version}-${_updatedAt}"`;
}

/**
 * Invalide le cache : incrémente la version et notifie les listeners.
 * Appelé par admin-boutique-categories.js après toute mutation réussie
 * (catégorie ou sous-catégorie : POST / PUT / DELETE).
 */
function invalidateCategoriesCache() {
  _version  += 1;
  _updatedAt = Date.now();
  log.info({ event: 'categories_cache_invalidated', version: _version }, 'Categories schema cache invalidated');
  for (const fn of _callbacks) {
    try { fn(_version); } catch (err) {
      log.warn({ err }, 'Erreur dans un listener de cache catégories');
    }
  }
}

/**
 * Enregistre un callback appelé à chaque invalidation.
 * @param {Function} fn  Reçoit la nouvelle version en argument.
 */
function onCategoriesInvalidate(fn) {
  if (typeof fn === 'function') _callbacks.add(fn);
}

module.exports = {
  getCategoriesVersion,
  getCategoriesETag,
  invalidateCategoriesCache,
  onCategoriesInvalidate,
};
