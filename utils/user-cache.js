/**
 * @komerce-arch
 * @role          user-cache
 * @domain        auth
 * @layer         util
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @db-write      none
 * @db-read      none
 * @used-by       @unknown
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  auth
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — Cache utilisateur partagé (utils/user-cache.js)
 * ═══════════════════════════════════════════════════════════
 * N2 FIX : auth.js et auth-guest.js avaient chacun leur propre Map
 * indépendante. Un appel à invalidateUserCache() dans l'un n'invalidait
 * pas l'autre — ex : rôle promu via admin → l'autre middleware servait
 * l'ancien rôle pendant 5 min supplémentaires.
 *
 * Ce module est la source de vérité unique pour le cache user.
 * auth.js et auth-guest.js l'importent tous les deux.
 */

const USER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const _cache = new Map();

function get(userId) {
  const entry = _cache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.ts > USER_CACHE_TTL) {
    _cache.delete(userId);
    return null;
  }
  return entry.user;
}

function set(userId, user) {
  _cache.set(userId, { user, ts: Date.now() });
  // Évite une fuite mémoire si le process tourne longtemps
  if (_cache.size > 10_000) {
    _cache.delete(_cache.keys().next().value);
  }
}

function invalidate(userId) {
  _cache.delete(userId);
}

function invalidateAll() {
  _cache.clear();
}

module.exports = { get, set, invalidate, invalidateAll };
