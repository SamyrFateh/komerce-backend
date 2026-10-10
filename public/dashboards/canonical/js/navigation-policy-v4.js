/**
 * @komerce-arch
 * @role          canonical-admin-navigation
 * @domain        admin-dashboard
 * @layer         ui-navigation
 * @criticality   high
 * @inputs        authenticated_user, canonical_surface, url_path, server_admin_context
 * @outputs       hybrid_sidebar_n1_horizontal_n2_shell, logical_back_navigation, market_selector_proxy
 * @depends       canonical admin app surface contract
 * @used-by       canonical admin runtime, standalone market canonical pages
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      single_navigation_structure, single_shell_sidebar_n1_horizontal_n2_local_n3, visible_destination_must_have_server_guard, country_manager_owns_market_scope, client_market_id_never_authority, market_id_is_transverse_context
 * @impact-areas  admin-dashboard, navigation, market-authorization
 * @version       2026-10-v5.0-single-navigation
 */
'use strict';

// Fichier unique de navigation Canonical. Il remplace l'empilement
// navigation.js (V2.1) -> navigation-policy-v3.js -> navigation-policy-v4.js :
// une seule structure (DOMAINS / SIDEBAR_GROUPS / LOCAL_TABS), un seul mount.
(function initCanonicalNavigation(global) {

  const DOMAINS = Object.freeze([
    Object.freeze({
      id: 'dashboard',
      label: 'Dashboard',
      href: '/admin/pilotage',
      roles: Object.freeze(['admin', 'market_operator']),
    }),
    Object.freeze({
      id: 'pricing',
      label: 'Prix & économie',
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
    sourcing: '/admin/import-runtime',
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
    // Utilitaires d'administration : pas de domaine N1 propre (aucun domaine « settings »
    // dans DOMAINS). Les rattacher à un domaine inexistant les faisait refuser par le garde
    // de landing (redirection vers le Pilotage) ; « dashboard » est toujours autorisé.
    settings: 'dashboard',
    'providers-admin': 'dashboard',
    'users-admin': 'dashboard',
  });

  const HERO_FIRST_SURFACES = new Set([
    'pilotage', 'commerce', 'operations', 'finance', 'action-center',
    'pricing-workspace', 'catalog-workspace', 'sourcing-workspace', 'purchasing-workspace',
    'operations-workspace', 'shipping-customs-workspace', 'accounting-workspace', 'client-index',
    'users-admin', 'providers-admin',
  ]);

  const SURFACE_TO_SPACE = Object.freeze({
    commerce: 'commerce',
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

  const SETTINGS_UTILITY = Object.freeze({ id: 'settings', label: 'Paramètres', href: '/admin/settings', roles: Object.freeze(['admin']) });

  const BACK_TARGETS = Object.freeze({
    'action-center': Object.freeze({ href:'/admin/pilotage', label:'Retour au pilotage' }),
    'order-360': Object.freeze({ href:'/admin/operations', label:'Retour aux opérations' }),
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

  function buildHeader(options = {}) {
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
    visibleDomains.forEach(domain => primary.appendChild(createDomainLink(doc, domain, activeDomainId, user)));

    const utilities = doc.createElement('div');
    utilities.className = 'kmc-admin-utility-nav';

    const requireMarket = ['pricing-workspace', 'market-catalog', 'operations-workspace', 'shipping-customs-workspace', 'accounting-workspace'].includes(surface);
    const marketControl = createMarketControl(doc, adminContext, requireMarket);
    if (marketControl) utilities.appendChild(marketControl);

    const account = textNode(doc, 'span', 'kmc-admin-account', roleLabel(user));
    account.setAttribute('aria-label', `Profil : ${roleLabel(user)}`);
    utilities.appendChild(account);

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

  function replaceNavigationStructure(header, options = {}) {
    if (!header) return header;
    const doc = options.document || global.document;
    const user = options.user || global.KOMERCE_CANONICAL_AUTH_USER || global.KOMERCE_AUTH_USER || null;
    const surface = options.surface || surfaceForPath(options.pathname || global.location?.pathname);
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

    return header;
  }

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
    'admin-providers': '⛭',
    'admin-users': '⛭',
    'control-tower': '⌂',
    'action-center': '!',
    'flow-commerce': '▥',
    'flow-operations': '⇄',
    'flow-finance': '▤',
    'entity-orders': '◇',
    'entity-clients': '♙',
    'live-import-runtime': '◉',
    'live-hub': '◉',
    'live-relais': '◉',
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
        Object.freeze({ id: 'control-tower', label: 'Tour de contrôle', href: '/admin/pilotage', roles: ['admin', 'market_operator'], capability: 'dashboard.market.read', surfaces: ['pilotage'] }),
        Object.freeze({ id: 'action-center', label: 'À traiter', href: '/admin/action-center', roles: ['admin', 'market_operator', 'agent_hub', 'agent_relais', 'agent_transitaire'], capability: 'decision_signal.manage', surfaces: ['action-center'] }),
      ]),
    }),
    Object.freeze({
      id: 'commerce',
      label: 'Commerce',
      items: Object.freeze([
        Object.freeze({ id: 'flow-commerce', label: 'Vue commerce', href: '/admin/commerce', roles: ['admin', 'market_operator'], capability: 'dashboard.market.read', surfaces: ['commerce'] }),
        Object.freeze({ id: 'entity-clients', label: 'Clients', href: '/admin/clients', roles: ['admin', 'market_operator'], capability: 'client.read', surfaces: ['client-index', 'client-360'] }),
        Object.freeze({ id: 'workspace-pricing', label: 'Prix & économie', href: '/admin/workspaces/pricing', roles: ['admin', 'market_operator'], capability: 'pricing.read', surfaces: ['pricing-workspace'] }),
        Object.freeze({ id: 'workspace-catalog', label: 'Catalogue', href: '/admin/workspaces/catalog', roles: ['admin'], surfaces: ['catalog-workspace', 'product-360'] }),
      ]),
    }),
    Object.freeze({
      id: 'operations',
      label: 'Opérations',
      items: Object.freeze([
        Object.freeze({ id: 'flow-operations', label: 'Vue opérations', href: '/admin/operations', roles: ['admin', 'market_operator'], capability: 'operations.read', surfaces: ['operations', 'order-360'] }),
        Object.freeze({ id: 'workspace-operations', label: 'Hub & Relais', href: '/admin/workspaces/operations', roles: ['admin', 'agent_hub', 'agent_relais', 'market_operator'], capability: 'operations.read', surfaces: ['operations-workspace'] }),
        Object.freeze({ id: 'workspace-shipping', label: 'Expéditions & Douane', href: '/admin/workspaces/shipping-customs', roles: ['admin', 'agent_hub', 'agent_transitaire', 'market_operator'], capability: 'operations.read', surfaces: ['shipping-customs-workspace'] }),
        Object.freeze({ id: 'workspace-sourcing', label: 'Sourcing', href: '/admin/workspaces/sourcing', roles: ['admin', 'sourcing'], surfaces: ['sourcing-workspace', 'supplier-360'] }),
        Object.freeze({ id: 'workspace-purchasing', label: 'Achats fournisseurs', href: '/admin/workspaces/purchasing', roles: ['admin'], surfaces: ['purchasing-workspace'] }),
      ]),
    }),
    Object.freeze({
      id: 'finance',
      label: 'Finance',
      items: Object.freeze([
        Object.freeze({ id: 'flow-finance', label: 'Vue finance', href: '/admin/finance', roles: ['admin', 'market_operator'], capability: 'finance.read', surfaces: ['finance'] }),
        Object.freeze({ id: 'workspace-accounting', label: 'Comptabilité', href: '/admin/workspaces/accounting', roles: ['admin', 'finance', 'agent_relais', 'market_operator'], capability: 'finance.read', surfaces: ['accounting-workspace'] }),
      ]),
    }),
    Object.freeze({
      id: 'live',
      label: 'Live',
      items: Object.freeze([
        Object.freeze({ id: 'live-import-runtime', label: 'Sourcing live', href: '/admin/import-runtime', roles: ['admin', 'sourcing'], surfaces: ['import-runtime'] }),
        Object.freeze({ id: 'live-hub', label: 'Hub live', href: '/admin/hub-live', roles: ['admin', 'agent_hub'], surfaces: ['hub-live'] }),
        Object.freeze({ id: 'live-relais', label: 'Relais live', href: '/admin/relais-live', roles: ['admin', 'agent_relais'], surfaces: ['relais-live'] }),
      ]),
    }),
    Object.freeze({
      id: 'markets',
      label: 'Marchés',
      items: Object.freeze([
        Object.freeze({ id: 'markets-home', label: 'Responsables pays', href: '/dashboards/canonical/access.html', roles: ['admin'], surfaces: ['market-access'] }),
        Object.freeze({ id: 'market-autonomy', label: 'Autonomie marché', href: '/dashboards/canonical/market-autonomy.html', roles: ['market_operator'], surfaces: ['market-autonomy'] }),
        Object.freeze({ id: 'market-catalog', label: 'Catalogue pays', href: '/dashboards/canonical/market-catalog.html', roles: ['market_operator'], surfaces: ['market-catalog'] }),
      ]),
    }),
    Object.freeze({
      id: 'administration',
      label: 'Administration',
      items: Object.freeze([
        Object.freeze({ id: 'admin-users', label: 'Utilisateurs', href: '/admin/users', roles: ['admin'], surfaces: ['users-admin'] }),
        Object.freeze({ id: 'admin-providers', label: 'Providers', href: '/admin/providers', roles: ['admin'], surfaces: ['providers-admin'] }),
        Object.freeze({ id: 'settings', label: 'Paramètres', href: '/admin/settings', roles: ['admin'], surfaces: ['settings'] }),
      ]),
    }),
  ]);

  const LOCAL_TABS = Object.freeze({
    pricing: Object.freeze([
      Object.freeze({ id: 'pricing-overview', label: 'Vue d’ensemble', href: '/admin/workspaces/pricing', roles: ['admin', 'market_operator'] }),
    ]),
    catalog: Object.freeze([
      Object.freeze({ id: 'catalog-overview', label: 'Vue catalogue', href: '/admin/workspaces/catalog', roles: ['admin'] }),
      Object.freeze({ id: 'catalog-products', label: 'Produits', href: '/admin/workspaces/catalog?view=advanced', roles: ['admin'] }),
    ]),
    orders: Object.freeze([
      Object.freeze({ id: 'commerce', label: 'Vue d’ensemble', href: '/admin/commerce', roles: ['admin', 'market_operator'] }),
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

  const PRICING_SECTION_IDS = Object.freeze({});

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
    primary.scrollTop = 0;

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

    // Le navigateur peut restaurer une ancienne position de scroll de la sidebar.
    // Le montage d'une nouvelle surface Canonical repart toujours du début du menu.
    primary.scrollTop = 0;
    if (typeof global.requestAnimationFrame === 'function') {
      global.requestAnimationFrame(() => { primary.scrollTop = 0; });
    }
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
    return surfaceForPath(options.pathname || global.location?.pathname || '');
  }

  function currentDomain(surface) {
    return activePrimarySurface(surface);
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

    const domain = visibleDomainsFor(user).find(row => row.id === domainId);
    if (!domain || !Array.isArray(domain.spaces)) return [];
    return visibleSpacesFor(domain, role).map(space => ({
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
      return 'commerce';
    }
    if (domainId === 'markets') {
      if (surface === 'market-catalog') return 'catalog-country';
      return surface === 'market-autonomy' ? 'market-autonomy' : 'market-access';
    }
    return activeSpaceFor(surface) || path;
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
    if (doc.body && doc.body.dataset) doc.body.dataset.kmcSurface = surface;
    // Surfaces dont le Hero est la première ligne (contrôles dans le Hero, pas de rangée d'onglets).
    doc.body?.classList?.toggle?.('kmc-hero-first', HERO_FIRST_SURFACES.has(surface));
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
    const header = buildHeader(options);
    replaceNavigationStructure(header, options);
    return applyHybridShell(header, options);
  }

  const api = Object.freeze({
    DOMAINS,
    ROLE_HOME,
    SETTINGS_UTILITY,
    SURFACE_TO_DOMAIN,
    SURFACE_TO_SPACE,
    BACK_TARGETS,
    safeReturnTarget,
    withReturnTo,
    resolveBackTarget,
    runtimeIsStaging,
    mountStagingAdminTools,
    visibleDomainsFor,
    visibleSpacesFor,
    visibleNavigationFor,
    landingForDomain,
    defaultLandingFor,
    activePrimarySurface,
    activeSpaceFor,
    surfaceForPath,
    marketChoices,
    currentRequestedMarket,
    LOCAL_TABS,
    SIDEBAR_GROUPS,
    sidebarGroupsFor,
    safeCanonicalHref,
    renderReferenceResults,
    REFERENCE_SEARCH_ENDPOINT,
    mount,
    _buildHeader: buildHeader,
    _replaceNavigationStructure: replaceNavigationStructure,
    _applyHybridShell: applyHybridShell,
    _activeLocalTab: activeLocalTab,
    _localTabsFor: localTabsFor,
    _dedupeShell: dedupeShell,
    _dedupeRole: dedupeRole,
  });

  global.KomerceCanonicalNavigation = api;

  function autoMount() {
    try {
      mount();
    } catch (error) {
      console.error('[canonical-admin] navigation mount failed', error);
    }
  }

  if (global.document?.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', autoMount, { once: true });
  } else if (global.document) {
    autoMount();
  }
})(typeof window !== 'undefined' ? window : globalThis);
