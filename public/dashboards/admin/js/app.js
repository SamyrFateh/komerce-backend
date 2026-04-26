/**
 * KOMERCE Dashboard — App
 * ════════════════════════════════════════════════════════════════════════
 * Routing simple + render shell + dispatch sur la vue.
 */

(function (global) {
  'use strict';

  const ROUTES = [
    { path: '/admin/pilotage',         view: 'PilotageView',         label: 'Pilotage',          icon: '🎯', section: 'main' },
    { path: '/admin/control-tower',    view: 'ControlTowerView',     label: 'Tour de contrôle',  icon: '🗼', section: 'main' },
    { path: '/admin/costing',          view: 'CostingView',          label: 'Coût rendu relais', icon: '💰', section: 'main' },
    { path: '/admin/orders-logistics', view: 'OrdersLogisticsView',  label: 'Commandes & logistique', icon: '📦', section: 'main' },
    { path: '/admin/event-workspaces', view: 'EventWorkspacesView',  label: 'Panier événement',  icon: '🎉', section: 'main' },
  ];

  const SECONDARY_ROUTES = [
    { path: '/admin/sourcing',     view: null, label: 'Sourcing',     icon: '🔎' },
    { path: '/admin/alerts',       view: null, label: 'Alertes',      icon: '🚨' },
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

    // Section main
    const mainSection = document.createElement('div');
    mainSection.className = 'sidebar-section';
    mainSection.innerHTML = '<div class="sidebar-section-label">Pilotage</div>';
    ROUTES.forEach(r => {
      const link = document.createElement('a');
      link.href = r.path;
      link.className = 'sidebar-link' + (currentPath === r.path ? ' is-active' : '');
      link.innerHTML = `<span class="sidebar-link-icon">${r.icon}</span><span>${r.label}</span>`;
      mainSection.appendChild(link);
    });
    nav.appendChild(mainSection);

    // Section autres
    if (SECONDARY_ROUTES.length) {
      const sec = document.createElement('div');
      sec.className = 'sidebar-section';
      sec.innerHTML = '<div class="sidebar-section-label">Autres</div>';
      SECONDARY_ROUTES.forEach(r => {
        const link = document.createElement('a');
        link.href = r.path;
        link.className = 'sidebar-link' + (currentPath === r.path ? ' is-active' : '');
        link.innerHTML = `<span class="sidebar-link-icon">${r.icon}</span><span>${r.label}</span>`;
        sec.appendChild(link);
      });
      nav.appendChild(sec);
    }
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
      main.innerHTML = `
        <div class="empty-state">
          <h2>Vue à venir (Sprint 3+)</h2>
          <p style="margin-top: 12px;">${path}</p>
        </div>
      `;
      return;
    }

    const View = global[route.view];
    if (!View || !View.render) {
      main.innerHTML = `<div class="error-state">Vue ${route.view} non chargée</div>`;
      return;
    }

    View.render(main).catch(err => {
      console.error('[app] render error:', err);
      main.innerHTML = `<div class="error-state">Erreur: ${err.message}</div>`;
    });
  }

  function init() {
    KmcFilters.init();
    renderShell();
    dispatchView();

    KmcFilters.subscribe(() => {
      renderHeaderPeriod();
      dispatchView();
    });
  }

  global.KmcApp = { init };
})(window);

// Auto-init
document.addEventListener('DOMContentLoaded', () => window.KmcApp.init());
