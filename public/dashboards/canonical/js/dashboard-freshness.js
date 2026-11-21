/**
 * @komerce-arch
 * @role          canonical-dashboard-freshness-client
 * @domain        admin-dashboard
 * @layer         ui-infrastructure
 * @criticality   high
 * @inputs        authenticated_sse_hints, canonical_read_callback
 * @outputs       deduplicated_server_revalidation
 * @depends       none
 * @used-by       public/dashboards/canonical/js/hub-workstation.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      canonical_get_is_truth, no_optimistic_business_counters
 * @impact-areas  admin-dashboard, hub
 * @version       2026-11
 */
'use strict';

(function initDashboardFreshness(global) {
  const ENDPOINT = '/api/admin/dashboard/events';
  const FALLBACK_MS = 60000;
  const MIN_GAP_MS = 2000;
  const watchers = new Set();
  const hasStreamSubscriber = () => [...watchers].some(w => w.streamEnabled);
  let source = null;
  let reconnectTimer = null;

  function disconnect() {
    if (source) source.close();
    source = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function reconnectLater() {
    if (reconnectTimer || !hasStreamSubscriber()) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 300000);
  }

  function connect() {
    if (source || !hasStreamSubscriber() || typeof global.EventSource !== 'function') return;
    try {
      const next = new global.EventSource(ENDPOINT, { withCredentials:true });
      source = next;
      next.addEventListener('refresh', () => {
        for (const watcher of [...watchers]) watcher.poke();
      });
      next.onerror = () => {
        if (source !== next) return;
        // CONNECTING : EventSource gère lui-même la reconnexion (retry: 5000).
        // CLOSED définitif (204 / authentification refusée) : backoff long.
        if (next.readyState === 2) {
          next.close();
          source = null;
          reconnectLater();
        }
      };
    } catch (_) {
      source = null;
      reconnectLater();
    }
  }

  /**
   * Chaque watcher est lié à un noeud appartenant à la vue et relit SON API.
   * Aucune donnée métier ne transite par SSE. Un seul EventSource par page.
   */
  function watch({ root, refresh, pollMs = FALLBACK_MS, isBusy = () => false, streamEnabled = true } = {}) {
    if (!root || typeof refresh !== 'function') throw new TypeError('root et refresh requis');
    // Un changement de marché dans le même shell remplace la lecture précédente.
    root.__dashboardFreshnessWatch?.stop?.();
    let closed = false;
    let inFlight = false;
    let pending = false;
    let failures = 0;
    let lastReadAt = Date.now();
    let timer = null;
    let debounce = null;
    const doc = global.document;
    const listeners = [];

    const listen = (target, type, handler) => {
      target?.addEventListener?.(type, handler);
      if (target?.removeEventListener) listeners.push(() => target.removeEventListener(type, handler));
    };

    function stop() {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      if (debounce) clearTimeout(debounce);
      listeners.forEach(fn => fn());
      watchers.delete(watcher);
      if (!hasStreamSubscriber()) disconnect();
      if (root.__dashboardFreshnessWatch === watcher) root.__dashboardFreshnessWatch = null;
    }

    function schedule(ms) {
      if (closed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        poke();
      }, ms);
    }

    function poke() {
      if (closed) return;
      if (root.isConnected === false) { stop(); return; }
      if (doc?.visibilityState === 'hidden' || isBusy()) {
        schedule(FALLBACK_MS);
        return;
      }
      if (inFlight) { pending = true; return; }
      if (debounce) clearTimeout(debounce);
      const delay = Math.max(300, MIN_GAP_MS - (Date.now() - lastReadAt));
      debounce = setTimeout(async () => {
        debounce = null;
        if (closed || root.isConnected === false) { stop(); return; }
        if (inFlight || isBusy()) { pending = true; schedule(FALLBACK_MS); return; }
        inFlight = true;
        lastReadAt = Date.now();
        try {
          const result = await refresh();
          if (result === null) throw new Error('dashboard_read_unavailable');
          failures = 0;
        } catch (_) {
          failures += 1;
        } finally {
          inFlight = false;
          const backoff = Math.min(300000, pollMs * (2 ** Math.min(3, failures)));
          schedule(backoff);
          if (pending && !closed) {
            pending = false;
            if (failures === 0) poke();
          }
        }
      }, delay);
    }

    const watcher = { poke, stop, streamEnabled };
    root.__dashboardFreshnessWatch = watcher;
    watchers.add(watcher);
    listen(global, 'focus', poke);
    listen(global, 'online', poke);
    listen(doc, 'visibilitychange', () => {
      if (doc.visibilityState === 'visible') poke();
    });
    schedule(pollMs);
    connect();
    return watcher;
  }

  global.KomerceDashboardFreshness = Object.freeze({ watch });
})(typeof window !== 'undefined' ? window : globalThis);
