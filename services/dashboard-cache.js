/**
 * @komerce-arch
 * @role          dashboard-dashboard-cache
 * @domain        dashboard
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @db-read       none
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard
 * @version       2026-06
 */

/**
 * KOMERCE — Dashboard Cache (Sprint 1)
 * ════════════════════════════════════════════════════════════════════════
 *
 * Cache en memoire pour les endpoints /api/admin/dashboard/*
 * TTL : 30 secondes par defaut.
 *
 * Bypass :
 *   - Query param ?refresh=1
 *   - Header Cache-Control: no-cache
 *   - POST /api/admin/dashboard/cache/clear (admin)
 *
 * Invalidation auto :
 *   - Apres allocation shipment, parcel, monthly_fixed_costs
 *   - Apres recalibration apply
 *   - Apres workspace finalize / order_created
 *
 * NOTE : cache par worker process (Map JS). Si plusieurs workers Railway,
 * la coherence inter-workers max = 30s. Acceptable en V1.
 */

'use strict';

const cache = new Map();
const DEFAULT_TTL_MS = 30 * 1000;

/**
 * Construit une cle de cache stable depuis endpoint + filtres.
 */
function buildCacheKey(endpoint, filters = {}) {
  // Normaliser les filtres pour key stable
  const sorted = Object.keys(filters || {}).sort().reduce((acc, k) => {
    if (filters[k] != null && filters[k] !== '') acc[k] = filters[k];
    return acc;
  }, {});
  return `dashboard:${endpoint}:${JSON.stringify(sorted)}`;
}

/**
 * Recupere une entree de cache si encore valide.
 * @returns {{data, generatedAt, ageMs}|null}
 */
function get(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  const ageMs = Date.now() - entry.generatedAt;
  if (ageMs > entry.ttlMs) {
    cache.delete(key);
    return null;
  }
  return {
    data: entry.data,
    generatedAt: entry.generatedAt,
    ageMs,
    ttlMs: entry.ttlMs,
  };
}

/**
 * Stocke une reponse en cache.
 */
function set(key, data, ttlMs = DEFAULT_TTL_MS) {
  cache.set(key, {
    data,
    generatedAt: Date.now(),
    ttlMs,
  });
}

/**
 * Invalide tout ou partie du cache.
 * @param {string|null} prefix - prefixe optionnel ex 'dashboard:control-tower'
 *                                Si null, vide tout.
 * @returns {number} nombre d'entrees supprimees
 */
function clear(prefix = null) {
  if (prefix == null) {
    const n = cache.size;
    cache.clear();
    return n;
  }
  let n = 0;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      n++;
    }
  }
  return n;
}

/**
 * Invalide les caches dashboard (utilise par les POST critiques).
 */
function invalidateAllDashboards() {
  return clear('dashboard:');
}

/**
 * Stats utiles pour debug / monitoring.
 */
function stats() {
  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
  };
}

/**
 * Middleware Express pour cacher les reponses GET dashboard.
 * Usage:
 *   router.get('/control-tower', cacheMiddleware('control-tower'), handler)
 *
 * Le handler doit appeler res.json(data). Le middleware cache automatiquement.
 */
function cacheMiddleware(endpointName) {
  return async function (req, res, next) {
    // Bypass cache si demande
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const noCacheHeader = (req.headers['cache-control'] || '').includes('no-cache');
    if (refresh || noCacheHeader) {
      res.locals._cacheBypass = true;
      return next();
    }

    // Construire la cle
    const filters = {
      from: req.query.from,
      to: req.query.to,
      island: req.query.island,
      relais_id: req.query.relais_id,
      status: req.query.status,
      payment_status: req.query.payment_status,
      cost_status: req.query.cost_status,
      channel: req.query.channel,
      origin: req.query.origin,
    };
    const key = buildCacheKey(endpointName, filters);
    res.locals._cacheKey = key;

    const hit = get(key);
    if (hit) {
      // Enrichir data_quality avec metadata cache
      const data = { ...hit.data };
      if (data.data_quality) {
        data.data_quality = {
          ...data.data_quality,
          is_cached: true,
          cache_age_seconds: Math.floor(hit.ageMs / 1000),
          cache_ttl_seconds: Math.floor(hit.ttlMs / 1000),
        };
      }
      return res.json(data);
    }

    // Pas de hit : intercepter res.json pour stocker en cache
    const originalJson = res.json.bind(res);
    res.json = function (data) {
      // Enrichir data_quality
      if (data && typeof data === 'object') {
        data.data_quality = {
          ...(data.data_quality || {}),
          is_cached: false,
          cache_age_seconds: 0,
          cache_ttl_seconds: Math.floor(DEFAULT_TTL_MS / 1000),
        };
      }
      // Stocker en cache (si pas bypass et reponse OK)
      if (!res.locals._cacheBypass && res.statusCode < 400) {
        set(key, data);
      }
      return originalJson(data);
    };

    next();
  };
}

module.exports = {
  buildCacheKey,
  get,
  set,
  clear,
  invalidateAllDashboards,
  stats,
  cacheMiddleware,
  DEFAULT_TTL_MS,
};
