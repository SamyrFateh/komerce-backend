/**
 * @komerce-arch
 * @role          canonical-admin-navigation-shell-v4-sync
 * @domain        admin-dashboard
 * @layer         ui-navigation
 * @criticality   medium
 * @inputs        canonical_navigation_header_replacement, authenticated_user_context
 * @outputs       synchronized_v4_shell_chrome
 * @depends       public/dashboards/canonical/js/navigation-policy-v4.js
 * @used-by       canonical admin runtime, standalone market canonical pages
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      single_shell_sidebar_n1_horizontal_n2_local_n3
 * @impact-areas  admin-dashboard, navigation
 * @version       2026-09-v4.1
 */
'use strict';

(function initCanonicalShellV4Sync(global) {
  let lastHeader = null;

  function synchronize() {
    const doc = global.document;
    const nav = global.KomerceCanonicalNavigation;
    if (!doc || !nav || typeof nav._applyHybridShell !== 'function') return;

    if (typeof nav._dedupeShell === 'function') nav._dedupeShell(doc);
    const header = doc.getElementById?.('canonical-admin-navigation')
      || doc.querySelector?.('[data-canonical-shell-role="navigation"]');
    if (!header) return;
    if (header === lastHeader) return;
    lastHeader = header;

    // Topbar et tabs sont des projections du header courant. Lorsqu'un
    // nouveau header devient propriétaire, on détruit toutes les projections
    // précédentes avant de reconstruire le chrome une seule fois.
    // Le sélecteur de marché et le compte appartiennent au header : la topbar ne
    // fait que les héberger. Sans les rendre au header avant la destruction, la
    // topbar reconstruite naît sans marché (le header ne les possède plus) et le
    // bloc « Marché » de la surface, normalement masqué, réapparaît dans le Hero.
    const utilities = header.querySelector?.('.kmc-admin-utility-nav');
    const topbars = Array.from(doc.querySelectorAll?.('#canonical-admin-topbar, [data-canonical-shell-role="topbar"]') || []);
    if (utilities) {
      const hosted = ['.kmc-admin-market-control', '.kmc-admin-account']
        .filter(selector => !utilities.querySelector(selector))
        .map(selector => topbars.map(topbar => topbar.querySelector?.(selector)).find(Boolean))
        .filter(Boolean);
      if (hosted.length) utilities.prepend(...hosted);
    }
    topbars.forEach(node => node.remove?.());
    Array.from(doc.querySelectorAll?.('#canonical-admin-domain-tabs, [data-canonical-shell-role="domain-tabs"]') || [])
      .forEach(node => node.remove?.());

    nav._applyHybridShell(header, {
      document: doc,
      user: global.KOMERCE_CANONICAL_AUTH_USER || global.KOMERCE_AUTH_USER || null,
      surface: typeof nav.surfaceForPath === 'function'
        ? nav.surfaceForPath(global.location?.pathname)
        : undefined,
      pathname: global.location?.pathname,
    });
  }

  function start() {
    synchronize();
    if (typeof global.MutationObserver !== 'function' || !global.document?.body) return;
    const observer = new global.MutationObserver(() => synchronize());
    observer.observe(global.document.body, { childList: true, subtree: false });
  }

  if (global.document?.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})(typeof window !== 'undefined' ? window : globalThis);
