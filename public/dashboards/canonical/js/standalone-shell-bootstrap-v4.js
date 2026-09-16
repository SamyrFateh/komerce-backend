/**
 * @komerce-arch
 * @role          canonical-standalone-shell-bootstrap-v4
 * @domain        admin-dashboard
 * @layer         ui-navigation
 * @criticality   high
 * @inputs        authenticated_user, admin_context, standalone_market_surface
 * @outputs       authenticated_canonical_shell_v4
 * @depends       public/dashboards/canonical/js/navigation-policy-v4.js
 * @used-by       access.html, market-autonomy.html, market-catalog.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      single_shell_sidebar_n1_horizontal_n2_local_n3, visible_destination_must_have_server_guard
 * @impact-areas  admin-dashboard, navigation, market-authorization
 * @version       2026-09-v4.1
 */
'use strict';

(function initStandaloneShellBootstrapV4(global) {
  const doc = global.document;

  const CHROME_SELECTOR = [
    '#canonical-admin-navigation',
    '[data-canonical-navigation="true"]',
    '[data-canonical-shell-role="navigation"]',
    '#canonical-admin-topbar',
    '[data-canonical-shell-role="topbar"]',
    '#canonical-admin-domain-tabs',
    '[data-canonical-shell-role="domain-tabs"]',
  ].join(', ');

  function loginUrl() {
    const location = global.location || {};
    const next = `${location.pathname || ''}${location.search || ''}${location.hash || ''}`;
    return `/login.html?next=${encodeURIComponent(next)}`;
  }

  async function requestJson(url, options = {}) {
    const response = await global.fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      ...options,
    });
    let payload = null;
    try { payload = await response.json(); } catch (_) { payload = null; }
    if (!response.ok) {
      const error = new Error(payload?.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = payload?.code || null;
      throw error;
    }
    return payload;
  }

  async function resolveUser() {
    try {
      return await requestJson('/api/auth/me');
    } catch (error) {
      if (error.status === 401) {
        global.location?.replace?.(loginUrl());
      }
      throw error;
    }
  }

  async function resolveAdminContext() {
    try {
      const raw = await requestJson('/api/admin/dashboard/context');
      const contract = global.KomerceAdminContext;
      return contract && typeof contract.validateAdminContext === 'function'
        ? contract.validateAdminContext(raw)
        : raw;
    } catch (error) {
      // Certaines surfaces autonomes peuvent rester utilisables sans le
      // sélecteur transverse de marché. Le serveur de la surface garde
      // l'autorité ; le shell ne doit jamais inventer un contexte.
      if (error.status === 403) return null;
      if (error.status === 401) {
        global.location?.replace?.(loginUrl());
      }
      throw error;
    }
  }

  function clearAnonymousChrome() {
    const nodes = Array.from(doc?.querySelectorAll?.(CHROME_SELECTOR) || []);
    nodes.filter((node, index) => nodes.indexOf(node) === index).forEach(node => node.remove?.());
  }

  function surfaceForCurrentPath(nav) {
    return typeof nav?.surfaceForPath === 'function'
      ? nav.surfaceForPath(global.location?.pathname || '')
      : undefined;
  }

  async function remountAuthenticatedShell() {
    const nav = global.KomerceCanonicalNavigation;
    if (!doc || !nav || typeof nav.mount !== 'function') {
      throw new Error('canonical_standalone_navigation_missing');
    }

    const [user, adminContext] = await Promise.all([
      resolveUser(),
      resolveAdminContext(),
    ]);

    global.KOMERCE_CANONICAL_AUTH_USER = user;
    global.KOMERCE_AUTH_USER = user;
    global.KOMERCE_CANONICAL_ADMIN_CONTEXT = adminContext;

    clearAnonymousChrome();
    const surface = surfaceForCurrentPath(nav);
    nav.mount({
      document: doc,
      user,
      adminContext,
      surface,
      pathname: global.location?.pathname,
    });
    if (typeof nav._dedupeShell === 'function') nav._dedupeShell(doc);

    doc.body?.classList?.add('kmc-standalone-shell-authenticated');
    return { user, adminContext, surface };
  }

  function boot() {
    remountAuthenticatedShell().catch(error => {
      if (error?.status !== 401) {
        console.error('[canonical-admin] standalone shell bootstrap failed', error);
      }
    });
  }

  const api = Object.freeze({
    CHROME_SELECTOR,
    loginUrl,
    requestJson,
    resolveUser,
    resolveAdminContext,
    clearAnonymousChrome,
    surfaceForCurrentPath,
    remountAuthenticatedShell,
    boot,
  });

  global.KomerceStandaloneShellBootstrapV4 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (doc?.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot, { once: true });
  } else if (doc) {
    boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
