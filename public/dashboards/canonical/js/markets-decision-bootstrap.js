/**
 * @komerce-arch
 * @role          canonical-markets-decision-bootstrap
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        authenticated_market_surfaces, server_admin_context, market_users, country_pricing_projection
 * @outputs       mounted_decision_first_markets_overviews
 * @depends       markets-decision, canonical market surfaces
 * @used-by       access.html, market-autonomy.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      server_market_scope_is_authority, dashboard_no_business_recompute
 * @impact-areas  admin-dashboard, market-authorization, market-autonomy
 * @version       2026-09
 */
'use strict';

(function initMarketsDecisionBootstrap(global) {
  'use strict';

  const doc = global.document;
  if (!doc || !global.KomerceMarketsDecision) return;

  async function requestJson(url) {
    const response = await global.fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = body.code || null;
      throw error;
    }
    return body;
  }

  function marketCodesFromContext(rawContext) {
    const contract = global.KomerceAdminContext;
    const context = contract && typeof contract.validateAdminContext === 'function'
      ? contract.validateAdminContext(rawContext)
      : rawContext;
    const codes = context && context.access && Array.isArray(context.access.allowedMarkets)
      ? context.access.allowedMarkets
      : [];
    return codes.map(code => ({ code, name: code }));
  }

  function marketFromContext(context) {
    const access = context && context.access || {};
    const allowed = Array.isArray(access.allowedMarkets) ? access.allowedMarkets : [];
    let requested = null;
    try {
      requested = new URL(global.location.href).searchParams.get('market');
    } catch (_) {
      requested = null;
    }
    if (requested && allowed.includes(requested.toUpperCase())) return requested.toUpperCase();
    if (access.defaultMarket && allowed.includes(access.defaultMarket)) return access.defaultMarket;
    return allowed[0] || null;
  }

  function waitFor(predicate, attempts = 80, delay = 50) {
    return new Promise((resolve, reject) => {
      let remaining = attempts;
      const tick = () => {
        const value = predicate();
        if (value) return resolve(value);
        remaining -= 1;
        if (remaining <= 0) return reject(new Error('markets_decision_surface_not_ready'));
        global.setTimeout(tick, delay);
      };
      tick();
    });
  }

  function insertAfter(referenceNode, node) {
    if (!referenceNode || !referenceNode.parentNode) return false;
    referenceNode.parentNode.insertBefore(node, referenceNode.nextSibling);
    return true;
  }

  async function renderAdminOverview() {
    const root = await waitFor(() => {
      const node = doc.getElementById('canonical-admin-root');
      return node && node.querySelector('.kmc-access-hero') ? node : null;
    });
    let host = doc.getElementById('markets-decision-admin-overview');
    if (!host) {
      host = doc.createElement('div');
      host.id = 'markets-decision-admin-overview';
      const hero = root.querySelector('.kmc-access-hero');
      if (!insertAfter(hero, host)) root.prepend(host);
    }

    const [contextPayload, usersPayload] = await Promise.all([
      requestJson('/api/admin/dashboard/context'),
      requestJson('/api/admin/users?role=market_operator&limit=100'),
    ]);
    global.KomerceMarketsDecision.renderAdminOverview(host, {
      markets: marketCodesFromContext(contextPayload),
      users: Array.isArray(usersPayload.users) ? usersPayload.users : [],
    }, {
      document: doc,
      ui: global.KomerceCanonicalUI,
      decisionUi: global.KomerceDecisionUI,
    });

    const operators = root.querySelector('.kmc-access-operators');
    if (operators && typeof global.MutationObserver === 'function' && !operators.dataset.decisionObserverMounted) {
      operators.dataset.decisionObserverMounted = '1';
      let timer = null;
      const observer = new global.MutationObserver(() => {
        if (timer) global.clearTimeout(timer);
        timer = global.setTimeout(() => {
          renderAdminOverview().catch(error => console.error('[canonical-admin] markets decision refresh failed', error));
        }, 120);
      });
      observer.observe(operators, { childList: true });
    }
    return host;
  }

  async function renderCountryOverview() {
    const root = await waitFor(() => {
      const node = doc.getElementById('market-autonomy-root');
      return node && node.classList && node.classList.contains('kmc-workspace') && node.querySelector('.kmc-workspace-header')
        ? node
        : null;
    });
    let host = doc.getElementById('markets-decision-country-overview');
    if (!host) {
      host = doc.createElement('div');
      host.id = 'markets-decision-country-overview';
      const header = root.querySelector('.kmc-workspace-header');
      if (!insertAfter(header, host)) root.prepend(host);
    }

    const context = await requestJson('/api/admin/dashboard/context');
    const marketCode = marketFromContext(context);
    if (!marketCode) throw new Error('Aucun marché autorisé pour ce compte.');
    const [workspace, prices] = await Promise.all([
      requestJson(`/api/admin/workspaces/pricing/market/${encodeURIComponent(marketCode)}`),
      requestJson(`/api/admin/workspaces/pricing/market/${encodeURIComponent(marketCode)}/commercial-prices`),
    ]);
    global.KomerceMarketsDecision.renderCountryOverview(host, { marketCode, workspace, prices }, {
      document: doc,
      ui: global.KomerceCanonicalUI,
      decisionUi: global.KomerceDecisionUI,
    });

    if (typeof global.MutationObserver === 'function' && !root.dataset.decisionObserverMounted) {
      root.dataset.decisionObserverMounted = '1';
      let timer = null;
      const observer = new global.MutationObserver(() => {
        if (doc.getElementById('markets-decision-country-overview')) return;
        if (timer) global.clearTimeout(timer);
        timer = global.setTimeout(() => {
          renderCountryOverview().catch(error => console.error('[canonical-admin] market autonomy decision refresh failed', error));
        }, 120);
      });
      observer.observe(root, { childList: true });
    }
    return host;
  }

  function boot() {
    const path = String(global.location && global.location.pathname || '');
    if (path === '/dashboards/canonical/access.html' || path === '/admin/access' || path === '/admin-next/access') {
      renderAdminOverview().catch(error => console.error('[canonical-admin] markets decision boot failed', error));
      return;
    }
    if (path === '/dashboards/canonical/market-autonomy.html') {
      renderCountryOverview().catch(error => console.error('[canonical-admin] market autonomy decision boot failed', error));
    }
  }

  global.KomerceMarketsDecisionBootstrap = Object.freeze({
    requestJson,
    marketCodesFromContext,
    marketFromContext,
    renderAdminOverview,
    renderCountryOverview,
    boot,
  });

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
