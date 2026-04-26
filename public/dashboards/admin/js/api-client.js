/**
 * KOMERCE Dashboard — API Client
 * ════════════════════════════════════════════════════════════════════════
 * Wrapper fetch() avec gestion auth (cookie httpOnly), filtres, et erreurs.
 */

(function (global) {
  'use strict';

  const BASE = '/api/admin/dashboard';

  /**
   * Construit une querystring depuis les filtres.
   */
  function buildQueryString(filters) {
    const params = new URLSearchParams();
    Object.entries(filters || {}).forEach(([key, value]) => {
      if (value != null && value !== '') params.set(key, value);
    });
    return params.toString();
  }

  /**
   * Fetch JSON wrapper.
   */
  async function fetchJSON(endpoint, options = {}) {
    const filters = options.filters || {};
    const refresh = options.refresh ? '&refresh=1' : '';
    const qs = buildQueryString(filters);
    const url = `${BASE}/${endpoint}${qs ? '?' + qs : ''}${qs && refresh ? refresh : (refresh ? '?' + refresh.slice(1) : '')}`;

    try {
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) {
        const body = await res.text();
        throw new ApiError(`${res.status} ${res.statusText}`, res.status, body);
      }

      return await res.json();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(err.message || 'Network error', 0, null);
    }
  }

  class ApiError extends Error {
    constructor(message, status, body) {
      super(message);
      this.status = status;
      this.body = body;
    }
  }

  // === API endpoints ===

  async function getControlTower(filters, options) {
    return fetchJSON('control-tower', { filters, ...options });
  }
  async function getCosting(filters, options) {
    return fetchJSON('costing', { filters, ...options });
  }
  async function getLogistics(filters, options) {
    return fetchJSON('logistics', { filters, ...options });
  }
  async function getEventWorkspaces(filters, options) {
    return fetchJSON('event-workspaces', { filters, ...options });
  }
  async function getUnified(filters, options) {
    return fetchJSON('unified', { filters, ...options });
  }
  async function clearCache(prefix) {
    const res = await fetch(`${BASE}/cache/clear`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix }),
    });
    return res.ok ? await res.json() : null;
  }

  global.KmcApi = {
    getControlTower,
    getCosting,
    getLogistics,
    getEventWorkspaces,
    getUnified,
    clearCache,
    ApiError,
  };
})(window);
