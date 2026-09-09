/**
 * @komerce-arch
 * @role          canonical-admin-navigation
 * @domain        admin-dashboard
 * @layer         ui-navigation
 * @criticality   medium
 * @inputs        canonical_surface, url_path, authenticated_user, server_admin_context
 * @outputs       mock_contract_navigation, logical_back_navigation, market_selector_proxy
 * @depends       canonical admin app surface contract
 * @used-by       canonical admin runtime
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      four_primary_dashboards_no_legacy_navigation, mock_is_ui_contract
 * @impact-areas  admin-dashboard, navigation
 * @version       2026-09
 */

'use strict';

(function initCanonicalNavigation(global) {
  'use strict';

  // Contrat UI approuvé : ces six onglets sont la navigation visible Komerce.
  // Les dashboards Canonical Pilotage / Commerce / Opérations / Finance restent
  // les surfaces techniques sous-jacentes ; la barre expose les intentions
  // métier, pas l'architecture interne.
  // Les 6 onglets du mock approuvé restent la référence visuelle contractuelle.
  // Les 4 suivants n'ont pas de mock dédié : ils exposent tels quels des
  // workspaces Canonical déjà existants et déjà testés (operations/
  // shipping-customs/sourcing/accounting), pour que les rôles opérationnels
  // aient enfin un onglet primaire pertinent au lieu d'être cantonnés à
  // Dashboard. Aucune logique métier nouvelle : le shell choisit juste où
  // les afficher — voir docs/admin-nav-capability-map.md §9.
  const PRIMARY_NAV = Object.freeze([
    Object.freeze({ id: 'dashboard', label: 'Dashboard', href: '/admin/pilotage' }),
    Object.freeze({ id: 'pricing', label: 'Atelier économique', href: '/admin/workspaces/pricing' }),
    Object.freeze({ id: 'catalog', label: 'Catalogue', href: '/admin/workspaces/catalog' }),
    Object.freeze({ id: 'orders', label: 'Commandes', href: '/admin/commerce' }),
    Object.freeze({ id: 'markets', label: 'Marchés', href: '/dashboards/canonical/market-autonomy.html' }),
    Object.freeze({ id: 'settings', label: 'Paramètres', href: '/admin/settings' }),
    Object.freeze({ id: 'operations-workspace', label: 'Opérations', href: '/admin/workspaces/operations' }),
    Object.freeze({ id: 'shipping-customs-workspace', label: 'Expéditions & Douane', href: '/admin/workspaces/shipping-customs' }),
    Object.freeze({ id: 'sourcing-workspace', label: 'Sourcing', href: '/admin/workspaces/sourcing' }),
    Object.freeze({ id: 'accounting-workspace', label: 'Comptabilité', href: '/admin/workspaces/accounting' }),
  ]);

  // Onglets visibles par rôle, vérifiés contre les guards serveur réels
  // (voir docs/admin-nav-capability-map.md). Seuls admin et market_operator
  // ont un accès serveur prouvé aux 6 onglets du mock ; les autres rôles
  // opérationnels travaillent aujourd'hui via des workspaces Canonical
  // secondaires ou le portail Legacy, hors de cette barre de navigation.
  // Ne pas élargir un rôle ici sans élargir d'abord le guard serveur
  // correspondant — l'UI ne doit jamais promettre un onglet qui 403.
  const ROLE_VISIBLE_TABS = Object.freeze({
    admin:              Object.freeze(['dashboard', 'pricing', 'catalog', 'orders', 'markets', 'settings', 'operations-workspace', 'shipping-customs-workspace', 'sourcing-workspace', 'accounting-workspace']),
    market_operator:    Object.freeze(['dashboard', 'pricing', 'orders', 'markets', 'operations-workspace']),
    finance:            Object.freeze(['dashboard', 'accounting-workspace']),
    sourcing:           Object.freeze(['dashboard', 'sourcing-workspace']),
    agent_hub:          Object.freeze(['dashboard', 'operations-workspace', 'shipping-customs-workspace']),
    agent_relais:       Object.freeze(['dashboard', 'operations-workspace', 'accounting-workspace']),
    agent_transitaire:  Object.freeze(['dashboard', 'shipping-customs-workspace']),
    support:            Object.freeze(['dashboard']),
  });

  // Retourne le sous-ensemble de PRIMARY_NAV que ce rôle peut réellement
  // utiliser. Un rôle absent de ROLE_VISIBLE_TABS ne voit que Dashboard —
  // défense en profondeur, jamais un onglet non couvert par un guard connu.
  function visibleNavigationFor(user, adminContext) {
    const role = (user && user.role) || '';
    const allowedIds = ROLE_VISIBLE_TABS[role] || ['dashboard'];
    return Object.freeze(PRIMARY_NAV.filter(item => allowedIds.includes(item.id)));
  }

  const SURFACE_PARENT = Object.freeze({
    pilotage: 'dashboard',
    operations: 'dashboard',
    finance: 'dashboard',
    'operations-workspace': 'operations-workspace',
    'shipping-customs-workspace': 'shipping-customs-workspace',
    'accounting-workspace': 'accounting-workspace',
    'action-center': 'dashboard',
    demo: 'dashboard',

    'pricing-workspace': 'pricing',

    'catalog-workspace': 'catalog',
    'sourcing-workspace': 'sourcing-workspace',
    'product-360': 'catalog',

    commerce: 'orders',
    'order-360': 'orders',
    'client-index': 'orders',
    'client-360': 'orders',

    'market-access': 'markets',
    'market-autonomy': 'markets',
    settings: 'settings',
  });

  // Les onglets du mock remplacent le bouton Retour sur les workspaces
  // principaux. Retour reste réservé aux vrais drill-downs / surfaces 360.
  // operations-workspace / shipping-customs-workspace / accounting-workspace
  // sont désormais des onglets primaires directs (voir PRIMARY_NAV) — plus
  // de Retour redondant pour elles.
  const BACK_TARGETS = Object.freeze({
    'action-center': '/admin/pilotage',
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
    const path = String(pathname || '');
    if (path === '/dashboards/canonical/access.html' || path === '/dashboards/canonical/market-autonomy.html') {
      return path.includes('access') ? 'market-access' : 'market-autonomy';
    }
    if (path === '/admin/settings') return 'settings';

    const app = global.KomerceCanonicalAdmin;
    if (!app || typeof app.surfaceForPath !== 'function') return 'pilotage';
    return app.surfaceForPath(pathname);
  }

  function activePrimarySurface(surface) {
    return SURFACE_PARENT[surface] || 'dashboard';
  }

  function hrefFor(item, user) {
    if (item.id === 'markets' && user && user.role === 'admin') {
      return '/dashboards/canonical/access.html';
    }
    return item.href;
  }

  function createLink(doc, item, activeId, user) {
    const link = doc.createElement('a');
    link.className = 'kmc-admin-primary-link';
    link.href = hrefFor(item, user);
    link.textContent = item.label;
    link.setAttribute('data-dashboard', item.id);
    if (item.id === activeId) {
      link.className += ' is-active';
      link.setAttribute('aria-current', 'page');
    }
    return link;
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

  function proxyMarketChange(doc, value) {
    // Le sélecteur de page possède déjà le contrat serveur et le callback de
    // rechargement. La barre du mock ne duplique aucune logique économique :
    // elle pilote ce contrôle canonique lorsqu'il existe.
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

    // Les pages autonomes n'ont pas le shell de marché : le code marché reste
    // une préférence de navigation, jamais une autorité. Les APIs revalident le scope.
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

    const select = doc.createElement('select');
    select.className = 'kmc-admin-market-select';
    select.setAttribute('aria-label', 'Sélectionner le marché');
    const current = currentRequestedMarket(adminContext, requireMarket);

    choices.forEach(choice => {
      const option = doc.createElement('option');
      option.value = choice.value;
      option.textContent = choice.label;
      if ((choice.marketCode || choice.value || null) === current) option.selected = true;
      select.appendChild(option);
    });
    select.value = current || '';
    if (typeof select.addEventListener === 'function') {
      select.addEventListener('change', () => proxyMarketChange(doc, select.value || ''));
    }

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
    const activeId = activePrimarySurface(surface);

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
    const visibleTabs = visibleNavigationFor(user, adminContext);
    visibleTabs.forEach(item => primary.appendChild(createLink(doc, item, activeId, user)));

    const utilities = doc.createElement('div');
    utilities.className = 'kmc-admin-utility-nav';

    const requireMarket = ['pricing-workspace', 'operations-workspace', 'shipping-customs-workspace', 'accounting-workspace'].includes(surface);
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
    ROLE_VISIBLE_TABS,
    visibleNavigationFor,
    activePrimarySurface,
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
