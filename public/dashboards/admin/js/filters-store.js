/**
 * @komerce-arch
 * @role          admin-filter-state-store
 * @domain        admin-dashboard
 * @layer         state-store
 * @criticality   high
 * @inputs        url_query_params (from, to, island, relais_id, status, payment_status, cost_status, channel, origin)
 * @outputs       filter_state_object, change_notifications_to_subscribers
 * @depends       none
 * @used-by       app.js, all views (via global KmcFilters)
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      kmc_api_only
 * @impact-areas  admin-dashboard, date-filtering, all-views
 * @version       2026-06
 */
/**
 * KOMERCE Dashboard — Filters Store
 * ════════════════════════════════════════════════════════════════════════
 * Etat global des filtres dashboard, synchronisé avec l'URL (?from=...&to=...).
 * Pattern observable simple (subscribe/notify).
 */

(function (global) {
  'use strict';

  const FILTER_KEYS = [
    'from', 'to', 'island', 'relais_id', 'status',
    'payment_status', 'cost_status', 'channel', 'origin',
  ];

  let state = {};
  const listeners = new Set();

  /**
   * Initialise depuis l'URL ou des defaults.
   */
  function init(defaults = {}) {
    const urlParams = new URLSearchParams(window.location.search);
    state = { ...defaults };
    FILTER_KEYS.forEach(k => {
      const v = urlParams.get(k);
      if (v != null && v !== '') state[k] = v;
    });
    // Defaults si rien
    if (!state.from && !state.to) {
      const today = new Date();
      const sevenDaysAgo = new Date(today.getTime() - 7 * 86400000);
      state.from = sevenDaysAgo.toISOString().slice(0, 10);
      state.to = today.toISOString().slice(0, 10);
    }
    return state;
  }

  function get() {
    return { ...state };
  }

  function set(updates) {
    state = { ...state, ...updates };
    syncUrl();
    notify();
  }

  function reset() {
    state = {};
    syncUrl();
    notify();
  }

  function syncUrl() {
    const params = new URLSearchParams();
    Object.entries(state).forEach(([k, v]) => {
      if (v != null && v !== '' && FILTER_KEYS.includes(k)) params.set(k, v);
    });
    const qs = params.toString();
    const newUrl = window.location.pathname + (qs ? '?' + qs : '');
    window.history.replaceState({}, '', newUrl);
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function notify() {
    listeners.forEach(fn => {
      try { fn(state); } catch (e) { console.error('[filters] listener error:', e); }
    });
  }

  global.KmcFilters = { init, get, set, reset, subscribe, FILTER_KEYS };
})(window);
