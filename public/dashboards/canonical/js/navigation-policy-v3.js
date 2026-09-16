/**
 * @komerce-arch
 * @role          canonical-admin-navigation-policy-v3
 * @domain        admin-dashboard
 * @layer         ui-navigation
 * @criticality   high
 * @inputs        authenticated_user, canonical_surface, canonical_navigation_base
 * @outputs       server_aligned_n1_n2_navigation
 * @depends       public/dashboards/canonical/js/navigation.js
 * @used-by       canonical admin runtime, standalone market canonical pages
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      visible_destination_must_have_server_guard, n1_business_domains_only, n2_contextual_workspaces_only, market_id_is_transverse_context
 * @impact-areas  admin-dashboard, navigation, market-authorization
 * @version       2026-09-v3.1-business-truth
 */
'use strict';

(function initCanonicalNavigationPolicyV3(global) {
  const base = global.KomerceCanonicalNavigation;
  if (!base) return;

  const DOMAINS = Object.freeze([
    Object.freeze({
      id: 'dashboard',
      label: 'Dashboard',
      href: '/admin/pilotage',
      roles: Object.freeze(['admin', 'market_operator']),
    }),
    Object.freeze({
      id: 'pricing',
      label: 'Atelier économique',
      href: '/admin/workspaces/pricing',
      roles: Object.freeze(['admin', 'market_operator']),
    }),
    Object.freeze({
      id: 'catalog',
      label: 'Catalogue',
      href: '/admin/workspaces/catalog',
      roles: Object.freeze(['admin']),
    }),
    Object.freeze({
      id: 'orders',
      label: 'Commandes',
      spaces: Object.freeze([
        Object.freeze({ id: 'commerce', label: 'Commerce', href: '/admin/commerce', roles: Object.freeze(['admin', 'market_operator']) }),
        Object.freeze({ id: 'orders-overview', label: 'Suivi des commandes', href: '/admin/orders', roles: Object.freeze(['admin', 'market_operator']) }),
      ]),
    }),
    Object.freeze({
      id: 'markets',
      label: 'Marchés',
      href: '/dashboards/canonical/access.html',
      roles: Object.freeze(['admin', 'market_operator']),
    }),
    Object.freeze({
      id: 'operations',
      label: 'Opérations',
      spaces: Object.freeze([
        Object.freeze({ id: 'operations-overview', label: 'Vue d’ensemble', href: '/admin/operations', roles: Object.freeze(['admin', 'market_operator']) }),
        Object.freeze({ id: 'operations-workspace', label: 'Hub / Relais', href: '/admin/workspaces/operations', roles: Object.freeze(['admin', 'agent_hub', 'agent_relais', 'market_operator']) }),
        Object.freeze({ id: 'shipping-customs-workspace', label: 'Expéditions & Douane', href: '/admin/workspaces/shipping-customs', roles: Object.freeze(['admin', 'agent_hub', 'agent_transitaire', 'market_operator']) }),
        Object.freeze({ id: 'sourcing-workspace', label: 'Sourcing', href: '/admin/workspaces/sourcing', roles: Object.freeze(['admin', 'sourcing']) }),
      ]),
    }),
    Object.freeze({
      id: 'finance',
      label: 'Finance',
      spaces: Object.freeze([
        Object.freeze({ id: 'finance-overview', label: 'Vue d’ensemble', href: '/admin/finance', roles: Object.freeze(['admin', 'market_operator']) }),
        Object.freeze({ id: 'accounting-workspace', label: 'Comptabilité', href: '/admin/workspaces/accounting', roles: Object.freeze(['admin', 'finance', 'agent_relais', 'market_operator']) }),
      ]),
    }),
  ]);

  const ROLE_HOME = Object.freeze({
    admin: '/admin/pilotage',
    market_operator: '/admin/pilotage',
    finance: '/admin/workspaces/accounting',
    sourcing: '/admin/workspaces/sourcing',
    agent_hub: '/admin/workspaces/operations',
    agent_relais: '/admin/workspaces/operations',
    agent_transitaire: '/admin/workspaces/shipping-customs',
    support: '/portail',
  });

  const SURFACE_TO_DOMAIN = Object.freeze({
    pilotage: 'dashboard',
    'action-center': 'dashboard',
    demo: 'dashboard',
    'pricing-workspace': 'pricing',
    'catalog-workspace': 'catalog',
    'market-catalog': 'markets',
    'product-360': 'catalog',
    commerce: 'orders',
    orders: 'orders',
    'order-360': 'orders',
    'client-index': 'orders',
    'client-360': 'orders',
    'market-access': 'markets',
    'market-autonomy': 'markets',
    operations: 'operations',
    'operations-workspace': 'operations',
    'shipping-customs-workspace': 'operations',
    'sourcing-workspace': 'operations',
    finance: 'finance',
    'accounting-workspace': 'finance',
    settings: 'settings',
  });

  const SURFACE_TO_SPACE = Object.freeze({
    commerce: 'commerce',
    orders: 'orders-overview',
    'order-360': 'commerce',
    'client-index': 'commerce',
    'client-360': 'commerce',
    operations: 'operations-overview',
    'operations-workspace': 'operations-workspace',
    'shipping-customs-workspace': 'shipping-customs-workspace',
    'sourcing-workspace': 'sourcing-workspace',
    finance: 'finance-overview',
    'accounting-workspace': 'accounting-workspace',
  });

  function roleOf(user) {
    return String(user && user.role || '');
  }

  function visibleSpacesFor(domain, role) {
    if (!domain || !Array.isArray(domain.spaces)) return Object.freeze([]);
    return Object.freeze(domain.spaces.filter(space => (space.roles || []).includes(role)));
  }

  function domainIsVisible(domain, role) {
    if (!domain) return false;
    if (Array.isArray(domain.spaces)) return visibleSpacesFor(domain, role).length > 0;
    return (domain.roles || []).includes(role);
  }

  function visibleDomainsFor(user) {
    const role = roleOf(user);
    return Object.freeze(DOMAINS.filter(domain => domainIsVisible(domain, role)));
  }

  function visibleNavigationFor(user) {
    return visibleDomainsFor(user);
  }

  function hrefFor(item, user) {
    const role = roleOf(user);
    if (item.id === 'markets' && role === 'market_operator') {
      return '/dashboards/canonical/market-autonomy.html';
    }
    return item.href;
  }

  function landingForDomain(domain, user) {
    if (!domain) return null;
    if (!Array.isArray(domain.spaces)) return hrefFor(domain, user);
    const spaces = visibleSpacesFor(domain, roleOf(user));
    return spaces.length ? spaces[0].href : null;
  }

  function defaultLandingFor(user) {
    return ROLE_HOME[roleOf(user)] || '/';
  }

  function activePrimarySurface(surface) {
    return SURFACE_TO_DOMAIN[surface] || 'dashboard';
  }

  function activeSpaceFor(surface) {
    return SURFACE_TO_SPACE[surface] || null;
  }

  function createLink(doc, item, href, active, className) {
    const link = doc.createElement('a');
    link.className = className + (active ? ' is-active' : '');
    link.href = href;
    link.textContent = item.label;
    link.setAttribute('data-dashboard', item.id);
    if (active) link.setAttribute('aria-current', 'page');
    return link;
  }

  function replaceNavigationStructure(header, options = {}) {
    if (!header) return header;
    const doc = options.document || global.document;
    const user = options.user || global.KOMERCE_CANONICAL_AUTH_USER || global.KOMERCE_AUTH_USER || null;
    const surface = options.surface || (typeof base.surfaceForPath === 'function'
      ? base.surfaceForPath(options.pathname || global.location?.pathname)
      : 'pilotage');
    const role = roleOf(user);
    const activeDomainId = activePrimarySurface(surface);
    const activeSpaceId = activeSpaceFor(surface);
    const domains = visibleDomainsFor(user);

    const home = header.querySelector?.('.kmc-admin-home');
    if (home) home.href = defaultLandingFor(user);

    const primary = header.querySelector?.('.kmc-admin-primary-nav');
    if (primary) {
      primary.replaceChildren();
      domains.forEach(domain => {
        const href = Array.isArray(domain.spaces)
          ? landingForDomain(domain, user)
          : hrefFor(domain, user);
        if (!href) return;
        primary.appendChild(createLink(doc, domain, href, domain.id === activeDomainId, 'kmc-admin-primary-link'));
      });
    }

    const oldSecondary = header.querySelector?.('.kmc-admin-secondary-nav');
    if (oldSecondary && oldSecondary.parentNode) oldSecondary.parentNode.removeChild(oldSecondary);

    const activeDomain = domains.find(domain => domain.id === activeDomainId);
    if (activeDomain && Array.isArray(activeDomain.spaces)) {
      const spaces = visibleSpacesFor(activeDomain, role);
      if (spaces.length > 1) {
        const secondary = doc.createElement('nav');
        secondary.className = 'kmc-admin-secondary-nav';
        secondary.setAttribute('aria-label', `Sous-navigation ${activeDomain.label}`);
        spaces.forEach(space => {
          secondary.appendChild(createLink(doc, space, space.href, space.id === activeSpaceId, 'kmc-admin-secondary-link'));
        });
        header.appendChild(secondary);
      }
    }

    header.setAttribute('data-navigation-policy', 'v3');
    return header;
  }

  function mount(options = {}) {
    const header = base.mount(options);
    return replaceNavigationStructure(header, options);
  }

  const api = Object.freeze({
    ...base,
    DOMAINS,
    ROLE_HOME,
    SURFACE_TO_DOMAIN,
    SURFACE_TO_SPACE,
    visibleDomainsFor,
    visibleSpacesFor,
    visibleNavigationFor,
    landingForDomain,
    defaultLandingFor,
    activePrimarySurface,
    activeSpaceFor,
    mount,
    _replaceNavigationStructure: replaceNavigationStructure,
  });

  global.KomerceCanonicalNavigation = api;

  function finalizeStandaloneNavigation() {
    const doc = global.document;
    if (!doc) return;
    const existing = doc.getElementById?.('canonical-admin-navigation');
    if (!existing) return;
    replaceNavigationStructure(existing, {
      document: doc,
      user: global.KOMERCE_CANONICAL_AUTH_USER || global.KOMERCE_AUTH_USER || null,
      surface: typeof base.surfaceForPath === 'function' ? base.surfaceForPath(global.location?.pathname) : undefined,
      pathname: global.location?.pathname,
    });
  }

  if (global.document?.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', finalizeStandaloneNavigation, { once: true });
  } else {
    finalizeStandaloneNavigation();
  }
})(typeof window !== 'undefined' ? window : globalThis);
