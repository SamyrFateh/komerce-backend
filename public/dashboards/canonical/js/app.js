/**
 * @komerce-arch
 * @role          canonical-admin-entrypoint
 * @domain        admin-dashboard
 * @layer         ui-entrypoint
 * @criticality   medium
 * @inputs        user_session, url_path
 * @outputs       canonical_admin_boot_state
 * @depends       canonical pilotage, demo-order-flow
 * @used-by       /admin-next, /admin/pilotage-v2
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      canonical_admin_no_legacy_imports
 * @impact-areas  admin-dashboard
 * @version       2026-08
 */

'use strict';

(function (global) {
  'use strict';

  const ALLOWED_ROLES = new Set(['admin', 'finance', 'sourcing', 'hub', 'relais', 'support']);
  const SURFACES = Object.freeze({
    PILOTAGE: 'pilotage',
    DEMO: 'demo',
  });

  function loginUrl() {
    const next = global.location.pathname + global.location.search + global.location.hash;
    return '/login.html?next=' + encodeURIComponent(next);
  }

  async function requireSession() {
    const response = await global.fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      global.location.replace(loginUrl());
      throw new Error('unauthorized');
    }

    const user = await response.json();
    if (!ALLOWED_ROLES.has(user.role)) {
      global.location.replace('/');
      throw new Error('forbidden');
    }

    return user;
  }

  function surfaceForPath(pathname) {
    if (pathname === '/admin-next/demo') return SURFACES.DEMO;
    return SURFACES.PILOTAGE;
  }

  function renderPilotage(root, user) {
    if (!global.KomerceCanonicalPilotage) throw new Error('canonical_pilotage_module_missing');
    return global.KomerceCanonicalPilotage.mount({
      root,
      user,
      document: global.document,
      fetch: global.fetch.bind(global),
      renderer: global.KomerceDashboardRenderer,
      ui: global.KomerceCanonicalUI,
    });
  }

  function renderDemo(root, user) {
    if (!global.KomerceDemoOrderFlow) throw new Error('demo_order_flow_module_missing');
    return global.KomerceDemoOrderFlow.mount({
      root,
      user,
      document: global.document,
      fetch: global.fetch.bind(global),
    });
  }

  function renderReady(root, user) {
    const surface = surfaceForPath(global.location.pathname);
    if (surface === SURFACES.DEMO) return renderDemo(root, user);
    return renderPilotage(root, user);
  }

  async function boot() {
    const root = document.getElementById('canonical-admin-root');
    if (!root) throw new Error('canonical_admin_root_missing');

    const user = await requireSession();
    global.KOMERCE_CANONICAL_AUTH_USER = user;
    await renderReady(root, user);
    return user;
  }

  global.KomerceCanonicalAdmin = {
    SURFACES,
    boot,
    requireSession,
    surfaceForPath,
    renderPilotage,
    renderDemo,
    renderReady,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      boot().catch(err => {
        if (err.message !== 'unauthorized' && err.message !== 'forbidden') {
          console.error('[canonical-admin] bootstrap failed', err);
        }
      });
    }, { once: true });
  } else {
    boot().catch(err => {
      if (err.message !== 'unauthorized' && err.message !== 'forbidden') {
        console.error('[canonical-admin] bootstrap failed', err);
      }
    });
  }
})(window);
