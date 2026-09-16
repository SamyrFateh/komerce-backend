/**
 * @komerce-arch
 * @role          canonical-admin-navigation-policy-v4
 * @domain        admin-dashboard
 * @layer         ui-navigation
 * @criticality   high
 * @inputs        authenticated_user, canonical_surface, canonical_navigation_v3
 * @outputs       hybrid_sidebar_n1_horizontal_n2_shell
 * @depends       public/dashboards/canonical/js/navigation-policy-v3.js
 * @used-by       canonical admin runtime, standalone market canonical pages
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      single_shell_sidebar_n1_horizontal_n2_local_n3, visible_destination_must_have_server_guard, market_id_is_transverse_context
 * @impact-areas  admin-dashboard, navigation, market-authorization
 * @version       2026-09-v4
 */
'use strict';

(function initCanonicalNavigationPolicyV4(global) {
  const base = global.KomerceCanonicalNavigation;
  if (!base) return;

  const ICONS = Object.freeze({
    dashboard: '⌂',
    pricing: '▥',
    catalog: '▣',
    orders: '◇',
    markets: '◎',
    operations: '◈',
    finance: '▤',
    settings: '⚙',
  });

  const LOCAL_TABS = Object.freeze({
    pricing: Object.freeze([
      Object.freeze({ id: 'pricing-overview', label: 'Vue d’ensemble', href: '/admin/workspaces/pricing', roles: ['admin', 'market_operator'] }),
      Object.freeze({ id: 'pricing-products', label: 'Produits', href: '/admin/workspaces/pricing#pricing-products', roles: ['admin', 'market_operator'] }),
      Object.freeze({ id: 'pricing-costs', label: 'Coûts', href: '/admin/workspaces/pricing#pricing-costs', roles: ['admin', 'market_operator'] }),
      Object.freeze({ id: 'pricing-strategy', label: 'Stratégie', href: '/admin/workspaces/pricing#pricing-strategy', roles: ['admin', 'market_operator'] }),
    ]),
    catalog: Object.freeze([
      Object.freeze({ id: 'catalog-overview', label: 'Vue catalogue', href: '/admin/workspaces/catalog', roles: ['admin'] }),
      Object.freeze({ id: 'catalog-sources', label: 'Sources', href: '/admin/workspaces/catalog#catalog-sources', roles: ['admin'] }),
      Object.freeze({ id: 'catalog-refinery', label: 'Raffinerie', href: '/admin/workspaces/catalog#catalog-refinery', roles: ['admin'] }),
      Object.freeze({ id: 'catalog-products', label: 'Produits', href: '/admin/workspaces/catalog?view=advanced', roles: ['admin'] }),
      Object.freeze({ id: 'catalog-boutique', label: 'Boutique', href: '/admin/workspaces/catalog#catalog-boutique', roles: ['admin'] }),
      Object.freeze({ id: 'catalog-country', label: 'Catalogue pays', href: '/dashboards/canonical/market-catalog.html', roles: ['market_operator'] }),
    ]),
    orders: Object.freeze([
      Object.freeze({ id: 'commerce', label: 'Vue d’ensemble', href: '/admin/commerce', roles: ['admin', 'market_operator'] }),
      Object.freeze({ id: 'orders-overview', label: 'Commandes', href: '/admin/orders', roles: ['admin', 'market_operator'] }),
      Object.freeze({ id: 'clients', label: 'Clients', href: '/admin/clients', roles: ['admin'] }),
    ]),
    markets: Object.freeze([
      Object.freeze({ id: 'market-access', label: 'Accès pays', href: '/dashboards/canonical/access.html', roles: ['admin'] }),
      Object.freeze({ id: 'market-autonomy', label: 'Autonomie marché', href: '/dashboards/canonical/market-autonomy.html', roles: ['market_operator'] }),
    ]),
  });

  const PRICING_SECTION_IDS = Object.freeze({
    'Décision produit': 'pricing-products',
    'Atelier des coûts': 'pricing-costs',
    'Stratégie & concurrence': 'pricing-strategy',
  });

  function roleOf(user) {
    return String(user && user.role || '');
  }

  function rootNode(doc) {
    return doc.getElementById?.('canonical-admin-root')
      || doc.getElementById?.('market-autonomy-root')
      || doc.getElementById?.('market-catalog-root')
      || null;
  }

  function createNode(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function decoratePrimaryLinks(header) {
    const links = header.querySelectorAll?.('.kmc-admin-primary-link') || [];
    links.forEach(link => {
      const id = link.getAttribute?.('data-dashboard') || '';
      if (link.querySelector?.('.kmc-admin-primary-icon')) return;
      const label = String(link.textContent || '').trim();
      link.replaceChildren();
      link.appendChild(createNode(header.ownerDocument || global.document, 'span', 'kmc-admin-primary-icon', ICONS[id] || '•'));
      link.appendChild(createNode(header.ownerDocument || global.document, 'span', 'kmc-admin-primary-label', label));
    });

    const home = header.querySelector?.('.kmc-admin-home');
    if (home && !home.querySelector?.('.kmc-admin-home-mark')) {
      const doc = header.ownerDocument || global.document;
      const label = home.querySelector?.('.kmc-admin-home-label');
      const mark = createNode(doc, 'span', 'kmc-admin-home-mark', 'K');
      home.insertBefore(mark, label || home.firstChild || null);
      if (label) label.textContent = 'Komerce';
    }
  }

  function currentSurface(options) {
    if (options.surface) return options.surface;
    if (typeof base.surfaceForPath === 'function') {
      return base.surfaceForPath(options.pathname || global.location?.pathname || '');
    }
    return 'pilotage';
  }

  function currentDomain(surface) {
    if (typeof base.activePrimarySurface === 'function') return base.activePrimarySurface(surface);
    return base.SURFACE_TO_DOMAIN?.[surface] || 'dashboard';
  }

  function localTabsFor(domainId, user) {
    const role = roleOf(user);
    const local = LOCAL_TABS[domainId];
    if (local) return local.filter(tab => tab.roles.includes(role));

    const domain = (base.visibleDomainsFor?.(user) || []).find(row => row.id === domainId);
    if (!domain || !Array.isArray(domain.spaces)) return [];
    return base.visibleSpacesFor(domain, role).map(space => ({
      id: space.id,
      label: space.label,
      href: space.href,
      roles: space.roles || [],
    }));
  }

  function activeLocalTab(domainId, surface) {
    const path = String(global.location?.pathname || '');
    const hash = String(global.location?.hash || '').replace(/^#/, '');
    const search = new URLSearchParams(String(global.location?.search || ''));

    if (domainId === 'pricing') {
      if (hash && ['pricing-products', 'pricing-costs', 'pricing-strategy'].includes(hash)) return hash;
      return 'pricing-overview';
    }
    if (domainId === 'catalog') {
      if (surface === 'market-catalog') return 'catalog-country';
      if (search.get('view') === 'advanced') return 'catalog-products';
      if (hash && ['catalog-sources', 'catalog-refinery', 'catalog-boutique'].includes(hash)) return hash;
      return 'catalog-overview';
    }
    if (domainId === 'orders') {
      if (surface === 'client-index' || surface === 'client-360') return 'clients';
      if (surface === 'orders' || surface === 'order-360') return 'orders-overview';
      return 'commerce';
    }
    if (domainId === 'markets') {
      return surface === 'market-autonomy' ? 'market-autonomy' : 'market-access';
    }
    if (typeof base.activeSpaceFor === 'function') return base.activeSpaceFor(surface);
    return path;
  }

  function createTabs(doc, domainId, surface, user) {
    const tabs = localTabsFor(domainId, user);
    if (tabs.length < 2) return null;

    const nav = createNode(doc, 'nav', 'kmc-admin-domain-tabs');
    nav.id = 'canonical-admin-domain-tabs';
    nav.setAttribute('aria-label', `Rubriques ${domainId}`);
    const active = activeLocalTab(domainId, surface);
    tabs.forEach(tab => {
      const link = createNode(doc, 'a', 'kmc-admin-domain-tab', tab.label);
      link.href = tab.href;
      link.dataset.tab = tab.id;
      if (tab.id === active) {
        link.className += ' is-active';
        link.setAttribute('aria-current', 'page');
      }
      nav.appendChild(link);
    });
    return nav;
  }

  function assignPricingAnchors(doc) {
    const root = rootNode(doc);
    if (!root) return;
    const titles = root.querySelectorAll?.('.kmc-section-title') || [];
    titles.forEach(title => {
      const id = PRICING_SECTION_IDS[String(title.textContent || '').trim()];
      if (!id) return;
      const section = title.closest?.('.kmc-section');
      if (section && !section.id) section.id = id;
      if (section && global.location?.hash === `#${id}` && section.dataset.anchorScrolled !== '1') {
        section.dataset.anchorScrolled = '1';
        queueMicrotask(() => section.scrollIntoView?.({ block: 'start', behavior: 'smooth' }));
      }
    });
  }

  function observeSurfaceAnchors(doc, domainId) {
    if (domainId !== 'pricing' || typeof global.MutationObserver !== 'function') return;
    const root = rootNode(doc);
    if (!root || root.dataset.pricingAnchorObserver === '1') return;
    root.dataset.pricingAnchorObserver = '1';
    assignPricingAnchors(doc);
    const observer = new global.MutationObserver(() => assignPricingAnchors(doc));
    observer.observe(root, { childList: true, subtree: true });
  }

  function filterCurrentSurface(doc, term) {
    const localCatalogSearch = doc.querySelector?.('.kmc-ctl-search-input');
    if (localCatalogSearch) {
      localCatalogSearch.value = term;
      if (typeof localCatalogSearch.dispatchEvent === 'function' && typeof global.Event === 'function') {
        localCatalogSearch.dispatchEvent(new global.Event('input', { bubbles: true }));
        return;
      }
    }

    const normalized = String(term || '').trim().toLocaleLowerCase('fr');
    const nodes = doc.querySelectorAll?.('.kmc-workspace-table tbody tr, .kmc-data-table tbody tr, .kmc-ctl-incoming-row') || [];
    nodes.forEach(row => {
      const matches = !normalized || String(row.textContent || '').toLocaleLowerCase('fr').includes(normalized);
      row.hidden = !matches;
    });
  }

  function createTopbar(doc, header) {
    let topbar = doc.getElementById?.('canonical-admin-topbar');
    if (topbar) return topbar;

    topbar = createNode(doc, 'div', 'kmc-admin-topbar');
    topbar.id = 'canonical-admin-topbar';

    const search = createNode(doc, 'label', 'kmc-admin-search');
    search.appendChild(createNode(doc, 'span', 'kmc-admin-search-icon', '⌕'));
    const input = createNode(doc, 'input', 'kmc-admin-search-input');
    input.type = 'search';
    input.placeholder = 'Rechercher dans cette rubrique…';
    input.setAttribute('aria-label', 'Rechercher dans la rubrique courante');
    input.addEventListener('input', event => filterCurrentSurface(doc, event.target.value || ''));
    search.appendChild(input);
    topbar.appendChild(search);

    const right = createNode(doc, 'div', 'kmc-admin-topbar-right');
    const utilities = header.querySelector?.('.kmc-admin-utility-nav');
    const market = utilities?.querySelector?.('.kmc-admin-market-control');
    const account = utilities?.querySelector?.('.kmc-admin-account');
    if (market) right.appendChild(market);
    if (account) right.appendChild(account);
    topbar.appendChild(right);
    return topbar;
  }

  function placeChrome(doc, header, tabs, topbar) {
    const root = rootNode(doc);
    if (!root) return;
    const parent = root.parentNode || doc.body;

    if (topbar && topbar.parentNode !== parent) parent.insertBefore(topbar, root);

    const oldTabs = doc.getElementById?.('canonical-admin-domain-tabs');
    if (oldTabs && oldTabs !== tabs && oldTabs.parentNode) oldTabs.parentNode.removeChild(oldTabs);
    if (tabs && tabs.parentNode !== parent) parent.insertBefore(tabs, root);
  }

  function removeLegacySecondary(header) {
    const secondary = header.querySelector?.('.kmc-admin-secondary-nav');
    if (secondary && secondary.parentNode) secondary.parentNode.removeChild(secondary);
  }

  function applyHybridShell(header, options = {}) {
    if (!header) return header;
    const doc = options.document || global.document;
    const user = options.user || global.KOMERCE_CANONICAL_AUTH_USER || global.KOMERCE_AUTH_USER || null;
    const surface = currentSurface(options);
    const domainId = currentDomain(surface);

    doc.body?.classList?.add('kmc-shell-v4');
    header.setAttribute('data-navigation-policy', 'v4');
    header.setAttribute('data-shell', 'hybrid-sidebar-tabs');

    decoratePrimaryLinks(header);
    removeLegacySecondary(header);
    const tabs = createTabs(doc, domainId, surface, user);
    const topbar = createTopbar(doc, header);
    placeChrome(doc, header, tabs, topbar);
    observeSurfaceAnchors(doc, domainId);
    return header;
  }

  function mount(options = {}) {
    const header = base.mount(options);
    return applyHybridShell(header, options);
  }

  const api = Object.freeze({
    ...base,
    LOCAL_TABS,
    mount,
    _applyHybridShell: applyHybridShell,
    _activeLocalTab: activeLocalTab,
    _localTabsFor: localTabsFor,
  });

  global.KomerceCanonicalNavigation = api;

  function finalizeExistingNavigation() {
    const doc = global.document;
    if (!doc) return;
    const existing = doc.getElementById?.('canonical-admin-navigation');
    if (!existing) return;
    applyHybridShell(existing, {
      document: doc,
      user: global.KOMERCE_CANONICAL_AUTH_USER || global.KOMERCE_AUTH_USER || null,
      surface: typeof base.surfaceForPath === 'function' ? base.surfaceForPath(global.location?.pathname) : undefined,
      pathname: global.location?.pathname,
    });
  }

  if (global.document?.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', finalizeExistingNavigation, { once: true });
  } else {
    finalizeExistingNavigation();
  }
})(typeof window !== 'undefined' ? window : globalThis);
