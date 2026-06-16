/**
 * @komerce-arch
 * @role          bootstrap-app
 * @domain        bootstrap
 * @layer         bootstrap
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @db-write      @unknown
 * @db-read      @unknown
 * @used-by       @unknown
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  bootstrap
 * @version       2026-06
 */

/**
 * KOMERCE Dashboard — App
 * Routing SPA (pushState) + shell + dispatch.
 */
(function (global) {
  'use strict';

  const ROUTES = [
    { path: '/admin/pilotage',         view: 'PilotageView',         label: 'Pilotage',               icon: '🎯', section: 'PILOTAGE' },
    { path: '/admin/sante',            view: 'SanteView',            label: 'Santé Business',         icon: '🏥', section: 'PILOTAGE' },
    { path: '/admin/control-tower',    view: 'ControlTowerView',     label: 'Tour de contrôle',       icon: '🗼', section: 'PILOTAGE' },
    { path: '/admin/costing',          view: 'CostingView',          label: 'Coût rendu relais',      icon: '💰', section: 'PILOTAGE' },
    { path: '/admin/orders-logistics', view: 'OrdersLogisticsView',  label: 'Commandes & logistique', icon: '📦', section: 'PILOTAGE' },
    { path: '/admin/event-workspaces', view: 'EventWorkspacesView',  label: 'Panier événement',       icon: '🎉', section: 'PILOTAGE' },
    { path: '/admin/sales',            view: 'SalesView',            label: 'Ventes',                 icon: '📈', section: 'PILOTAGE' },
    { path: '/admin/economic',         view: 'EconomicView',         label: 'Santé économique',       icon: '📊', section: 'PILOTAGE' },
    { path: '/admin/pilotage-fin',     view: 'PilotageFinView',      label: 'Projection & Mix',       icon: '💹', section: 'PILOTAGE' },
    { path: '/admin/invoices',         view: 'InvoicesView',         label: 'Factures',               icon: '📄', section: 'PILOTAGE' },

    { path: '/admin/problems',         view: 'ProblemsView',         label: 'Problèmes',              icon: '⚠️', section: 'OPERATIONS' },
    { path: '/admin/alerts',           view: 'ActionCenterView',     label: 'Alertes & Incidents',    icon: '🚨', section: 'OPERATIONS' },
    { path: '/admin/clients',          view: 'ClientsView',          label: 'Clients',                icon: '👥', section: 'OPERATIONS' },
    { path: '/admin/hub-relais',       view: 'HubRelaisView',        label: 'Hub & Relais',           icon: '🏭', section: 'OPERATIONS' },
    { path: '/admin/transitaire',      view: 'TransitaireView',      label: 'Transitaire',            icon: '✈️', section: 'OPERATIONS' },
    { path: '/admin/inventory',        view: 'InventoryView',        label: 'Inventaire Hub',         icon: '📋', section: 'OPERATIONS' },

    { path: '/admin/categories',       view: 'CategoriesView',       label: 'Catégories boutique',    icon: '🏷️', section: 'CATALOGUE' },
    { path: '/admin/products',         view: 'ProductsView',         label: 'Produits boutique',      icon: '🛍️', section: 'CATALOGUE' },

    // Lot 4
    { path: '/admin/sourcing',          view: 'SourcingView',          label: 'Sourcing',              icon: '🔎', section: 'SOURCING' },
    { path: '/admin/sourcing-scanner',  view: 'SourcingScannerView',   label: 'Scanner catalogue',     icon: '📡', section: 'SOURCING' },
    { path: '/admin/pricing',           view: 'PricingView',           label: 'Construction du Prix',  icon: '🧮', section: 'PRICING' },
    { path: '/admin/pricing-workshop',  view: 'PricingWorkshopView',   label: 'Config des coûts',      icon: '⚙️', section: 'PRICING' },
    { path: '/admin/pricing-strategy',  view: 'PricingStrategyView',   label: 'Stratégie de prix',     icon: '📈', section: 'PRICING' },
    { path: '/admin/customs',           view: 'CustomsView',           label: 'Douane & shipments',    icon: '🛃', section: 'LOGISTIQUE' },
    { path: '/admin/suppliers',         view: 'SuppliersView',         label: 'Fournisseurs',          icon: '🏭', section: 'LOGISTIQUE' },

    // Lot 6
    { path: '/admin/settings',          view: 'SettingsView',          label: 'Paramètres',            icon: '⚙️', section: 'ADMIN' },
    { path: '/admin/simulator',         view: 'SimulatorView',         label: 'Simulateur',            icon: '🤖', section: 'ADMIN' },
    { path: '/admin/shared-carts',      view: 'SharedCartsView',       label: 'Paniers partagés',      icon: '🤝', section: 'ADMIN' },
    { path: '/admin/accounting',        view: 'AccountingView',         label: 'Comptabilité',           icon: '📊', section: 'ADMIN' },
  ];

  let currentUser = null;

  function loginUrl() {
    const next = window.location.pathname + window.location.search + window.location.hash;
    return '/login.html?next=' + encodeURIComponent(next);
  }

  function redirectToLogin() {
    window.location.replace(loginUrl());
  }

  async function requireAdminSession() {
    const res = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      redirectToLogin();
      throw new Error('unauthorized');
    }
    const user = await res.json();
    if (user.role !== 'admin') {
      window.location.replace('/');
      throw new Error('forbidden');
    }
    currentUser = user;
    global.KOMERCE_AUTH_USER = user;
    return user;
  }

  function hydrateHeaderUser() {
    if (!currentUser) return;
    const name = currentUser.full_name || currentUser.email || 'Admin';
    const avatar = document.getElementById('user-avatar');
    const nameEl = document.getElementById('user-name');
    const roleEl = document.querySelector('.header-user-role');
    if (avatar) avatar.textContent = String(name).trim().charAt(0).toUpperCase() || 'A';
    if (nameEl) nameEl.textContent = name;
    if (roleEl) roleEl.textContent = currentUser.role || 'admin';
  }

  function renderShell() {
    document.body.innerHTML = `
      <div class="app-shell">
        <aside class="sidebar">
          <div class="sidebar-brand">
            <div class="sidebar-brand-logo">K</div>
            <div>
              <div class="sidebar-brand-text">Komerce</div>
              <div class="sidebar-brand-sub">Dubai → Comores</div>
            </div>
          </div>
          <nav class="sidebar-nav" id="sidebar-nav"></nav>
          <div class="sidebar-footer">
            <div class="sidebar-rate">
              <div>Taux AED → KMF</div>
              <div class="sidebar-rate-value" id="sidebar-fx-rate">—</div>
              <div class="sidebar-rate-delta" id="sidebar-fx-delta">Chargement…</div>
            </div>
          </div>
        </aside>
        <header class="header">
          <div class="header-search">
            <span class="header-search-icon">🔍</span>
            <input type="text" placeholder="Rechercher une commande, un client, un relais…" />
          </div>
          <div class="header-period" id="header-period">📅 7 derniers jours</div>
          <div class="header-actions">
            <div class="header-user">
              <div class="header-user-avatar" id="user-avatar">A</div>
              <div>
                <div class="header-user-name" id="user-name">Admin</div>
                <div class="header-user-role">Super Admin</div>
              </div>
            </div>
          </div>
        </header>
        <main class="main" id="main-content">
          <div class="loading-state"><span class="loader"></span> Chargement...</div>
        </main>
      </div>
    `;
    renderSidebar();
    renderHeaderPeriod();
  }

  function renderSidebar() {
    const nav = document.getElementById('sidebar-nav');
    const currentPath = window.location.pathname;
    const sections = {};
    ROUTES.forEach(route => {
      if (!sections[route.section]) sections[route.section] = [];
      sections[route.section].push(route);
    });

    Object.entries(sections).forEach(([sectionLabel, routes]) => {
      const section = document.createElement('div');
      section.className = 'sidebar-section';
      section.innerHTML = `<div class="sidebar-section-label">${sectionLabel}</div>`;
      routes.forEach(route => {
        const link = document.createElement('a');
        link.href = route.path;
        link.dataset.path = route.path;
        link.className = 'sidebar-link' + (currentPath === route.path ? ' is-active' : '');
        link.innerHTML = `<span class="sidebar-link-icon">${route.icon}</span><span>${route.label}</span>`;
        link.addEventListener('click', event => {
          event.preventDefault();
          navigateTo(route.path);
        });
        section.appendChild(link);
      });
      nav.appendChild(section);
    });
  }

  function navigateTo(path) {
    if (!ROUTES.some(route => route.path === path)) return false;
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    refreshActiveLink();
    dispatchView();
    return true;
  }

  // Compatibilité avec les vues Lot 4 qui appellent KmcApp.navigate('pricing')
  // ou KmcApp.navigate('PricingView').
  function navigate(viewOrPath) {
    const value = String(viewOrPath || '');
    const route = ROUTES.find(item =>
      item.view === value ||
      item.path === value ||
      item.path === '/admin/' + value.replace(/^\/+/, '')
    );
    return route ? navigateTo(route.path) : false;
  }

  function refreshActiveLink() {
    const currentPath = window.location.pathname;
    document.querySelectorAll('.sidebar-link').forEach(link => {
      link.classList.toggle('is-active', link.dataset.path === currentPath);
    });
  }

  function renderHeaderPeriod() {
    const filters = KmcFilters.get();
    const el = document.getElementById('header-period');
    if (filters.from && filters.to) {
      const from = new Date(filters.from).toLocaleDateString('fr-FR');
      const to = new Date(filters.to).toLocaleDateString('fr-FR');
      el.textContent = `📅 ${from} – ${to}`;
    }
  }

  async function invokeView(View, main) {
    // Anciennes vues : { render(rootEl) }
    if (View && typeof View.render === 'function') {
      return View.render(main);
    }
    // Certaines vues Lot 4 : async function(rootEl)
    if (typeof View === 'function') {
      return View(main);
    }
    throw new Error('format de vue incompatible');
  }

  function dispatchView() {
    const path = window.location.pathname;
    const route = ROUTES.find(item => item.path === path);
    const main = document.getElementById('main-content');

    if (!route || !route.view) {
      const label = route ? route.label : path;
      main.innerHTML = `
        <div class="empty-state">
          <div style="font-size:48px;margin-bottom:16px;">🚧</div>
          <h2>${label}</h2>
          <p style="margin-top:12px;color:var(--text-secondary);">Vue indisponible</p>
        </div>`;
      return;
    }

    const View = global[route.view];
    if (!View) {
      main.innerHTML = `<div class="error-state">Vue ${route.view} non chargée</div>`;
      return;
    }

    main.innerHTML = '<div class="loading-state"><span class="loader"></span> Chargement...</div>';
    Promise.resolve(invokeView(View, main)).catch(err => {
      console.error('[app] render error:', err);
      main.innerHTML = `<div class="error-state">Erreur: ${err.message}</div>`;
    });
  }

  async function loadFxRate() {
    try {
      const config = await KmcApi.getFinanceConfig();
      const rate = config && (config.aed_to_kmf_rate || config.fx_rate_aed_kmf);
      const rateEl = document.getElementById('sidebar-fx-rate');
      const deltaEl = document.getElementById('sidebar-fx-delta');
      if (rateEl) rateEl.textContent = rate ? `1 AED = ${Number(rate).toFixed(2)} KMF` : '—';
      if (deltaEl) deltaEl.textContent = '';
    } catch (_) {
      const deltaEl = document.getElementById('sidebar-fx-delta');
      if (deltaEl) deltaEl.textContent = 'Indisponible';
    }
  }

  async function init() {
    try {
      await requireAdminSession();
    } catch (_) {
      return;
    }
    KmcFilters.init();
    renderShell();
    hydrateHeaderUser();
    loadFxRate();
    dispatchView();

    window.addEventListener('popstate', () => {
      refreshActiveLink();
      dispatchView();
    });

    KmcFilters.subscribe(() => {
      renderHeaderPeriod();
      dispatchView();
    });
  }

  global.KmcApp = { init, navigateTo, navigate };
})(window);

document.addEventListener('DOMContentLoaded', () => window.KmcApp.init());
