/**
 * KOMERCE Dashboard — App
 * ════════════════════════════════════════════════════════════════════════
 * Routing SPA (pushState) + render shell + dispatch sur la vue.
 * Les routes secondaires (view: null) affichent "Vue à venir" sans quitter le SPA.
 */

(function (global) {
  'use strict';

  // Toutes les routes connues — view: null = "Vue à venir"
  const ROUTES = [
    { path: '/admin/pilotage',         view: 'PilotageView',         label: 'Pilotage',               icon: '🎯', section: 'PILOTAGE' },
    { path: '/admin/control-tower',    view: 'ControlTowerView',     label: 'Tour de contrôle',       icon: '🗼', section: 'PILOTAGE' },
    { path: '/admin/costing',          view: 'CostingView',          label: 'Coût rendu relais',      icon: '💰', section: 'PILOTAGE' },
    { path: '/admin/orders-logistics', view: 'OrdersLogisticsView',  label: 'Commandes & logistique', icon: '📦', section: 'PILOTAGE' },
    { path: '/admin/event-workspaces', view: 'EventWorkspacesView',  label: 'Panier événement',       icon: '🎉', section: 'PILOTAGE' },
    { path: '/admin/sales',            view: 'SalesView',            label: 'Ventes',                 icon: '📈', section: 'PILOTAGE' },
    { path: '/admin/economic',         view: 'EconomicView',         label: 'Santé économique',       icon: '📊', section: 'PILOTAGE' },
    { path: '/admin/pilotage-fin',     view: 'PilotageFinView',      label: 'Projection & Mix',       icon: '💹', section: 'PILOTAGE' },
    { path: '/admin/invoices',         view: 'InvoicesView',         label: 'Factures',               icon: '📄', section: 'PILOTAGE' },
    { path: '/admin/problems',         view: 'ProblemsView',         label: 'Problèmes',              icon: '⚠️',  section: 'OPERATIONS' },
    { path: '/admin/alerts',           view: 'ActionCenterView',     label: 'Alertes & Incidents',    icon: '🚨', section: 'OPERATIONS' },
    { path: '/admin/clients',          view: 'ClientsView',          label: 'Clients',                icon: '👥', section: 'OPERATIONS' },
    { path: '/admin/hub-relais',       view: 'HubRelaisView',        label: 'Hub & Relais',           icon: '🏭', section: 'OPERATIONS' },
    { path: '/admin/transitaire',      view: 'TransitaireView',      label: 'Transitaire',            icon: '✈️',  section: 'OPERATIONS' },
    { path: '/admin/inventory',        view: 'InventoryView',        label: 'Inventaire Hub',         icon: '📋', section: 'OPERATIONS' },
    { path: '/admin/categories', view: 'CategoriesView',  label: 'Catégories boutique', icon: '🏷️', section: 'CATALOGUE' },
    { path: '/admin/products',   view: 'ProductsView',    label: 'Produits boutique',   icon: '🛍️', section: 'CATALOGUE' },
    { path: '/admin/sourcing',         view: null,                   label: 'Sourcing',               icon: '🔎', section: 'AUTRES' },
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
      headers: { 'Accept': 'application/json' },
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

    // Regrouper par section
    const sections = {};
    ROUTES.forEach(r => {
      if (!sections[r.section]) sections[r.section] = [];
      sections[r.section].push(r);
    });

    Object.entries(sections).forEach(([sectionLabel, routes]) => {
      const sec = document.createElement('div');
      sec.className = 'sidebar-section';
      sec.innerHTML = `<div class="sidebar-section-label">${sectionLabel}</div>`;

      routes.forEach(r => {
        const link = document.createElement('a');
        // Pour les routes sans vue : href="#" + SPA navigation via click
        link.href = r.view ? r.path : '#';
        link.className = 'sidebar-link' + (currentPath === r.path ? ' is-active' : '');
        link.innerHTML = `<span class="sidebar-link-icon">${r.icon}</span><span>${r.label}</span>`;

        link.addEventListener('click', (e) => {
          e.preventDefault();
          navigateTo(r.path);
        });

        sec.appendChild(link);
      });

      nav.appendChild(sec);
    });
  }

  function navigateTo(path) {
    if (window.location.pathname === path) return;
    window.history.pushState({}, '', path);
    refreshActiveLink();
    dispatchView();
  }

  function refreshActiveLink() {
    const currentPath = window.location.pathname;
    document.querySelectorAll('.sidebar-link').forEach(link => {
      const route = ROUTES.find(r => r.path === currentPath);
      link.classList.toggle('is-active', link.textContent.trim().includes(
        route ? route.label : ''
      ));
    });
    // Méthode plus précise : comparer le href ou data-path
    document.querySelectorAll('.sidebar-link').forEach(link => {
      const matchingRoute = ROUTES.find(r => r.path === currentPath);
      if (matchingRoute) {
        link.classList.toggle('is-active',
          link.querySelector('span:last-child') &&
          link.querySelector('span:last-child').textContent === matchingRoute.label
        );
      }
    });
  }

  function renderHeaderPeriod() {
    const filters = KmcFilters.get();
    const el = document.getElementById('header-period');
    if (filters.from && filters.to) {
      const f = new Date(filters.from).toLocaleDateString('fr-FR');
      const t = new Date(filters.to).toLocaleDateString('fr-FR');
      el.textContent = `📅 ${f} – ${t}`;
    }
  }

  function dispatchView() {
    const path = window.location.pathname;
    const route = ROUTES.find(r => r.path === path);
    const main = document.getElementById('main-content');

    if (!route || !route.view) {
      const label = route ? route.label : path;
      main.innerHTML = `
        <div class="empty-state">
          <div style="font-size: 48px; margin-bottom: 16px;">🚧</div>
          <h2>${label}</h2>
          <p style="margin-top: 12px; color: var(--text-secondary);">Vue en cours de développement — disponible Sprint 3+</p>
        </div>
      `;
      return;
    }

    const View = global[route.view];
    if (!View || !View.render) {
      main.innerHTML = `<div class="error-state">Vue ${route.view} non chargée</div>`;
      return;
    }

    main.innerHTML = '<div class="loading-state"><span class="loader"></span> Chargement...</div>';
    View.render(main).catch(err => {
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

    // Gestion du bouton retour navigateur
    window.addEventListener('popstate', () => {
      refreshActiveLink();
      dispatchView();
    });

    KmcFilters.subscribe(() => {
      renderHeaderPeriod();
      dispatchView();
    });
  }

  global.KmcApp = { init, navigateTo };
})(window);

// Auto-init
document.addEventListener('DOMContentLoaded', () => window.KmcApp.init());

