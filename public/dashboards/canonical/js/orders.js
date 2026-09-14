/**
 * @komerce-arch
 * @role          canonical-orders-dashboard
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_admin_session, server_resolved_admin_context, requested_market_view
 * @outputs       canonical_orders_dashboard
 * @depends       admin-context, dashboard-schema, dashboard-renderer, primitives
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, canonical_admin_no_legacy_imports, server_market_scope_is_authority
 * @impact-areas  admin-dashboard, orders
 * @version       2026-09
 */

'use strict';

(function initCanonicalOrders(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalOrders = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createCanonicalOrders() {
  const GLOBAL_ENDPOINT = '/api/admin/dashboard/orders';
  const MARKET_ENDPOINT_PREFIX = '/api/admin/dashboard/orders/market/';

  // Schéma minimal — seul `id` est requis par dashboard-schema.js. Ce
  // dashboard est decision-first (orders-decision.js) ; le schéma ne sert
  // qu'aux états loading/error du renderer canonique (mêmes primitives que
  // les autres surfaces), pas à un rendu de sections legacy.
  const ORDERS_SCHEMA = Object.freeze({
    id: 'orders',
    title: 'Commandes',
    description: 'Suivre les files de travail commande — cash à confirmer, colis à créer — et le cycle de vie.',
  });

  function formatNumber(value, maximumFractionDigits = 2) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(numeric);
  }

  function endpointForContext(adminContext, contextContract, requestedMarket) {
    if (!contextContract || typeof contextContract.resolveMarketView !== 'function') {
      throw new Error('canonical_orders_admin_context_contract_missing');
    }
    const view = contextContract.resolveMarketView(adminContext, requestedMarket);
    if (view.mode === 'global') return GLOBAL_ENDPOINT;
    return MARKET_ENDPOINT_PREFIX + encodeURIComponent(view.marketCode);
  }

  async function jsonRequest(fetchFn, url) {
    const response = await fetchFn(url, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Erreur HTTP ${response.status}`);
    return body;
  }

  function mount(options) {
    const rootNode = options.root;
    const rendererContract = options.renderer;
    const doc = options.document;
    const ui = options.ui;
    const fetchFn = options.fetch;
    const endpoint = endpointForContext(options.adminContext, options.contextContract, options.requestedMarket);

    if (!rootNode) throw new Error('canonical_orders_root_missing');
    if (!rendererContract || typeof rendererContract.createRenderer !== 'function') {
      throw new Error('canonical_orders_renderer_missing');
    }

    const renderer = rendererContract.createRenderer({ document: doc, ui });
    renderer.render(rootNode, ORDERS_SCHEMA, { state: 'loading', stateMessage: 'Chargement des Commandes…' });

    return jsonRequest(fetchFn, endpoint)
      .then(payload => Object.freeze({ payload, result: null, endpoint }))
      .catch(error => {
        renderer.render(rootNode, ORDERS_SCHEMA, { state: 'error', stateMessage: error.message });
        throw error;
      });
  }

  return Object.freeze({
    GLOBAL_ENDPOINT,
    MARKET_ENDPOINT_PREFIX,
    ORDERS_SCHEMA,
    formatNumber,
    endpointForContext,
    jsonRequest,
    mount,
  });
});
