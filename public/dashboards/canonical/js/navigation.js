/**
 * @komerce-arch
 * @role          canonical-admin-navigation
 * @domain        admin-dashboard
 * @layer         ui-navigation
 * @criticality   medium
 * @inputs        canonical_surface, url_path, authenticated_user, server_admin_context
 * @outputs       capability_aligned_navigation, logical_back_navigation, market_selector_proxy
 * @depends       canonical admin app surface contract
 * @used-by       canonical admin runtime
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      country_manager_owns_market_scope, visible_destination_must_have_server_guard, client_market_id_never_authority
 * @impact-areas  admin-dashboard, navigation
 * @version       2026-09
 */

'use strict';

(function initCanonicalNavigation(global) {
  'use strict';

  // NAV-V2.1 — contrat de données : docs/doctrine/ADMIN_NAVIGATION_DOCTRINE_V2.md §2/§4/§6.
  // N1 = domaines métier stables. N2 = espaces contextuels du domaine actif.
  // Chaque space.roles / domain.roles reflète un guard serveur réellement
  // vérifié (docs/admin-nav-capability-map.md) — jamais une extension
  // silencieuse côté client.
  const DOMAINS = Object.freeze([
    Object.freeze({ id: 'dashboard', label: 'Dashboard', href: '/admin/pilotage', roles: Object.freeze(['admin', 'market_operator', 'finance', 'sourcing', 'agent_hub', 'agent_relais', 'agent_transitaire', 'support']) }),
    Object.freeze({ id: 'pricing', label: 'Atelier économique', href: '/admin/workspaces/pricing', roles: Object.freeze(['admin', 'market_operator']) }),
    Object.freeze({ id: 'catalog', label: 'Catalogue', href: '/admin/workspaces/catalog', roles: Object.freeze(['admin', 'market_operator']) }),
    Object.freeze({
      id: 'orders',
      label: 'Commandes',
      // Domaine groupé (doctrine §4/§9) : Commerce (surface existante,
      // inchangée) + Suivi des commandes (nouvelle surface decision-first
      // MOCK-ORD-001). Additif et réversible d'une ligne — aucun domaine
      // « Commerce » distinct n'existait avant ce lot.
      spaces: Object.freeze([
        Object.freeze({ id: 'commerce', label: 'Commerce', href: '/admin/commerce', roles: Object.freeze(['admin', 'market_operator']) }),
        Object.freeze({ id: 'orders-overview', label: 'Suivi des commandes', href: '/admin/orders', roles: Object.freeze(['admin', 'market_operator']) }),
      ]),
    }),
    Object.freeze({ id: 'markets', label: 'Marchés', href: '/dashboards/canonical/access.html', roles: Object.freeze(['admin', 'market_operator']) }),
    Object.freeze({
      id: 'operations',
      label: 'Opérations',
      // Ordre canonique doctrine §4 : Vue d'ensemble, Hub / Relais,
      // Expéditions & Douane, Sourcing.
      spaces: Object.freeze([
        Object.freeze({ id: 'operations-overview', label: 'Vue d’ensemble', href: '/admin/operations', roles: Object.freeze(['admin', 'market_operator']) }),
        Object.freeze({ id: 'operations-workspace', label: 'Hub / Relais', href: '/admin/workspaces/operations', roles: Object.freeze(['admin', 'agent_hub', 'agent_relais', 'market_operator']) }),
        Object.freeze({ id: 'shipping-customs-workspace', label: 'Expéditions & Douane', href: '/admin/workspaces/shipping-customs', roles: Object.freeze(['admin', 'agent_hub', 'agent_transitaire', 'market_operator']) }),
        Object.freeze({ id: 'purchasing-workspace', label: 'Achats fournisseurs', href: '/admin/workspaces/purchasing', roles: Object.freeze(['admin']) }),
      ]),
    }),
    Object.freeze({
      id: 'live',
      label: 'Live',
      // Cockpits opérationnels temps réel (coque noire dédiée). Hub live et
      // Relais live viendront ici comme espaces N2 ; les écrans de gestion
      // restent dans Opérations.
      spaces: Object.freeze([
        Object.freeze({ id: 'import-runtime', label: 'Sourcing live', href: '/admin/import-runtime', roles: Object.freeze(['admin', 'sourcing']) }),
        Object.freeze({ id: 'hub-live', label: 'Hub live', href: '/admin/hub-live', roles: Object.freeze(['admin', 'agent_hub']) }),
        Object.freeze({ id: 'relais-live', label: 'Relais live', href: '/admin/relais-live', roles: Object.freeze(['admin', 'agent_relais']) }),
      ]),
    }),
    Object.freeze({
      id: 'finance',
      label: 'Finance',
      // Ordre canonique doctrine §4 : Vue d'ensemble, Comptabilité.
      spaces: Object.freeze([
        Object.freeze({ id: 'finance-overview', label: 'Vue d’ensemble', href: '/admin/finance', roles: Object.freeze(['admin', 'market_operator']) }),
        Object.freeze({ id: 'accounting-workspace', label: 'Comptabilité', href: '/admin/workspaces/accounting', roles: Object.freeze(['admin', 'finance', 'agent_relais', 'market_operator']) }),
      ]),
    }),
  ]);

  // Paramètres n'est plus un domaine métier N1 (doctrine §2/§5) — il vit dans
  // la zone utilitaire, réservé à l'autorité globale.
  const SETTINGS_UTILITY = Object.freeze({ id: 'settings', label: 'Paramètres', href: '/admin/settings', roles: Object.freeze(['admin']) });

  // Rich admin map — restores capability discoverability without recreating
  // the historical 30-runtime architecture. Admin only: other roles keep the
  // role-filtered domain navigation above.
  const ADMIN_CAPABILITY_GROUPS = Object.freeze([
    Object.freeze({
      label: 'Dashboards',
      items: Object.freeze([
        Object.freeze({ id: 'dashboard-pilotage', label: 'Pilotage', href: '/admin/pilotage' }),
        Object.freeze({ id: 'dashboard-commerce', label: 'Commerce', href: '/admin/commerce' }),
        Object.freeze({ id: 'dashboard-operations', label: 'Opérations', href: '/admin/operations' }),
        Object.freeze({ id: 'dashboard-finance', label: 'Finance', href: '/admin/finance' }),
      ]),
    }),
    Object.freeze({
      label: 'Pilotage',
      items: Object.freeze([
        Object.freeze({ id: 'health', label: 'Activité / Santé', href: '/admin/sante' }),
        Object.freeze({ id: 'sales', label: 'Ventes', href: '/admin/sales' }),
        Object.freeze({ id: 'action-center', label: 'Action Center', href: '/admin/action-center' }),
        Object.freeze({ id: 'forecast', label: 'Prévisions', href: '/admin/pilotage-fin?legacy=1' }),
      ]),
    }),
    Object.freeze({
      label: 'Commerce',
      items: Object.freeze([
        Object.freeze({ id: 'orders-overview', label: 'Commandes', href: '/admin/orders' }),
        Object.freeze({ id: 'clients', label: 'Clients', href: '/admin/clients' }),
        Object.freeze({ id: 'shared-carts', label: 'Partages', href: '/admin/shared-carts' }),
      ]),
    }),
    Object.freeze({
      label: 'Catalogue',
      items: Object.freeze([
        Object.freeze({ id: 'catalog', label: 'Produits & catalogue', href: '/admin/workspaces/catalog' }),
        Object.freeze({ id: 'sourcing-workspace', label: 'Sourcing', href: '/admin/workspaces/sourcing' }),
        Object.freeze({ id: 'suppliers', label: 'Fournisseurs', href: '/admin/suppliers' }),
      ]),
    }),
    Object.freeze({
      label: 'Opérations',
      items: Object.freeze([
        Object.freeze({ id: 'operations-workspace', label: 'Hub / Relais', href: '/admin/workspaces/operations' }),
        Object.freeze({ id: 'shipping-customs-workspace', label: 'Expéditions & Douane', href: '/admin/workspaces/shipping-customs' }),
        Object.freeze({ id: 'purchasing-workspace', label: 'Achats fournisseurs', href: '/admin/workspaces/purchasing' }),
        Object.freeze({ id: 'transit', label: 'Transit', href: '/admin/transitaire' }),
        Object.freeze({ id: 'customs', label: 'Douane', href: '/admin/customs' }),
      ]),
    }),
    Object.freeze({
      label: 'Live',
      items: Object.freeze([
        Object.freeze({ id: 'import-runtime', label: 'Sourcing live', href: '/admin/import-runtime' }),
        Object.freeze({ id: 'hub-live', label: 'Hub live', href: '/admin/hub-live' }),
        Object.freeze({ id: 'relais-live', label: 'Relais live', href: '/admin/relais-live' }),
      ]),
    }),
    Object.freeze({
      label: 'Finance',
      items: Object.freeze([
        Object.freeze({ id: 'accounting-workspace', label: 'Comptabilité', href: '/admin/workspaces/accounting' }),
        Object.freeze({ id: 'pricing-workspace', label: 'Atelier économique', href: '/admin/workspaces/pricing' }),
        Object.freeze({ id: 'costing', label: 'Coûts', href: '/admin/costing?legacy=1' }),
        Object.freeze({ id: 'economic', label: 'Économie', href: '/admin/economic?legacy=1' }),
      ]),
    }),
    Object.freeze({
      label: 'Marchés',
      items: Object.freeze([
        Object.freeze({ id: 'markets', label: 'Accès & marchés', href: '/dashboards/canonical/access.html' }),
      ]),
    }),
    Object.freeze({
      label: 'Configuration',
      items: Object.freeze([
        Object.freeze({ id: 'simulator', label: 'Simulation', href: '/admin/simulator' }),
      ]),
    }),
  ]);

  function visibleSpacesFor(domain, role) {
    if (!domain || !Array.isArray(domain.spaces)) return Object.freeze([]);
    return Object.freeze(domain.spaces.filter(space => (space.roles || []).includes(role)));
  }

  function domainIsVisible(domain, role) {
    // Dashboard reste la destination de défense en profondeur : tout rôle
    // connu OU inconnu y a droit, comme l'ancien fallback ROLE_VISIBLE_TABS[role] || ['dashboard'].
    if (domain.id === 'dashboard') return true;
    if (Array.isArray(domain.spaces)) return visibleSpacesFor(domain, role).length > 0;
    return (domain.roles || []).includes(role);
  }

  function visibleDomainsFor(user) {
    const role = (user && user.role) || '';
    return Object.freeze(DOMAINS.filter(domain => domainIsVisible(domain, role)));
  }

  // Rétro-compatibilité : certains appelants (app.js) attendaient encore une
  // liste plate d'ids visibles. On la dérive désormais de visibleDomainsFor().
  function visibleNavigationFor(user, adminContext) {
    return visibleDomainsFor(user);
  }

  function landingForDomain(domain, user) {
    if (!Array.isArray(domain.spaces)) return hrefFor(domain, user);
    const role = (user && user.role) || '';
    const spaces = visibleSpacesFor(domain, role);
    return spaces.length ? spaces[0].href : null;
  }

  // Parentage des surfaces techniques vers leur domaine N1 — doctrine §9.
  const SURFACE_TO_DOMAIN = Object.freeze({
    pilotage: 'dashboard',
    'action-center': 'dashboard',
    demo: 'dashboard',

    'pricing-workspace': 'pricing',

    'catalog-workspace': 'catalog',
    'market-catalog': 'catalog',
    'product-360': 'catalog',
    'supplier-360': 'catalog',

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
    'purchasing-workspace': 'operations',
    'sourcing-workspace': 'catalog',
    'import-runtime': 'live',
    'hub-live': 'live',
    'relais-live': 'live',

    finance: 'finance',
    'accounting-workspace': 'finance',

    settings: 'settings',
  });

  // Parentage des surfaces techniques vers leur espace N2 (uniquement pour
  // les domaines groupés Opérations / Finance).
  const SURFACE_TO_SPACE = Object.freeze({
    commerce: 'commerce',
    orders: 'orders-overview',
    'order-360': 'commerce',
    'client-index': 'commerce',
    'client-360': 'commerce',

    operations: 'operations-overview',
    'operations-workspace': 'operations-workspace',
    'shipping-customs-workspace': 'shipping-customs-workspace',
    'purchasing-workspace': 'purchasing-workspace',
    'import-runtime': 'import-runtime',
    'hub-live': 'hub-live',
    'relais-live': 'relais-live',

    finance: 'finance-overview',
    'accounting-workspace': 'accounting-workspace',
  });

  const BACK_TARGETS = Object.freeze({
    'action-center': Object.freeze({ href:'/admin/pilotage', label:'Retour au pilotage' }),
    'order-360': Object.freeze({ href:'/admin/commerce', label:'Retour au commerce' }),
    'client-index': Object.freeze({ href:'/admin/commerce', label:'Retour au commerce' }),
    'client-360': Object.freeze({ href:'/admin/clients', label:'Retour aux clients' }),
    'product-360': Object.freeze({ href:'/admin/workspaces/catalog', label:'Retour au catalogue' }),
    'supplier-360': Object.freeze({ href:'/admin/workspaces/sourcing', label:'Retour au sourcing' }),
    demo: Object.freeze({ href:'/admin/pilotage', label:'Retour au pilotage' }),
  });

  function safeReturnTarget(value) {
    const target = String(value || '').trim();
    if (!target || !target.startsWith('/') || target.startsWith('//') || target.includes('\\')) return null;
    const pathname = target.split(/[?#]/, 1)[0];
    if (pathname === '/admin' || pathname.startsWith('/admin/')) return target;
    if (pathname.startsWith('/dashboards/canonical/')) return target;
    return null;
  }

  function withReturnTo(path, returnTo, label = 'Retour') {
    const target = safeReturnTarget(returnTo);
    if (!target) return String(path || '');
    const q = new URLSearchParams();
    q.set('return_to', target);
    if (label) q.set('return_label', String(label));
    const base = String(path || '');
    return base + (base.includes('?') ? '&' : '?') + q.toString();
  }

  function resolveBackTarget(surface, search) {
    let requestedHref = null;
    let requestedLabel = null;
    try {
      const query = new URLSearchParams(String(search || '').replace(/^\?/, ''));
      requestedHref = safeReturnTarget(query.get('return_to'));
      const rawLabel = String(query.get('return_label') || '').trim();
      requestedLabel = rawLabel && rawLabel.length <= 48 ? rawLabel : null;
    } catch (_) {
      requestedHref = null;
      requestedLabel = null;
    }
    if (requestedHref) {
      return Object.freeze({
        href: requestedHref,
        label: requestedLabel || 'Retour',
        contextual: true,
      });
    }
    const fallback = BACK_TARGETS[surface];
    return fallback ? Object.freeze({ ...fallback, contextual:false }) : null;
  }

  function textNode(doc, tagName, className, value) {
    const node = doc.createElement(tagName);
    if (className) node.className = className;
    node.textContent = value;
    return node;
  }

  function surfaceForPath(pathname) {
    const path = String(pathname || '');
    if (
      path === '/dashboards/canonical/access.html'
      || path === '/dashboards/canonical/market-autonomy.html'
      || path === '/dashboards/canonical/market-catalog.html'
    ) {
      if (path.includes('access')) return 'market-access';
      if (path.includes('market-catalog')) return 'market-catalog';
      return 'market-autonomy';
    }
    if (path === '/admin/settings') return 'settings';

    const app = global.KomerceCanonicalAdmin;
    if (!app || typeof app.surfaceForPath !== 'function') return 'pilotage';
    return app.surfaceForPath(pathname);
  }

  function activePrimarySurface(surface) {
    return SURFACE_TO_DOMAIN[surface] || 'dashboard';
  }

  function activeSpaceFor(surface) {
    return SURFACE_TO_SPACE[surface] || null;
  }

  function hrefFor(item, user) {
    if (item.id === 'markets' && user && user.role === 'market_operator') {
      return '/dashboards/canonical/market-autonomy.html';
    }
    if (item.id === 'catalog' && user && user.role === 'market_operator') {
      return '/dashboards/canonical/market-catalog.html';
    }
    return item.href;
  }

  function createLink(doc, item, href, isActive, className) {
    const link = doc.createElement('a');
    link.className = className;
    link.href = href;
    link.textContent = item.label;
    link.setAttribute('data-dashboard', item.id);
    if (isActive) {
      link.className += ' is-active';
      link.setAttribute('aria-current', 'page');
    }
    return link;
  }

  function createDomainLink(doc, domain, activeDomainId, user) {
    const href = Array.isArray(domain.spaces) ? landingForDomain(domain, user) : hrefFor(domain, user);
    return createLink(doc, domain, href, domain.id === activeDomainId, 'kmc-admin-primary-link');
  }

  function createAdminCapabilityGroup(doc, group, pathname) {
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-admin-capability-group';

    const label = textNode(doc, 'div', 'kmc-admin-capability-group-label', group.label);
    wrap.appendChild(label);

    const currentPath = String(pathname || '').split('?')[0];
    group.items.forEach(item => {
      const targetPath = String(item.href || '').split('?')[0];
      const isActive = currentPath === targetPath;
      const link = createLink(doc, item, item.href, isActive, 'kmc-admin-primary-link kmc-admin-capability-link');
      wrap.appendChild(link);
    });
    return wrap;
  }

  function createSpaceLink(doc, space, activeSpaceId) {
    return createLink(doc, space, space.href, space.id === activeSpaceId, 'kmc-admin-secondary-link');
  }

  function runtimeIsStaging(payload) {
    return String(payload && payload.komerce_env || '').trim().toLowerCase() === 'staging';
  }

  async function postStagingAdminAction(path, body) {
    const response = await global.fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    let payload = {};
    try { payload = await response.json(); } catch (_) { /* réponse non JSON */ }
    if (!response.ok) {
      throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
    }
    return payload;
  }

  async function mountStagingAdminTools(doc, configurationGroup) {
    if (!configurationGroup || typeof global.fetch !== 'function') return false;

    try {
      // Fail closed: les outils destructifs ne sont projetés que lorsque
      // le serveur lui-même déclare KOMERCE_ENV=staging.
      const response = await global.fetch('/health', {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return false;
      const runtime = await response.json();
      if (!runtimeIsStaging(runtime)) return false;

      const tools = doc.createElement('div');
      tools.className = 'kmc-admin-staging-tools';
      tools.setAttribute('data-staging-tools', 'true');

      const badge = textNode(doc, 'div', 'kmc-admin-staging-badge', 'STAGING');
      tools.appendChild(badge);

      const reset = textNode(doc, 'button', 'kmc-admin-staging-action is-danger', 'Reset commandes');
      reset.type = 'button';
      reset.setAttribute('data-admin-action', 'reset-orders');

      const seed = textNode(doc, 'button', 'kmc-admin-staging-action is-seed', 'Seed test');
      seed.type = 'button';
      seed.setAttribute('data-admin-action', 'seed-test');

      const status = textNode(doc, 'div', 'kmc-admin-staging-status', '');
      status.setAttribute('aria-live', 'polite');

      reset.addEventListener('click', async () => {
        const confirmFn = typeof global.confirm === 'function' ? global.confirm.bind(global) : null;
        if (!confirmFn || !confirmFn('Supprimer toutes les commandes et données de session de test sur STAGING ?')) return;
        reset.disabled = true;
        seed.disabled = true;
        status.className = 'kmc-admin-staging-status';
        status.textContent = 'Reset en cours…';
        try {
          const result = await postStagingAdminAction('/api/admin/reset', { mode: 'orders', confirm: true });
          status.className = 'kmc-admin-staging-status is-success';
          status.textContent = result.message || 'Reset terminé.';
        } catch (error) {
          status.className = 'kmc-admin-staging-status is-error';
          status.textContent = error.message || 'Échec du reset.';
        } finally {
          reset.disabled = false;
          seed.disabled = false;
        }
      });

      seed.addEventListener('click', async () => {
        const confirmFn = typeof global.confirm === 'function' ? global.confirm.bind(global) : null;
        if (!confirmFn || !confirmFn('Injecter les données de test sur STAGING ?')) return;
        reset.disabled = true;
        seed.disabled = true;
        status.className = 'kmc-admin-staging-status';
        status.textContent = 'Seed en cours…';
        try {
          const result = await postStagingAdminAction('/api/admin/seed-test', { confirm: true });
          status.className = 'kmc-admin-staging-status is-success';
          status.textContent = result.message || 'Seed terminé.';
        } catch (error) {
          status.className = 'kmc-admin-staging-status is-error';
          status.textContent = error.message || 'Échec du seed.';
        } finally {
          reset.disabled = false;
          seed.disabled = false;
        }
      });

      tools.appendChild(reset);
      tools.appendChild(seed);
      tools.appendChild(status);
      configurationGroup.appendChild(tools);
      return true;
    } catch (_) {
      return false;
    }
  }

  function roleLabel(user) {
    if (!user || !user.role) return 'Admin';
    if (user.role === 'market_operator') return 'Responsable pays';
    if (user.role === 'admin') return 'Admin';
    return String(user.role).replaceAll('_', ' ');
  }

  function createLogoutButton(doc) {
    const button = textNode(doc, 'button', 'kmc-admin-logout', 'Déconnexion');
    button.type = 'button';
    button.setAttribute('aria-label', 'Se déconnecter');
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        if (typeof global.fetch === 'function') {
          await global.fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'include',
            headers: { Accept: 'application/json' },
          });
        }
      } catch (error) {
        console.error('[canonical-admin] logout request failed', error);
      } finally {
        global.KOMERCE_CANONICAL_AUTH_USER = null;
        global.KOMERCE_AUTH_USER = null;
        if (global.location) {
          if (typeof global.location.replace === 'function') global.location.replace('/login.html');
          else global.location.href = '/login.html';
        }
      }
    });
    return button;
  }

  function currentRequestedMarket(adminContext, requireMarket = false) {
    const access = adminContext && adminContext.access;
    if (!access || !Array.isArray(access.allowedMarkets)) return null;

    try {
      const params = new URLSearchParams((global.location && global.location.search) || '');
      const requested = String(params.get('market') || '').toUpperCase();
      if (requested && access.allowedMarkets.includes(requested)) return requested;
    } catch (_) {
      // Le contexte serveur reste l'autorité si URLSearchParams est absent.
    }

    if (access.mode === 'global' && !requireMarket) return null;
    if (access.defaultMarket && access.allowedMarkets.includes(access.defaultMarket)) return access.defaultMarket;
    return access.allowedMarkets[0] || null;
  }

  function marketChoices(adminContext, requireMarket = false) {
    const app = global.KomerceCanonicalAdmin;
    if (app && typeof app.marketChoices === 'function') {
      try { return app.marketChoices(adminContext, { requireMarket }); } catch (_) { /* fallback ci-dessous */ }
    }

    const access = adminContext && adminContext.access;
    if (!access || !Array.isArray(access.allowedMarkets)) return [];
    const choices = [];
    if (access.mode === 'global' && !requireMarket) choices.push({ value: '', label: 'Tous les marchés' });
    access.allowedMarkets.forEach(code => choices.push({ value: code, label: code }));
    return choices;
  }

  const MARKET_FLAG_ASSETS = Object.freeze({
    CM: '/dashboards/canonical/assets/flags/CM.svg',
    CG: '/dashboards/canonical/assets/flags/CG.svg',
    KM: '/dashboards/canonical/assets/flags/KM.svg',
  });

  function marketFlagAsset(code) {
    return MARKET_FLAG_ASSETS[String(code || '').trim().toUpperCase()] || '';
  }

  function stripRegionalFlagPrefix(label) {
    return String(label || '').replace(/^[\u{1F1E6}-\u{1F1FF}]{2}\s*/u, '');
  }

  function proxyMarketChange(doc, value) {
    if (doc && typeof doc.querySelector === 'function') {
      const canonicalSelect = doc.querySelector('.kmc-market-context-select');
      if (canonicalSelect && canonicalSelect !== doc.activeElement) {
        canonicalSelect.value = value;
        if (typeof canonicalSelect.dispatchEvent === 'function' && typeof global.Event === 'function') {
          canonicalSelect.dispatchEvent(new global.Event('change', { bubbles: true }));
          return;
        }
      }
    }

    if (global.location) {
      const url = new URL(global.location.href);
      if (value) url.searchParams.set('market', value);
      else url.searchParams.delete('market');
      global.location.href = url.toString();
    }
  }

  function createMarketControl(doc, adminContext, requireMarket = false) {
    const choices = marketChoices(adminContext, requireMarket);
    if (!choices.length) return null;

    const wrap = doc.createElement('label');
    wrap.className = 'kmc-admin-market-control';
    wrap.setAttribute('aria-label', 'Marché actif');

    const flag = doc.createElement('img');
    flag.className = 'kmc-admin-market-flag';
    flag.alt = '';
    flag.setAttribute('aria-hidden', 'true');

    const select = doc.createElement('select');
    select.className = 'kmc-admin-market-select';
    select.setAttribute('aria-label', 'Sélectionner le marché');
    const current = currentRequestedMarket(adminContext, requireMarket);

    const syncFlag = marketCode => {
      const asset = marketFlagAsset(marketCode);
      flag.src = asset;
      flag.hidden = !asset;
      flag.setAttribute('data-market-flag', asset ? String(marketCode || '').toUpperCase() : '');
      select.className = `kmc-admin-market-select${asset ? ' has-flag' : ''}`;
    };

    choices.forEach(choice => {
      const option = doc.createElement('option');
      option.value = choice.value;
      option.textContent = stripRegionalFlagPrefix(choice.label);
      if ((choice.marketCode || choice.value || null) === current) option.selected = true;
      select.appendChild(option);
    });
    select.value = current || '';
    syncFlag(current);
    if (typeof select.addEventListener === 'function') {
      select.addEventListener('change', () => {
        syncFlag(select.value || '');
        proxyMarketChange(doc, select.value || '');
      });
    }

    wrap.appendChild(flag);
    wrap.appendChild(select);
    return wrap;
  }

  function mount(options = {}) {
    const doc = options.document || global.document;
    const pathname = options.pathname || (global.location && global.location.pathname) || '/admin/pilotage';
    const user = options.user || global.KOMERCE_CANONICAL_AUTH_USER || global.KOMERCE_AUTH_USER || null;
    const adminContext = options.adminContext || global.KOMERCE_CANONICAL_ADMIN_CONTEXT || null;
    if (!doc || !doc.body || typeof doc.createElement !== 'function') {
      throw new Error('canonical_navigation_document_missing');
    }

    const existing = doc.getElementById && doc.getElementById('canonical-admin-navigation');
    if (existing) return existing;

    const surface = options.surface || surfaceForPath(pathname);
    const role = (user && user.role) || '';
    const activeDomainId = activePrimarySurface(surface);
    const activeSpaceId = activeSpaceFor(surface);

    const header = doc.createElement('header');
    header.id = 'canonical-admin-navigation';
    header.className = 'kmc-admin-navigation';
    header.setAttribute('data-canonical-navigation', 'true');
    header.setAttribute('data-mock-contract', 'approved');

    const inner = doc.createElement('div');
    inner.className = 'kmc-admin-navigation-inner';

    const identity = doc.createElement('div');
    identity.className = 'kmc-admin-navigation-identity';

    const home = doc.createElement('a');
    home.className = 'kmc-admin-home';
    home.href = '/admin/pilotage';
    home.appendChild(textNode(doc, 'span', 'kmc-admin-home-label', 'KOMERCE'));
    identity.appendChild(home);

    const backTarget = resolveBackTarget(
      surface,
      options.search != null ? options.search : (global.location && global.location.search) || ''
    );
    if (backTarget) {
      const back = doc.createElement('a');
      back.className = 'kmc-admin-back';
      back.href = backTarget.href;
      back.setAttribute('aria-label', backTarget.label);
      back.setAttribute('data-back-context', backTarget.contextual ? 'contextual' : 'canonical');
      back.textContent = `← ${backTarget.label}`;
      identity.appendChild(back);
    }

    const primary = doc.createElement('nav');
    primary.className = 'kmc-admin-primary-nav';
    primary.setAttribute('aria-label', 'Navigation Komerce');
    const visibleDomains = visibleDomainsFor(user);
    if (role === 'admin') {
      primary.className += ' is-capability-map';
      let configurationGroup = null;
      ADMIN_CAPABILITY_GROUPS.forEach(group => {
        const groupNode = createAdminCapabilityGroup(doc, group, pathname);
        primary.appendChild(groupNode);
        if (group.label === 'Configuration') configurationGroup = groupNode;
      });
      // Intentionnellement asynchrone : le shell se rend immédiatement.
      // Les outils staging apparaissent ensuite uniquement après preuve serveur.
      void mountStagingAdminTools(doc, configurationGroup);
    } else {
      visibleDomains.forEach(domain => primary.appendChild(createDomainLink(doc, domain, activeDomainId, user)));
    }

    const utilities = doc.createElement('div');
    utilities.className = 'kmc-admin-utility-nav';

    const requireMarket = ['pricing-workspace', 'market-catalog', 'operations-workspace', 'shipping-customs-workspace', 'accounting-workspace'].includes(surface);
    const marketControl = createMarketControl(doc, adminContext, requireMarket);
    if (marketControl) utilities.appendChild(marketControl);

    const account = textNode(doc, 'span', 'kmc-admin-account', roleLabel(user));
    account.setAttribute('aria-label', `Profil : ${roleLabel(user)}`);
    utilities.appendChild(account);

    if (SETTINGS_UTILITY.roles.includes(role)) {
      const settingsLink = doc.createElement('a');
      settingsLink.className = 'kmc-admin-settings-link';
      settingsLink.href = SETTINGS_UTILITY.href;
      settingsLink.textContent = SETTINGS_UTILITY.label;
      settingsLink.setAttribute('data-dashboard', SETTINGS_UTILITY.id);
      if (surface === 'settings') {
        settingsLink.className += ' is-active';
        settingsLink.setAttribute('aria-current', 'page');
      }
      utilities.appendChild(settingsLink);
    }

    utilities.appendChild(createLogoutButton(doc));

    inner.appendChild(identity);
    inner.appendChild(primary);
    inner.appendChild(utilities);
    header.appendChild(inner);

    const activeDomain = visibleDomains.find(domain => domain.id === activeDomainId);
    if (activeDomain && Array.isArray(activeDomain.spaces)) {
      const spaces = visibleSpacesFor(activeDomain, role);
      if (spaces.length > 1) {
        const secondary = doc.createElement('nav');
        secondary.className = 'kmc-admin-secondary-nav';
        secondary.setAttribute('aria-label', `Sous-navigation ${activeDomain.label}`);
        spaces.forEach(space => secondary.appendChild(createSpaceLink(doc, space, activeSpaceId)));
        header.appendChild(secondary);
      }
    }

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
    DOMAINS,
    SETTINGS_UTILITY,
    ADMIN_CAPABILITY_GROUPS,
    runtimeIsStaging,
    mountStagingAdminTools,
    SURFACE_TO_DOMAIN,
    SURFACE_TO_SPACE,
    BACK_TARGETS,
    safeReturnTarget,
    withReturnTo,
    resolveBackTarget,
    visibleDomainsFor,
    visibleSpacesFor,
    landingForDomain,
    visibleNavigationFor,
    activePrimarySurface,
    activeSpaceFor,
    surfaceForPath,
    marketChoices,
    currentRequestedMarket,
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
