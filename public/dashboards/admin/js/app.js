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
    { path: '/admin/categories', view: 'CategoriesView',  label: 'Catégories boutique', icon: '🏷️', section: 'CATALOGUE' },
    { path: '/admin/sourcing',         view: null,                   label: 'Sourcing',               icon: '🔎', section: 'AUTRES' },
    { path: '/admin/alerts',           view: null,                   label: 'Alertes',                icon: '🚨', section: 'AUTRES' },
  ];

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
              <div class="sidebar-rate-value">1 AED = 138.00 KMF</div>
              <div class="sidebar-rate-delta">↑ 0.35%</div>
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

  function init() {
    KmcFilters.init();
    renderShell();
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
