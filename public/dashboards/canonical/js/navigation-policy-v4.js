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
 * @version       2026-09-v4.2-business-truth
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
    live: '◉',
    finance: '▤',
    settings: '⚙',
    'control-tower': '⌂',
    'action-center': '!',
    'flow-commerce': '▥',
    'flow-operations': '⇄',
    'flow-finance': '▤',
    'entity-orders': '◇',
    'entity-products': '◇',
    'entity-suppliers': '▦',
    'entity-clients': '♙',
    'workspace-pricing': '▥',
    'workspace-catalog': '▣',
    'workspace-sourcing': '◉',
    'workspace-purchasing': '▧',
    'workspace-operations': '◈',
    'workspace-shipping': '⇢',
    'workspace-accounting': '▤',
    'markets-home': '◎',
    'market-autonomy': '◎',
    'market-catalog': '▣',
  });

  const SIDEBAR_GROUPS = Object.freeze([
    Object.freeze({
      id: 'pilot',
      label: 'Piloter',
      items: Object.freeze([
        Object.freeze({ id: 'control-tower', label: 'Tour de contrôle', href: '/admin/pilotage', roles: ['admin', 'market_operator'], surfaces: ['pilotage'] }),
        Object.freeze({ id: 'action-center', label: 'Action Center', href: '/admin/action-center', roles: ['admin', 'market_operator'], surfaces: ['action-center'] }),
      ]),
    }),
    Object.freeze({
      id: 'flows',
      label: 'Flux',
      items: Object.freeze([
        Object.freeze({ id: 'flow-commerce', label: 'Commerce', href: '/admin/commerce', roles: ['admin', 'market_operator'], surfaces: ['commerce'] }),
        Object.freeze({ id: 'flow-operations', label: 'Commandes & logistique', href: '/admin/operations', roles: ['admin', 'market_operator'], surfaces: ['operations'] }),
        Object.freeze({ id: 'flow-finance', label: 'Finance', href: '/admin/finance', roles: ['admin', 'market_operator'], surfaces: ['finance'] }),
      ]),
    }),
    Object.freeze({
      id: 'entities',
      label: 'Entités',
      items: Object.freeze([
        Object.freeze({ id: 'entity-orders', label: 'Commandes', href: '/admin/orders', roles: ['admin', 'market_operator'], surfaces: ['orders', 'order-360'] }),
        Object.freeze({ id: 'entity-products', label: 'Produits', href: '/admin/workspaces/catalog?view=advanced', roles: ['admin'], surfaces: ['product-360'] }),
        Object.freeze({ id: 'entity-suppliers', label: 'Fournisseurs', href: '/admin/suppliers', roles: ['admin'], surfaces: ['supplier-360'] }),
        Object.freeze({ id: 'entity-clients', label: 'Clients', href: '/admin/clients', roles: ['admin', 'market_operator'], capability: 'client.read', surfaces: ['client-index', 'client-360'] }),
      ]),
    }),
    Object.freeze({
      id: 'workspaces',
      label: 'Workspaces',
      items: Object.freeze([
        Object.freeze({ id: 'workspace-pricing', label: 'Atelier économique', href: '/admin/workspaces/pricing', roles: ['admin', 'market_operator'], surfaces: ['pricing-workspace'] }),
        Object.freeze({ id: 'workspace-catalog', label: 'Catalogue', href: '/admin/workspaces/catalog', roles: ['admin'], surfaces: ['catalog-workspace'] }),
        Object.freeze({ id: 'workspace-sourcing', label: 'Sourcing', href: '/admin/workspaces/sourcing', roles: ['admin', 'sourcing'], surfaces: ['sourcing-workspace'] }),
        Object.freeze({ id: 'workspace-purchasing', label: 'Achats fournisseurs', href: '/admin/workspaces/purchasing', roles: ['admin'], surfaces: ['purchasing-workspace'] }),
        Object.freeze({ id: 'workspace-operations', label: 'Hub & Relais', href: '/admin/workspaces/operations', roles: ['admin', 'agent_hub', 'agent_relais', 'market_operator'], surfaces: ['operations-workspace'] }),
        Object.freeze({ id: 'workspace-shipping', label: 'Expéditions & Douane', href: '/admin/workspaces/shipping-customs', roles: ['admin', 'agent_hub', 'agent_transitaire', 'market_operator'], surfaces: ['shipping-customs-workspace'] }),
        Object.freeze({ id: 'workspace-accounting', label: 'Finance / Comptabilité', href: '/admin/workspaces/accounting', roles: ['admin', 'finance', 'agent_relais', 'market_operator'], surfaces: ['accounting-workspace'] }),
      ]),
    }),
    Object.freeze({
      id: 'markets',
      label: 'Marchés',
      items: Object.freeze([
        Object.freeze({ id: 'markets-home', label: 'Marchés', href: '/dashboards/canonical/access.html', roles: ['admin'], surfaces: ['market-access'] }),
        Object.freeze({ id: 'market-autonomy', label: 'Autonomie marché', href: '/dashboards/canonical/market-autonomy.html', roles: ['market_operator'], surfaces: ['market-autonomy'] }),
        Object.freeze({ id: 'market-catalog', label: 'Catalogue pays', href: '/dashboards/canonical/market-catalog.html', roles: ['market_operator'], surfaces: ['market-catalog'] }),
      ]),
    }),
    Object.freeze({
      id: 'administration',
      label: 'Administration',
      items: Object.freeze([
        Object.freeze({ id: 'settings', label: 'Paramètres', href: '/admin/settings', roles: ['admin'], surfaces: ['settings'] }),
      ]),
    }),
  ]);

  const LOCAL_TABS = Object.freeze({
    pricing: Object.freeze([
      Object.freeze({ id: 'pricing-overview', label: 'Vue d’ensemble', href: '/admin/workspaces/pricing', roles: ['admin', 'market_operator'] }),
      Object.freeze({ id: 'pricing-products', label: 'Produits', href: '/admin/workspaces/pricing#pricing-products', roles: ['admin', 'market_operator'] }),
      Object.freeze({ id: 'pricing-costs', label: 'Coûts', href: '/admin/workspaces/pricing#pricing-costs', roles: ['admin', 'market_operator'] }),
      Object.freeze({ id: 'pricing-strategy', label: 'Stratégie', href: '/admin/workspaces/pricing#pricing-strategy', roles: ['admin', 'market_operator'] }),
    ]),
    catalog: Object.freeze([
      Object.freeze({ id: 'catalog-overview', label: 'Vue catalogue', href: '/admin/workspaces/catalog', roles: ['admin'] }),
      Object.freeze({ id: 'catalog-products', label: 'Produits', href: '/admin/workspaces/catalog?view=advanced', roles: ['admin'] }),
    ]),
    orders: Object.freeze([
      Object.freeze({ id: 'commerce', label: 'Vue d’ensemble', href: '/admin/commerce', roles: ['admin', 'market_operator'] }),
      Object.freeze({ id: 'orders-overview', label: 'Commandes', href: '/admin/orders', roles: ['admin', 'market_operator'] }),
      // GAP 3 / LOT A (A2) : 'client.read' est une capability DELEGATION
      // (cf. config/market-delegation-capabilities.js) — un market_operator
      // qui la détient sur son marché doit voir la tab, un admin (global ou
      // scoped) la voit toujours (tabCapabilityGranted ne filtre qu'en mode
      // market avec adminContext résolu).
      Object.freeze({ id: 'clients', label: 'Clients', href: '/admin/clients', roles: ['admin', 'market_operator'], capability: 'client.read' }),
    ]),
    markets: Object.freeze([
      Object.freeze({ id: 'market-access', label: 'Accès pays', href: '/dashboards/canonical/access.html', roles: ['admin'] }),
      Object.freeze({ id: 'market-autonomy', label: 'Autonomie marché', href: '/dashboards/canonical/market-autonomy.html', roles: ['market_operator'] }),
      Object.freeze({ id: 'catalog-country', label: 'Catalogue pays', href: '/dashboards/canonical/market-catalog.html', roles: ['market_operator'] }),
    ]),
  });

  const PRICING_SECTION_IDS = Object.freeze({
    'Décision produit': 'pricing-products',
    'Atelier des coûts': 'pricing-costs',
    'Stratégie & concurrence': 'pricing-strategy',
  });

  const SHELL_SELECTORS = Object.freeze({
    navigation: '#canonical-admin-navigation, [data-canonical-navigation="true"], [data-canonical-shell-role="navigation"]',
    topbar: '#canonical-admin-topbar, [data-canonical-shell-role="topbar"]',
    tabs: '#canonical-admin-domain-tabs, [data-canonical-shell-role="domain-tabs"]',
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

  function uniqueNodes(doc, selector) {
    const nodes = Array.from(doc.querySelectorAll?.(selector) || []);
    return nodes.filter((node, index) => nodes.indexOf(node) === index);
  }

  function dedupeRole(doc, role, keep = null) {
    const selector = SHELL_SELECTORS[role];
    if (!selector) return keep;
    const nodes = uniqueNodes(doc, selector);
    let survivor = keep && nodes.includes(keep) ? keep : (keep || nodes[0] || null);
    nodes.forEach(node => {
      if (node !== survivor) node.remove?.();
    });
    return survivor;
  }

  function dedupeShell(doc, keepHeader = null) {
    const navigation = dedupeRole(doc, 'navigation', keepHeader);
    dedupeRole(doc, 'topbar');
    dedupeRole(doc, 'tabs');
    return navigation;
  }

  function sidebarItemVisible(item, user, adminContext) {
    const role = roleOf(user);
    if (!(item.roles || []).includes(role)) return false;
    return tabCapabilityGranted(item, adminContext);
  }

  function sidebarGroupsFor(user, adminContext) {
    return SIDEBAR_GROUPS
      .map(group => Object.freeze({
        ...group,
        items: Object.freeze(group.items.filter(item => sidebarItemVisible(item, user, adminContext))),
      }))
      .filter(group => group.items.length > 0);
  }

  function sidebarItemActive(item, surface) {
    if ((item.surfaces || []).includes(surface)) return true;
    const current = String(global.location?.pathname || '');
    return current && current === String(item.href || '').split('?')[0];
  }

  function renderGroupedSidebar(doc, header, user, adminContext, surface) {
    const primary = header.querySelector?.('.kmc-admin-primary-nav');
    if (!primary) return;
    primary.replaceChildren();

    sidebarGroupsFor(user, adminContext).forEach(group => {
      const wrap = createNode(doc, 'div', 'kmc-admin-sidebar-group');
      wrap.setAttribute('data-nav-group', group.id);
      wrap.appendChild(createNode(doc, 'div', 'kmc-admin-sidebar-group-label', group.label));

      group.items.forEach(item => {
        const link = createNode(doc, 'a', 'kmc-admin-primary-link');
        link.href = item.href;
        link.setAttribute('data-dashboard', item.id);
        if (sidebarItemActive(item, surface)) {
          link.className += ' is-active';
          link.setAttribute('aria-current', 'page');
        }
        link.appendChild(createNode(doc, 'span', 'kmc-admin-primary-icon', ICONS[item.id] || '•'));
        link.appendChild(createNode(doc, 'span', 'kmc-admin-primary-label', item.label));
        wrap.appendChild(link);
      });
      primary.appendChild(wrap);
    });
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

  // Une tab déclarant `capability` (ex. 'clients' → 'client.read') n'est
  // visible en mode market que si le marché courant (adminContext.access.
  // defaultMarket) porte réellement cette capability dans
  // adminContext.access.delegatedCapabilities — capability is the authority,
  // not role (cf. doctrine dashboard-admin-context.js). Un rôle sans
  // adminContext résolu (pages qui ne le passent pas encore, ou mode global
  // où la capability DELEGATION ne s'applique pas) garde le comportement
  // role-only historique plutôt que de masquer la tab par défaut.
  function tabCapabilityGranted(tab, adminContext) {
    if (!tab.capability) return true;
    if (!adminContext || adminContext.access?.mode !== 'market') return true;
    const market = adminContext.access.defaultMarket;
    const granted = adminContext.access.delegatedCapabilities?.[market] || [];
    return granted.includes(tab.capability);
  }

  function localTabsFor(domainId, user, adminContext) {
    const role = roleOf(user);
    const local = LOCAL_TABS[domainId];
    if (local) {
      return local.filter(tab => tab.roles.includes(role) && tabCapabilityGranted(tab, adminContext));
    }

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
      if (search.get('view') === 'advanced') return 'catalog-products';
      return 'catalog-overview';
    }
    if (domainId === 'orders') {
      if (surface === 'client-index' || surface === 'client-360') return 'clients';
      if (surface === 'orders' || surface === 'order-360') return 'orders-overview';
      return 'commerce';
    }
    if (domainId === 'markets') {
      if (surface === 'market-catalog') return 'catalog-country';
      return surface === 'market-autonomy' ? 'market-autonomy' : 'market-access';
    }
    if (typeof base.activeSpaceFor === 'function') return base.activeSpaceFor(surface);
    return path;
  }

  function createTabs(doc, domainId, surface, user, adminContext) {
    const tabs = localTabsFor(domainId, user, adminContext);
    if (tabs.length < 2) return null;

    const nav = createNode(doc, 'nav', 'kmc-admin-domain-tabs');
    nav.id = 'canonical-admin-domain-tabs';
    nav.setAttribute('data-canonical-shell-role', 'domain-tabs');
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

  // Navigation only: the server resolver owns entity identity, market scope and
  // destination authority. Never infer a destination from the typed prefix.
  const REFERENCE_SEARCH_ENDPOINT = '/api/admin/dashboard/reference/resolve';

  function safeCanonicalHref(value) {
    const href = String(value || '');
    if (!href.startsWith('/admin/') || href.startsWith('//') || /[\\\\\r\n]/.test(href)) return null;
    return href;
  }

  function resultReferenceLabel(match) {
    return [match.entity_type || 'Référence', match.matched_reference || match.canonical_id || '—'].join(' · ');
  }

  function renderReferenceResults(doc, host, payload) {
    host.replaceChildren();
    const matches = Array.isArray(payload && payload.matches) ? payload.matches : [];
    const orphans = Array.isArray(payload && payload.orphans) ? payload.orphans : [];
    if (!matches.length && !orphans.length) {
      host.appendChild(createNode(doc, 'p', 'kmc-admin-reference-message', 'Aucune référence accessible trouvée.'));
      return;
    }
    matches.forEach(match => {
      const href = safeCanonicalHref(match.canonical_href) || safeCanonicalHref(match.fallback_href);
      const row = createNode(doc, href ? 'a' : 'div', 'kmc-admin-reference-result');
      if (href) row.setAttribute('href', href);
      row.appendChild(createNode(doc, 'strong', 'kmc-admin-reference-name', resultReferenceLabel(match)));
      const position = match.current_position || {};
      const details = [
        match.customer_order_reference ? 'Commande ' + match.customer_order_reference : null,
        match.market_code || null,
        position.stage || null,
        position.health || null,
      ].filter(Boolean).join(' · ');
      row.appendChild(createNode(doc, 'span', 'kmc-admin-reference-detail', details));
      host.appendChild(row);
    });
    orphans.forEach(orphan => {
      const row = createNode(doc, 'div', 'kmc-admin-reference-result kmc-admin-reference-orphan');
      row.appendChild(createNode(doc, 'strong', 'kmc-admin-reference-name', 'Référence orpheline · ' + resultReferenceLabel(orphan)));
      const details = [
        orphan.canonical_owner ? 'Owner ' + orphan.canonical_owner : null,
        orphan.reason === 'missing_customer_order_lineage' ? 'Rattachement à une commande introuvable' : null,
      ].filter(Boolean).join(' · ');
      row.appendChild(createNode(doc, 'span', 'kmc-admin-reference-detail', details));
      host.appendChild(row);
    });
  }

  function createTopbar(doc, header) {
    let topbar = dedupeRole(doc, 'topbar');
    if (topbar) return topbar;

    topbar = createNode(doc, 'div', 'kmc-admin-topbar');
    topbar.id = 'canonical-admin-topbar';
    topbar.setAttribute('data-canonical-shell-role', 'topbar');

    const search = createNode(doc, 'form', 'kmc-admin-search');
    search.setAttribute('role', 'search');
    const icon = createNode(doc, 'span', 'kmc-admin-search-icon', '⌕');
    icon.setAttribute('aria-hidden', 'true');
    search.appendChild(icon);
    const input = createNode(doc, 'input', 'kmc-admin-search-input');
    input.type = 'search';
    input.name = 'reference';
    input.maxLength = 200;
    input.autocomplete = 'off';
    input.placeholder = 'Référence commande, PO, colis, HUB…';
    input.setAttribute('aria-label', 'Rechercher une référence opérationnelle');
    search.appendChild(input);
    const submit = createNode(doc, 'button', 'kmc-admin-reference-submit', 'Trouver');
    submit.type = 'submit';
    search.appendChild(submit);
    const results = createNode(doc, 'div', 'kmc-admin-reference-results');
    results.hidden = true;
    results.setAttribute('role', 'status');
    results.setAttribute('aria-live', 'polite');
    search.appendChild(results);

    let requestSequence = 0;
    search.addEventListener('submit', async event => {
      event.preventDefault();
      const reference = String(input.value || '').trim();
      if (!reference || reference.length > 200) return;
      const sequence = ++requestSequence;
      results.hidden = false;
      results.replaceChildren(createNode(doc, 'p', 'kmc-admin-reference-message', 'Recherche en cours…'));
      submit.disabled = true;
      try {
        const response = await global.fetch(
          REFERENCE_SEARCH_ENDPOINT + '?reference=' + encodeURIComponent(reference),
          { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } }
        );
        if (sequence !== requestSequence) return;
        if (!response.ok) throw new Error(response.status === 403 ? 'Référence non accessible.' : 'Recherche indisponible.');
        const payload = await response.json();
        if (sequence !== requestSequence) return;
        renderReferenceResults(doc, results, payload);
      } catch (_) {
        if (sequence === requestSequence) {
          results.replaceChildren(createNode(doc, 'p', 'kmc-admin-reference-message', 'Recherche indisponible ou accès refusé.'));
        }
      } finally {
        if (sequence === requestSequence) submit.disabled = false;
      }
    });
    input.addEventListener('input', () => {
      requestSequence += 1;
      submit.disabled = false;
      results.hidden = true;
      results.replaceChildren();
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        requestSequence += 1;
        submit.disabled = false;
        results.hidden = true;
        results.replaceChildren();
      }
    });
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

    dedupeRole(doc, 'navigation', header);
    if (topbar) dedupeRole(doc, 'topbar', topbar);
    if (tabs) dedupeRole(doc, 'tabs', tabs);
    else dedupeRole(doc, 'tabs', null)?.remove?.();

    if (topbar && topbar.parentNode !== parent) parent.insertBefore(topbar, root);
    if (tabs && tabs.parentNode !== parent) parent.insertBefore(tabs, root);
  }

  function removeLegacySecondary(header) {
    const secondary = header.querySelector?.('.kmc-admin-secondary-nav');
    if (secondary && secondary.parentNode) secondary.parentNode.removeChild(secondary);
  }

  function applyHybridShell(header, options = {}) {
    if (!header) return header;
    const doc = options.document || global.document;
    dedupeShell(doc, header);

    const user = options.user || global.KOMERCE_CANONICAL_AUTH_USER || global.KOMERCE_AUTH_USER || null;
    // GAP 3 / LOT A (A2) : les tabs N2 gérées par capability DELEGATION
    // (ex. 'clients') ont besoin du adminContext résolu serveur — jamais
    // fourni par défaut avant cette lot, donc les tabs restaient
    // role-only. global.KOMERCE_CANONICAL_ADMIN_CONTEXT couvre les appels
    // historiques de mount() qui ne passent pas encore adminContext en options.
    const adminContext = options.adminContext || global.KOMERCE_CANONICAL_ADMIN_CONTEXT || null;
    const surface = currentSurface(options);
    const domainId = currentDomain(surface);

    doc.body?.classList?.add('kmc-shell-v4');
    // Cockpits Live : coque entièrement noire (sidebar, barre du haut, onglets, contenu).
    doc.body?.classList?.toggle?.('kmc-shell-live', domainId === 'live');
    header.setAttribute('data-navigation-policy', 'v4');
    header.setAttribute('data-shell', 'hybrid-sidebar-tabs');
    header.setAttribute('data-canonical-shell-role', 'navigation');

    renderGroupedSidebar(doc, header, user, adminContext, surface);
    decoratePrimaryLinks(header);
    removeLegacySecondary(header);
    const tabs = createTabs(doc, domainId, surface, user, adminContext);
    const topbar = createTopbar(doc, header);
    placeChrome(doc, header, tabs, topbar);
    observeSurfaceAnchors(doc, domainId);
    return header;
  }

  function mount(options = {}) {
    const doc = options.document || global.document;
    dedupeShell(doc);
    const header = base.mount(options);
    return applyHybridShell(header, options);
  }

  const api = Object.freeze({
    ...base,
    LOCAL_TABS,
    SIDEBAR_GROUPS,
    sidebarGroupsFor,
    safeCanonicalHref,
    renderReferenceResults,
    REFERENCE_SEARCH_ENDPOINT,
    mount,
    _applyHybridShell: applyHybridShell,
    _activeLocalTab: activeLocalTab,
    _localTabsFor: localTabsFor,
    _dedupeShell: dedupeShell,
    _dedupeRole: dedupeRole,
  });

  global.KomerceCanonicalNavigation = api;

  function finalizeExistingNavigation() {
    const doc = global.document;
    if (!doc) return;
    const existing = dedupeRole(doc, 'navigation');
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
