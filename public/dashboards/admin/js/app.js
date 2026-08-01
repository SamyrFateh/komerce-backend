/**
 * @komerce-arch
 * @role          admin-spa-entrypoint
 * @domain        admin-dashboard
 * @layer         entrypoint
 * @criticality   critical
 * @inputs        url_path, user_session, filter_state
 * @outputs       shell_dom, sidebar_nav_dom, dispatched_view
 * @depends       api-client.js, filters-store.js, utils.js, views/*
 * @used-by       none
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      kmc_api_only
 * @impact-areas  admin-dashboard, auth, all-spa-routes
 * @version       2026-06
 */

'use strict';
/**
 * KOMERCE Dashboard — App
 * Routing SPA (pushState) + shell CT/BO + dispatch.
 *
 * Architecture shells :
 *   CT (Tour de Contrôle) — accent bleu #3b82f6  — rôles : admin, finance, sourcing
 *   BO (Back Office)      — accent teal #0d9488  — rôles : admin, hub, relais, support, finance
 *
 * Chaque ROUTE déclare un `shell` ('ct' | 'bo').
 * La sidebar ne montre que les routes du shell actif.
 * Le shell-switcher n'apparaît que si l'utilisateur a accès aux deux shells.
 */
(function (global) {
  'use strict';

  // ── Définition des shells ──────────────────────────────────────────────────

  const SHELLS = {
    ct: {
      id:          'ct',
      label:       'Tour de Contrôle',
      shortLabel:  'CT',
      emoji:       '🗼',
      accent:      '#3b82f6',
      accentBg:    '#1e3a5f',
      description: 'Signal · Synthèse · Arbitrage · Décision',
    },
    bo: {
      id:          'bo',
      label:       'Back Office',
      shortLabel:  'BO',
      emoji:       '🗄️',
      accent:      '#0d9488',
      accentBg:    '#134e4a',
      description: 'Traitement · Mise à jour · Exécution',
    },
  };

  // ── Rôles et accès aux shells ──────────────────────────────────────────────

  const ROLE_SHELLS = {
    admin:    ['ct', 'bo'],
    finance:  ['ct', 'bo'],
    sourcing: ['ct', 'bo'],
    hub:      ['bo'],
    relais:   ['bo'],
    support:  ['bo'],
  };

  // ── Registre des routes ────────────────────────────────────────────────────
  // shell : 'ct' | 'bo'
  // roles : null = tous les rôles du shell ; sinon restreint

  const ROUTES = [
    // ══ CT — Pilotage ══
    { path: '/admin/pilotage',         view: 'PilotageView',         label: 'Pilotage',               icon: '🎯', shell: 'ct', section: 'PILOTAGE' },
    { path: '/admin/sante',            view: 'SanteView',            label: 'Santé Business',         icon: '🏥', shell: 'ct', section: 'PILOTAGE' },
    { path: '/admin/control-tower',    view: 'ControlTowerView',     label: 'Tour de contrôle',       icon: '🗼', shell: 'ct', section: 'PILOTAGE' },
    { path: '/admin/costing',          view: 'CostingView',          label: 'Coût rendu relais',      icon: '💰', shell: 'ct', section: 'PILOTAGE' },
    { path: '/admin/orders-logistics', view: 'OrdersLogisticsView',  label: 'Commandes & logistique', icon: '📦', shell: 'ct', section: 'PILOTAGE' },
    { path: '/admin/sales',            view: 'SalesView',            label: 'Ventes',                 icon: '📈', shell: 'ct', section: 'PILOTAGE' },
    { path: '/admin/economic',         view: 'EconomicView',         label: 'Santé économique',       icon: '📊', shell: 'ct', section: 'PILOTAGE' },
    { path: '/admin/pilotage-fin',     view: 'PilotageFinView',      label: 'Projection & Mix',       icon: '💹', shell: 'ct', section: 'PILOTAGE' },
    { path: '/admin/invoices',         view: 'InvoicesView',         label: 'Factures',               icon: '📄', shell: 'ct', section: 'PILOTAGE' },

    // ══ CT — Sourcing / Pricing ══
    { path: '/admin/sourcing',          view: 'SourcingView',          label: 'Sourcing',              icon: '🔎', shell: 'ct', section: 'SOURCING',  roles: ['admin','sourcing'] },
    { path: '/admin/sourcing-scanner',  view: 'SourcingScannerView',   label: 'Scanner catalogue',     icon: '📡', shell: 'ct', section: 'SOURCING',  roles: ['admin','sourcing'] },
    { path: '/admin/pricing',           view: 'PricingView',           label: 'Construction du Prix',  icon: '🧮', shell: 'ct', section: 'PRICING',   roles: ['admin','sourcing','finance'] },
    { path: '/admin/pricing-workshop',  view: 'PricingWorkshopView',   label: 'Config des coûts',      icon: '⚙️', shell: 'ct', section: 'PRICING',   roles: ['admin'] },
    { path: '/admin/pricing-strategy',  view: 'PricingStrategyView',   label: 'Stratégie de prix',     icon: '📈', shell: 'ct', section: 'PRICING',   roles: ['admin','sourcing','finance'] },
    { path: '/admin/economic-flow',     view: 'EconomicFlowView',      label: 'Carte économique',      icon: '🔭', shell: 'ct', section: 'PRICING',   roles: ['admin','sourcing','finance'] },
    { path: '/admin/categories',        view: 'CategoriesView',        label: 'Catégories boutique',   icon: '🏷️', shell: 'ct', section: 'CATALOGUE', roles: ['admin'] },
    { path: '/admin/products',          view: 'ProductsView',          label: 'Produits boutique',     icon: '🛍️', shell: 'ct', section: 'CATALOGUE', roles: ['admin'] },
    { path: '/admin/catalog-approval',  view: 'CatalogApprovalView',   label: 'File d\'approbation',   icon: '✅', shell: 'ct', section: 'CATALOGUE', roles: ['admin'] },

    // ══ BO — Opérations ══
    { path: '/admin/problems',         view: 'ProblemsView',         label: 'Problèmes',              icon: '⚠️', shell: 'bo', section: 'OPÉRATIONS' },
    { path: '/admin/alerts',           view: 'ActionCenterView',     label: 'Alertes & Incidents',    icon: '🚨', shell: 'bo', section: 'OPÉRATIONS' },
    { path: '/admin/clients',          view: 'ClientsView',          label: 'Clients',                icon: '👥', shell: 'bo', section: 'OPÉRATIONS', roles: ['admin','support','finance'] },
    { path: '/admin/hub-relais',       view: 'HubRelaisView',        label: 'Hub & Relais',           icon: '🏭', shell: 'bo', section: 'OPÉRATIONS', roles: ['admin','hub','relais'] },
    { path: '/admin/transitaire',      view: 'TransitaireView',      label: 'Transitaire',            icon: '✈️', shell: 'bo', section: 'OPÉRATIONS', roles: ['admin','hub'] },
    { path: '/admin/inventory',        view: 'InventoryView',        label: 'Inventaire Hub',         icon: '📋', shell: 'bo', section: 'OPÉRATIONS', roles: ['admin','hub'] },

    // ══ BO — Finance ══
    { path: '/admin/accounting',        view: 'AccountingView',        label: 'Comptabilité',          icon: '🧾', shell: 'bo', section: 'FINANCE', roles: ['admin','finance'] },
    { path: '/admin/customs',           view: 'CustomsView',           label: 'Douane & shipments',    icon: '🛃', shell: 'bo', section: 'FINANCE', roles: ['admin','finance'] },
    { path: '/admin/suppliers',         view: 'SuppliersView',         label: 'Fournisseurs',          icon: '🏭', shell: 'bo', section: 'FINANCE', roles: ['admin','sourcing'] },

    // ══ BO — Config ══
    { path: '/admin/settings',          view: 'SettingsView',          label: 'Paramètres',            icon: '⚙️', shell: 'bo', section: 'CONFIG', roles: ['admin'] },
    { path: '/admin/simulator',         view: 'SimulatorView',         label: 'Simulateur',            icon: '🧪', shell: 'bo', section: 'CONFIG', roles: ['admin'] },
    { path: '/admin/shared-carts',      view: 'SharedCartsView',       label: 'Paniers partagés',      icon: '🛒', shell: 'bo', section: 'CONFIG', roles: ['admin','support'] },
  ];

  const EXTERNAL_APPS = [
    { path: '/hub',    label: 'Application Hub',    icon: '🏭' },
    { path: '/relais', label: 'Application Relais', icon: '📍' },
  ];

  // ── État ──────────────────────────────────────────────────────────────────

  let currentUser = null;
  let activeShell = 'ct';    // shell courant

  // ── Mode focus ────────────────────────────────────────────────────────────
  // Activé par 3 mécanismes cumulatifs :
  //   1. ?focus=1 dans l'URL
  //   2. document.referrer venant de /portail ou /pilotage
  //   3. sessionStorage.kmc_focus_origin === 'portail'
  // Masque la sidebar ; affiche uniquement la vue + header minimal.

  function isFocusMode() {
    if (new URLSearchParams(window.location.search).get('focus') === '1') return true;
    try {
      const ref = document.referrer;
      if (ref) {
        const refPath = new URL(ref).pathname;
        if (refPath === '/portail' || refPath === '/pilotage') return true;
      }
    } catch (_) {}
    if (sessionStorage.getItem('kmc_focus_origin') === 'portail') {
      sessionStorage.removeItem('kmc_focus_origin');
      return true;
    }
    return false;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  function loginUrl() {
    const next = window.location.pathname + window.location.search + window.location.hash;
    return '/login.html?next=' + encodeURIComponent(next);
  }

  function redirectToLogin() {
    window.location.replace(loginUrl());
  }

  async function requireSession() {
    // kmc-api-allow: bootstrap session, KmcApi pas encore chargé au démarrage du routeur SPA
    const res = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) { redirectToLogin(); throw new Error('unauthorized'); }
    const user = await res.json();
    const allowedRoles = Object.keys(ROLE_SHELLS);
    if (!allowedRoles.includes(user.role)) {
      window.location.replace('/');
      throw new Error('forbidden');
    }
    currentUser = user;
    global.KOMERCE_AUTH_USER = user;
    return user;
  }

  // ── Helpers rôle / shell ──────────────────────────────────────────────────

  function userRole() {
    return (currentUser && currentUser.role) || 'admin';
  }

  function shellsForUser() {
    return ROLE_SHELLS[userRole()] || ['bo'];
  }

  function routeVisibleInShell(route) {
    if (route.shell !== activeShell) return false;
    if (!route.roles) return true;               // pas de restriction de rôle
    return route.roles.includes(userRole());
  }

  function defaultPathForShell(shell) {
    const first = ROUTES.find(r => r.shell === shell && (!r.roles || r.roles.includes(userRole())));
    return first ? first.path : null;
  }

  // ── CSS dynamique shell ───────────────────────────────────────────────────

  function applyShellTheme(shellId) {
    const s = SHELLS[shellId];
    const root = document.documentElement;
    root.style.setProperty('--shell-accent',    s.accent);
    root.style.setProperty('--shell-accent-bg', s.accentBg);
    // Mise à jour de la sidebar border
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.style.borderRight = `3px solid ${s.accent}`;
    }
    // Mise à jour du label shell
    const titleEl = document.getElementById('sidebar-shell-title');
    if (titleEl) titleEl.textContent = `${s.emoji} ${s.label}`;
    const descEl = document.getElementById('sidebar-shell-desc');
    if (descEl) descEl.textContent = s.description;
  }

  // ── Render shell focus ────────────────────────────────────────────────────
  // Shell minimaliste sans sidebar (mode ?focus=1).

  function renderFocusShell() {
    const path  = window.location.pathname;
    const route = ROUTES.find(r => r.path === path);
    const label = route ? `${route.icon} ${route.label}` : 'Back Office';

    document.body.innerHTML = `
      <div class="app-shell app-shell--focus">
        <header class="header header--focus">
          <a class="focus-back-btn" href="/portail" title="Retour au portail">← Portail</a>
          <div class="focus-route-label">${label}</div>
          <div class="header-actions" style="position:relative">
            <div class="header-user" id="header-user-btn" style="cursor:pointer" title="Compte">
              <div class="header-user-avatar" id="user-avatar">A</div>
              <div>
                <div class="header-user-name" id="user-name">Admin</div>
                <div class="header-user-role" id="user-role-label">—</div>
              </div>
            </div>
            <div id="user-menu-popup" style="display:none;position:fixed;top:56px;right:16px;z-index:200;background:#1e293b;border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:8px;box-shadow:0 8px 32px rgba(0,0,0,.5);min-width:180px">
              <div style="padding:8px 10px 10px;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:6px">
                <div style="font-size:13px;font-weight:600;color:#f1f5f9" id="user-menu-name">—</div>
                <div style="font-size:11px;color:#64748b;margin-top:2px" id="user-menu-role">—</div>
              </div>
              <button id="logout-btn" style="width:100%;padding:9px 10px;border-radius:6px;border:none;background:transparent;color:#f87171;font-size:13px;font-weight:600;text-align:left;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:8px">🚪 Se déconnecter</button>
            </div>
          </div>
        </header>
        <main class="main main--focus" id="main-content">
          <div class="loading-state"><span class="loader"></span> Chargement...</div>
        </main>
      </div>
    `;

    // Wiring user menu + logout
    hydrateHeaderUser();
    const userBtn   = document.getElementById('header-user-btn');
    const userPopup = document.getElementById('user-menu-popup');
    if (userBtn && userPopup) {
      userBtn.addEventListener('click', e => {
        e.stopPropagation();
        const isOpen = userPopup.style.display === 'block';
        closeAllPopups();
        if (!isOpen) userPopup.style.display = 'block';
      });
    }
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', e => { e.stopPropagation(); _logout(); });
    document.addEventListener('click', () => closeAllPopups());
  }

  // ── Render shell ──────────────────────────────────────────────────────────

  function renderShell() {
    if (isFocusMode()) { renderFocusShell(); return; }
    const shell = SHELLS[activeShell];
    const userShells = shellsForUser();
    const showSwitcher = userShells.length > 1;

    document.body.innerHTML = `
      <div class="app-shell">
        <aside class="sidebar" style="border-right: 3px solid ${shell.accent}">

          <div class="sidebar-brand">
            <div class="sidebar-brand-logo"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 200" role="img" aria-label="Komerce">
  <g stroke="var(--cta-green, #2a7a3e)" stroke-width="16" stroke-linecap="round" fill="none">
    <path d="M42 54.5V87M42 113v32.5"/>
    <path d="M51.5 91.1 97.1 48.1M51.5 108.9l45.6 43M55 100h68"/>
  </g>
  <g fill="none" stroke="var(--cta-green, #2a7a3e)" stroke-width="13">
    <circle cx="42" cy="34" r="14"/><circle cx="42" cy="166" r="14"/>
    <circle cx="112" cy="34" r="14"/><circle cx="112" cy="166" r="14"/>
  </g>
  <circle cx="42" cy="100" r="9" fill="var(--coral, #C85C2D)"/>
  <circle cx="160" cy="100" r="30" fill="none" stroke="var(--cta-green, #2a7a3e)" stroke-width="14"/>
  <circle cx="160" cy="100" r="11" fill="var(--coral, #C85C2D)"/>
</svg></div>
            <div>
              <div class="sidebar-brand-text" id="sidebar-shell-title">${shell.emoji} ${shell.label}</div>
              <div class="sidebar-brand-sub" id="sidebar-shell-desc">${shell.description}</div>
            </div>
          </div>

          ${showSwitcher ? renderSwitcherHTML(userShells) : ''}

          <nav class="sidebar-nav" id="sidebar-nav"></nav>

          <div class="sidebar-footer">
            <div class="sidebar-footer-user">
              <div class="sidebar-footer-name" id="user-footer-name">—</div>
              <div class="sidebar-footer-role" id="user-footer-role"></div>
            </div>
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
          <div class="header-period" id="header-period" style="cursor:pointer" title="Changer la période">📅 7 derniers jours</div>
          <div id="date-picker-popup" style="display:none;position:fixed;top:56px;right:220px;z-index:200;background:#1e293b;border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:16px;box-shadow:0 8px 32px rgba(0,0,0,.5);flex-direction:column;gap:10px;min-width:260px">
            <div style="font-size:12px;font-weight:700;color:#94a3b8;letter-spacing:.08em;text-transform:uppercase;margin-bottom:2px">Période</div>
            <div style="display:flex;gap:8px">
              <div style="flex:1"><div style="font-size:11px;color:#64748b;margin-bottom:3px">Du</div><input type="date" id="dp-from" style="width:100%;padding:7px 10px;background:#0f172a;border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#f1f5f9;font-size:13px;outline:none"></div>
              <div style="flex:1"><div style="font-size:11px;color:#64748b;margin-bottom:3px">Au</div><input type="date" id="dp-to" style="width:100%;padding:7px 10px;background:#0f172a;border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#f1f5f9;font-size:13px;outline:none"></div>
            </div>
            <div style="display:flex;gap:6px">
              <button data-quick="7"  style="flex:1;padding:5px 8px;border-radius:5px;border:1px solid rgba(255,255,255,0.1);background:#1e293b;color:#94a3b8;font-size:11px;cursor:pointer;font-family:inherit">7j</button>
              <button data-quick="30" style="flex:1;padding:5px 8px;border-radius:5px;border:1px solid rgba(255,255,255,0.1);background:#1e293b;color:#94a3b8;font-size:11px;cursor:pointer;font-family:inherit">30j</button>
              <button data-quick="90" style="flex:1;padding:5px 8px;border-radius:5px;border:1px solid rgba(255,255,255,0.1);background:#1e293b;color:#94a3b8;font-size:11px;cursor:pointer;font-family:inherit">90j</button>
            </div>
            <button id="dp-apply" style="padding:8px;border-radius:6px;border:none;background:#3b82f6;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">✓ Appliquer</button>
          </div>
          <div class="header-actions" style="position:relative">
            <div class="header-user" id="header-user-btn" style="cursor:pointer" title="Compte">
              <div class="header-user-avatar" id="user-avatar">A</div>
              <div>
                <div class="header-user-name" id="user-name">Admin</div>
                <div class="header-user-role" id="user-role-label">—</div>
              </div>
            </div>
            <div id="user-menu-popup" style="display:none;position:fixed;top:56px;right:16px;z-index:200;background:#1e293b;border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:8px;box-shadow:0 8px 32px rgba(0,0,0,.5);min-width:180px">
              <div style="padding:8px 10px 10px;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:6px">
                <div style="font-size:13px;font-weight:600;color:#f1f5f9" id="user-menu-name">—</div>
                <div style="font-size:11px;color:#64748b;margin-top:2px" id="user-menu-role">—</div>
              </div>
              <button id="logout-btn" style="width:100%;padding:9px 10px;border-radius:6px;border:none;background:transparent;color:#f87171;font-size:13px;font-weight:600;text-align:left;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:8px">🚪 Se déconnecter</button>
            </div>
          </div>
        </header>

        <main class="main" id="main-content">
          <div class="loading-state"><span class="loader"></span> Chargement...</div>
        </main>
      </div>
    `;

    // Appliquer tokens CSS shell
    applyShellTheme(activeShell);

    // Wiring switcher
    if (showSwitcher) {
      document.getElementById('shell-switcher').addEventListener('click', e => {
        const btn = e.target.closest('[data-shell]');
        if (!btn) return;
        switchShell(btn.dataset.shell);
      });
    }

    buildSidebarNav();
    hydrateHeaderUser();
    renderHeaderPeriod();

    // ── Wiring date picker ────────────────────────────────────────────────────
    const periodBtn   = document.getElementById('header-period');
    const datePopup   = document.getElementById('date-picker-popup');
    if (periodBtn && datePopup) {
      periodBtn.addEventListener('click', e => {
        e.stopPropagation();
        const isOpen = datePopup.style.display === 'flex';
        closeAllPopups();
        if (!isOpen) {
          // Pré-remplir les inputs avec les filtres courants
          const f = KmcFilters.get();
          const fromEl = document.getElementById('dp-from');
          const toEl   = document.getElementById('dp-to');
          if (fromEl && f.from) fromEl.value = f.from;
          if (toEl   && f.to)   toEl.value   = f.to;
          datePopup.style.display = 'flex';
        }
      });
    }

    // ── Wiring user menu ──────────────────────────────────────────────────────
    const userBtn    = document.getElementById('header-user-btn');
    const userPopup  = document.getElementById('user-menu-popup');
    if (userBtn && userPopup) {
      userBtn.addEventListener('click', e => {
        e.stopPropagation();
        const isOpen = userPopup.style.display === 'block';
        closeAllPopups();
        if (!isOpen) userPopup.style.display = 'block';
      });
    }

    // ── Wiring boutons date picker ────────────────────────────────────────────
    datePopup && datePopup.querySelectorAll('[data-quick]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        _quickPeriod(Number(btn.dataset.quick));
      });
    });
    const applyBtn = document.getElementById('dp-apply');
    if (applyBtn) applyBtn.addEventListener('click', e => { e.stopPropagation(); _applyPeriod(); });

    // ── Wiring bouton logout ──────────────────────────────────────────────────
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', e => { e.stopPropagation(); _logout(); });

    // Fermer les popups en cliquant ailleurs
    document.addEventListener('click', () => closeAllPopups());
  }

  function renderSwitcherHTML(userShells) {
    const tabs = userShells.map(id => {
      const s = SHELLS[id];
      const isActive = id === activeShell;
      return `
        <button class="shell-tab${isActive ? ' shell-tab--active' : ''}"
                data-shell="${id}"
                style="${isActive ? `background:${s.accentBg};color:#fff;border-bottom:2px solid ${s.accent}` : ''}">
          ${s.emoji} ${s.shortLabel}
        </button>`;
    }).join('');
    return `<div class="shell-switcher" id="shell-switcher">${tabs}</div>`;
  }

  function switchShell(shellId) {
    if (!SHELLS[shellId]) return;
    activeShell = shellId;
    applyShellTheme(shellId);
    // Mettre à jour les tabs du switcher
    document.querySelectorAll('.shell-tab').forEach(btn => {
      const isActive = btn.dataset.shell === shellId;
      const s = SHELLS[btn.dataset.shell];
      btn.classList.toggle('shell-tab--active', isActive);
      btn.style.background   = isActive ? s.accentBg : '';
      btn.style.color        = isActive ? '#fff' : '';
      btn.style.borderBottom = isActive ? `2px solid ${s.accent}` : '';
    });
    // Reconstruire la sidebar
    buildSidebarNav();
    // Naviguer vers la première route du nouveau shell
    const defaultPath = defaultPathForShell(shellId);
    if (defaultPath) navigateTo(defaultPath);
  }

  // ── Sidebar nav ────────────────────────────────────────────────────────────

  function buildSidebarNav() {
    const nav = document.getElementById('sidebar-nav');
    if (!nav) return;
    nav.innerHTML = '';

    const currentPath = window.location.pathname;
    const visibleRoutes = ROUTES.filter(routeVisibleInShell);

    // Grouper par section
    const sections = {};
    visibleRoutes.forEach(route => {
      if (!sections[route.section]) sections[route.section] = [];
      sections[route.section].push(route);
    });

    Object.entries(sections).forEach(([sectionLabel, routes]) => {
      const section = document.createElement('div');
      section.className = 'sidebar-section';
      section.innerHTML = `<div class="sidebar-section-label">${sectionLabel}</div>`;
      routes.forEach(route => {
        const link = document.createElement('a');
        link.href           = route.path;
        link.dataset.path   = route.path;
        link.className      = 'sidebar-link' + (currentPath === route.path ? ' is-active' : '');
        link.innerHTML      = `<span class="sidebar-link-icon">${route.icon}</span><span>${route.label}</span>`;
        link.addEventListener('click', event => {
          event.preventDefault();
          navigateTo(route.path);
        });
        section.appendChild(link);
      });
      nav.appendChild(section);
    });

    // Applications terrain (toujours visibles)
    const appsSection = document.createElement('div');
    appsSection.className = 'sidebar-section';
    appsSection.innerHTML = '<div class="sidebar-section-label">APPLIS TERRAIN</div>';
    EXTERNAL_APPS.forEach(app => {
      const link = document.createElement('a');
      link.href       = app.path;
      link.className  = 'sidebar-link';
      link.innerHTML  = `
        <span class="sidebar-link-icon">${app.icon}</span>
        <span>${app.label}</span>
        <span style="margin-left:auto;font-size:11px;opacity:.55">↗</span>
      `;
      appsSection.appendChild(link);
    });
    nav.appendChild(appsSection);
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  function navigateTo(path) {
    const route = ROUTES.find(r => r.path === path);
    if (!route) return false;
    // Si la route est dans un autre shell → changer de shell silencieusement
    if (route.shell !== activeShell) {
      activeShell = route.shell;
      applyShellTheme(activeShell);
      buildSidebarNav();
    }
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    refreshActiveLink();
    dispatchView();
    return true;
  }

  // Compatibilité vues Lot 4 qui appellent KmcApp.navigate('PricingView') ou 'pricing'
  function navigate(viewOrPath) {
    const value = String(viewOrPath || '');
    const route = ROUTES.find(r =>
      r.view === value ||
      r.path === value ||
      r.path === '/admin/' + value.replace(/^\/+/, '')
    );
    return route ? navigateTo(route.path) : false;
  }

  function refreshActiveLink() {
    const currentPath = window.location.pathname;
    document.querySelectorAll('.sidebar-link').forEach(link => {
      link.classList.toggle('is-active', link.dataset.path === currentPath);
    });
  }

  // ── Header / UI helpers ────────────────────────────────────────────────────

  function hydrateHeaderUser() {
    if (!currentUser) return;
    const name   = currentUser.full_name || currentUser.email || 'Admin';
    const role   = currentUser.role || 'admin';
    const avatar = document.getElementById('user-avatar');
    const nameEl = document.getElementById('user-name');
    const roleEl = document.getElementById('user-role-label');
    const footerName = document.getElementById('user-footer-name');
    const footerRole = document.getElementById('user-footer-role');
    const menuName = document.getElementById('user-menu-name');
    const menuRole = document.getElementById('user-menu-role');
    if (avatar)     avatar.textContent     = String(name).trim().charAt(0).toUpperCase() || 'A';
    if (nameEl)     nameEl.textContent     = name;
    if (roleEl)     roleEl.textContent     = role;
    if (footerName) footerName.textContent = name;
    if (footerRole) footerRole.textContent = role;
    if (menuName)   menuName.textContent   = name;
    if (menuRole)   menuRole.textContent   = role;
  }

  function renderHeaderPeriod() {
    const filters = KmcFilters.get();
    const el = document.getElementById('header-period');
    if (!el) return;
    if (filters.from && filters.to) {
      const from = new Date(filters.from).toLocaleDateString('fr-FR');
      const to   = new Date(filters.to).toLocaleDateString('fr-FR');
      el.textContent = `📅 ${from} – ${to}`;
    }
  }

  // ── Dispatch vue ───────────────────────────────────────────────────────────

  async function invokeView(View, main) {
    if (View && typeof View.render === 'function') return View.render(main);
    if (typeof View === 'function') {
      const source = Function.prototype.toString.call(View);
      if (/\bthis\.render\s*=/.test(source)) {
        const instance = new View();
        if (!instance || typeof instance.render !== 'function')
          throw new Error('constructeur de vue sans méthode render');
        return instance.render(main);
      }
      return View(main);
    }
    throw new Error('format de vue incompatible');
  }

  function dispatchView() {
    const path  = window.location.pathname;
    const route = ROUTES.find(r => r.path === path);
    const main  = document.getElementById('main-content');

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

    // Accès direct (URL, lien partagé, retour navigateur...) sur une route
    // dont le rôle courant est exclu : on évite d'invoquer la vue (qui
    // appellerait l'API et afficherait un 403 brut) et on explicite plutôt
    // l'absence de droits.
    if (route.roles && !route.roles.includes(userRole())) {
      main.innerHTML = `
        <div class="empty-state">
          <div style="font-size:48px;margin-bottom:16px;">🔒</div>
          <h2>Accès refusé</h2>
          <p style="margin-top:12px;color:var(--text-secondary);">
            Vous n'avez pas les droits nécessaires pour consulter « ${route.label} ».
          </p>
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

  // ── Taux de change ─────────────────────────────────────────────────────────

  async function loadFxRate() {
    try {
      const config  = await KmcApi.getFinanceConfig();
      const rate    = config && (config.aed_to_kmf_rate || config.fx_rate_aed_kmf);
      const rateEl  = document.getElementById('sidebar-fx-rate');
      const deltaEl = document.getElementById('sidebar-fx-delta');
      if (rateEl)  rateEl.textContent  = rate ? `1 AED = ${Number(rate).toFixed(2)} KMF` : '—';
      if (deltaEl) deltaEl.textContent = '';
    } catch (_) {
      const deltaEl = document.getElementById('sidebar-fx-delta');
      if (deltaEl) deltaEl.textContent = 'Indisponible';
    }
  }

  // ── Déterminer shell initial ────────────────────────────────────────────────

  function resolveInitialShell() {
    const userShells = shellsForUser();
    const path       = window.location.pathname;
    const route      = ROUTES.find(r => r.path === path);

    if (route && userShells.includes(route.shell)) {
      return route.shell;
    }
    // Défaut : CT si l'utilisateur y a accès, sinon BO
    return userShells.includes('ct') ? 'ct' : 'bo';
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  async function init() {
    try {
      await requireSession();
    } catch (_) {
      return;
    }

    activeShell = resolveInitialShell();

    KmcFilters.init();
    renderShell();
    loadFxRate();
    dispatchView();

    window.addEventListener('popstate', () => {
      // Déduire le shell depuis la route si possible
      const path  = window.location.pathname;
      const route = ROUTES.find(r => r.path === path);
      if (route && route.shell !== activeShell) {
        activeShell = route.shell;
        applyShellTheme(activeShell);
        buildSidebarNav();
      }
      refreshActiveLink();
      dispatchView();
    });

    KmcFilters.subscribe(() => {
      renderHeaderPeriod();
      dispatchView();
    });
  }

  // ── Popups helpers ─────────────────────────────────────────────────────────

  function closeAllPopups() {
    const dp = document.getElementById('date-picker-popup');
    const um = document.getElementById('user-menu-popup');
    if (dp) dp.style.display = 'none';
    if (um) um.style.display = 'none';
  }

  // ── Actions header ─────────────────────────────────────────────────────────

  async function _logout() {
    try {
      // kmc-api-allow: logout au bootstrap, hors cycle KmcApi
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (_) { /* ignorer les erreurs réseau */ }
    redirectToLogin();
  }

  function _quickPeriod(days) {
    const to   = new Date();
    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    const fmt = d => d.toISOString().slice(0, 10);
    const fromEl = document.getElementById('dp-from');
    const toEl   = document.getElementById('dp-to');
    if (fromEl) fromEl.value = fmt(from);
    if (toEl)   toEl.value   = fmt(to);
  }

  function _applyPeriod() {
    const from = document.getElementById('dp-from')?.value;
    const to   = document.getElementById('dp-to')?.value;
    if (!from || !to) return;
    if (from > to) {
      alert('La date de début doit être antérieure à la date de fin.');
      return;
    }
    KmcFilters.set({ from, to });
    closeAllPopups();
  }

  global.KmcApp = { init, navigateTo, navigate, _logout, _quickPeriod, _applyPeriod };

})(window);

document.addEventListener('DOMContentLoaded', () => window.KmcApp.init());
