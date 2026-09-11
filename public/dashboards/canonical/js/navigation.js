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
    // Commandes partage aujourd'hui la source canonique Commerce, mais possède
    // sa représentation métier dédiée. Le query `view=orders` ne change ni
    // endpoint ni scope : il sélectionne uniquement la projection UI.
    Object.freeze({ id: 'orders', label: 'Commandes', href: '/admin/commerce?view=orders', roles: Object.freeze(['admin', 'market_operator']) }),
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
        Object.freeze({ id: 'sourcing-workspace', label: 'Sourcing', href: '/admin/workspaces/sourcing', roles: Object.freeze(['admin', 'sourcing']) }),
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

    commerce: 'orders',
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

  // Parentage des surfaces techniques vers leur espace N2 (uniquement pour
  // les domaines groupés Opérations / Finance).
  const SURFACE_TO_SPACE = Object.freeze({
    operations: 'operations-overview',
    'operations-workspace': 'operations-workspace',
    'shipping-customs-workspace': 'shipping-customs-workspace',
    'sourcing-workspace': 'sourcing-workspace',

    finance: 'finance-overview',
    'accounting-workspace': 'accounting-workspace',
  });

  const BACK_TARGETS = Object.freeze({
    'action-center': '/admin/pilotage',
    'order-360': '/admin/commerce?view=orders',
    'client-index': '/admin/commerce?view=orders',
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

  function createSpaceLink(doc, space, activeSpaceId) {
    return createLink(doc, space, space.href, space.id === activeSpaceId, 'kmc-admin-secondary-link');
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
    SURFACE_TO_DOMAIN,
    SURFACE_TO_SPACE,
    BACK_TARGETS,
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
