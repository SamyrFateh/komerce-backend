/**
 * @komerce-arch
 * @role          canonical-admin-navigation
 * @domain        admin-dashboard
 * @layer         ui-navigation
 * @criticality   medium
 * @inputs        canonical_surface, url_path
 * @outputs       primary_dashboard_navigation, logical_back_navigation
 * @depends       canonical admin app surface contract
 * @used-by       canonical admin runtime
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      four_primary_dashboards_no_legacy_navigation
 * @impact-areas  admin-dashboard, navigation
 * @version       2026-09
 */

'use strict';

(function initCanonicalNavigation(global) {
  'use strict';

  const PRIMARY_NAV = Object.freeze([
    Object.freeze({ id: 'pilotage', label: 'Pilotage', href: '/admin/pilotage' }),
    Object.freeze({ id: 'commerce', label: 'Commerce', href: '/admin/commerce' }),
    Object.freeze({ id: 'operations', label: 'Opérations', href: '/admin/operations' }),
    Object.freeze({ id: 'finance', label: 'Finance', href: '/admin/finance' }),
  ]);

  const SURFACE_PARENT = Object.freeze({
    pilotage: 'pilotage',
    commerce: 'commerce',
    operations: 'operations',
    finance: 'finance',
    'operations-workspace': 'operations',
    'shipping-customs-workspace': 'operations',
    'accounting-workspace': 'finance',
    'catalog-workspace': 'commerce',
    'sourcing-workspace': 'commerce',
    'pricing-workspace': 'commerce',
    'action-center': 'pilotage',
    'market-access': 'pilotage',
    'order-360': 'commerce',
    'client-index': 'commerce',
    'client-360': 'commerce',
    'product-360': 'commerce',
    demo: 'pilotage',
  });

  const BACK_TARGETS = Object.freeze({
    'operations-workspace': '/admin/operations',
    'shipping-customs-workspace': '/admin/operations',
    'accounting-workspace': '/admin/finance',
    'catalog-workspace': '/admin/commerce',
    'sourcing-workspace': '/admin/commerce',
    'pricing-workspace': '/admin/commerce',
    'action-center': '/admin/pilotage',
    'market-access': '/admin/pilotage',
    'order-360': '/admin/commerce',
    'client-index': '/admin/commerce',
    'client-360': '/admin/clients',
    'product-360': '/admin/workspaces/catalog',
    demo: '/admin/pilotage',
  });

  function textNode(doc, tagName, className, value) {
    const node = doc.createElement(tagName);
    if (className) node.className = className;
    node.textContent = value;
    return node;
  }

  function surfaceForPath(pathname) {
    const app = global.KomerceCanonicalAdmin;
    if (!app || typeof app.surfaceForPath !== 'function') return 'pilotage';
    return app.surfaceForPath(pathname);
  }

  function activePrimarySurface(surface) {
    return SURFACE_PARENT[surface] || 'pilotage';
  }

  function createLink(doc, item, activeId) {
    const link = doc.createElement('a');
    link.className = 'kmc-admin-primary-link';
    link.href = item.href;
    link.textContent = item.label;
    link.setAttribute('data-dashboard', item.id);
    if (item.id === activeId) {
      link.className += ' is-active';
      link.setAttribute('aria-current', 'page');
    }
    return link;
  }

  function mount(options = {}) {
    const doc = options.document || global.document;
    const pathname = options.pathname || (global.location && global.location.pathname) || '/admin/pilotage';
    if (!doc || !doc.body || typeof doc.createElement !== 'function') {
      throw new Error('canonical_navigation_document_missing');
    }

    const existing = doc.getElementById && doc.getElementById('canonical-admin-navigation');
    if (existing) return existing;

    const surface = options.surface || surfaceForPath(pathname);
    const activeId = activePrimarySurface(surface);

    const header = doc.createElement('header');
    header.id = 'canonical-admin-navigation';
    header.className = 'kmc-admin-navigation';
    header.setAttribute('data-canonical-navigation', 'true');

    const inner = doc.createElement('div');
    inner.className = 'kmc-admin-navigation-inner';

    const identity = doc.createElement('div');
    identity.className = 'kmc-admin-navigation-identity';

    const home = doc.createElement('a');
    home.className = 'kmc-admin-home';
    home.href = '/admin/pilotage';
    home.appendChild(textNode(doc, 'span', 'kmc-admin-home-mark', 'K'));
    home.appendChild(textNode(doc, 'span', 'kmc-admin-home-label', 'Komerce Admin'));
    identity.appendChild(home);

    const backTarget = BACK_TARGETS[surface];
    if (backTarget) {
      const back = doc.createElement('a');
      back.className = 'kmc-admin-back';
      back.href = backTarget;
      back.setAttribute('aria-label', 'Retour à la vue précédente');
      back.textContent = '← Retour';
      identity.appendChild(back);
    }

    const primary = doc.createElement('nav');
    primary.className = 'kmc-admin-primary-nav';
    primary.setAttribute('aria-label', 'Dashboards principaux');
    PRIMARY_NAV.forEach(item => primary.appendChild(createLink(doc, item, activeId)));

    const utilities = doc.createElement('nav');
    utilities.className = 'kmc-admin-utility-nav';
    utilities.setAttribute('aria-label', 'Outils admin');

    const actionCenter = doc.createElement('a');
    actionCenter.className = 'kmc-admin-utility-link';
    actionCenter.href = '/admin/action-center';
    actionCenter.textContent = 'Actions';
    if (surface === 'action-center') {
      actionCenter.className += ' is-active';
      actionCenter.setAttribute('aria-current', 'page');
    }
    utilities.appendChild(actionCenter);

    const marketAccess = doc.createElement('a');
    marketAccess.className = 'kmc-admin-utility-link';
    marketAccess.href = '/dashboards/canonical/access.html';
    marketAccess.textContent = 'Accès pays';
    if (surface === 'market-access') {
      marketAccess.className += ' is-active';
      marketAccess.setAttribute('aria-current', 'page');
    }
    utilities.appendChild(marketAccess);

    const demo = doc.createElement('a');
    demo.className = 'kmc-admin-utility-link kmc-admin-demo-link';
    demo.href = '/admin/demo';
    demo.textContent = 'Démo staging';
    if (surface === 'demo') {
      demo.className += ' is-active';
      demo.setAttribute('aria-current', 'page');
    }
    utilities.appendChild(demo);

    inner.appendChild(identity);
    inner.appendChild(primary);
    inner.appendChild(utilities);
    header.appendChild(inner);

    const root = doc.getElementById && doc.getElementById('canonical-admin-root');
    if (root && root.parentNode && typeof root.parentNode.insertBefore === 'function') {
      root.parentNode.insertBefore(header, root);
    } else if (typeof doc.body.prepend === 'function') {
      doc.body.prepend(header);
    } else if (typeof doc.body.appendChild === 'function') {
      doc.body.appendChild(header);
    }

    return header;
  }

  const api = Object.freeze({
    PRIMARY_NAV,
    SURFACE_PARENT,
    BACK_TARGETS,
    activePrimarySurface,
    mount,
  });

  global.KomerceCanonicalNavigation = api;

  function autoMount() {
    try {
      mount();
    } catch (error) {
      console.error('[canonical-admin] navigation mount failed', error);
    }
  }

  if (global.document && global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', autoMount, { once: true });
  } else if (global.document) {
    autoMount();
  }
})(typeof window !== 'undefined' ? window : globalThis);
