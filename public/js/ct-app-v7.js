/* ===================================================================
   Komerce Control Tower — ct-app-v7.js
   Router principal · Shell navigation · Role-based sidebar
   v8.0 — Architecture CT / BO (2 shells, rôles, registry)
   =================================================================== */
window.CT = window.CT || {};

CT.app = {
  currentView: null,
  drillDownCtx: null,

  /* Flags to prevent duplicate event delegation */
  _navBound: false,
  _switcherBound: false,

  /* ══════════════════════════════════════════════════════════════
     INIT
     ══════════════════════════════════════════════════════════════ */
  init: function() {
    /* Login form */
    var form = document.getElementById('ct-login-form');
    if (form) {
      form.addEventListener('submit', function(e) {
        e.preventDefault();
        CT.app.login();
      });
    }

    /* Bind delegated listeners (once) */
    CT.app._bindEvents();

    /* Listen for drill-back clicks on main content (delegated) */
    var mainEl = document.getElementById('ct-main');
    if (mainEl) {
      mainEl.addEventListener('click', function(e) {
        var btn = e.target.closest('[data-action="drill-back"]');
        if (btn) { CT.platform.drillBack(); }
      });
    }

    /* Check existing session */
    if (localStorage.getItem('kmrc_logged_in')) {
      CT.api.me().then(function(user) {
        CT.app.onLogin(user);
      }).catch(function() {
        CT.app.showLogin();
      });
    } else {
      CT.app.showLogin();
    }
  },

  /* ── Delegated event listeners (bound once, never re-added) ── */
  _bindEvents: function() {
    /* Sidebar nav */
    var nav = document.getElementById('ct-sidebar-nav');
    if (nav && !CT.app._navBound) {
      nav.addEventListener('click', function(e) {
        // Cleanup avril 2026 : toggle section pliable (Configuration & Expert)
        var sectionToggle = e.target.closest('[data-section-toggle]');
        if (sectionToggle) {
          var sectionId = sectionToggle.dataset.sectionToggle;
          var body = nav.querySelector('[data-section-body="' + sectionId + '"]');
          if (!body) return;
          var isOpen = body.style.display !== 'none';
          body.style.display = isOpen ? 'none' : 'block';
          sectionToggle.setAttribute('aria-expanded', String(!isOpen));
          var caret = sectionToggle.querySelector('.ct-section-caret');
          if (caret) caret.textContent = isOpen ? '\u25B6' : '\u25BC';
          try { localStorage.setItem('ct-' + sectionId + '-open', String(!isOpen)); } catch (_) {}
          return;
        }

        var btn = e.target.closest('[data-view],[data-action]');
        if (!btn) return;
        if (btn.dataset.view)   CT.app.navigate(btn.dataset.view);
        if (btn.dataset.action === 'seed')  CT.app.doSeed();
        if (btn.dataset.action === 'reset') CT.app.doReset();
      });
      CT.app._navBound = true;
    }

    /* Shell switcher */
    var switcher = document.getElementById('ct-shell-switcher');
    if (switcher && !CT.app._switcherBound) {
      switcher.addEventListener('click', function(e) {
        var btn = e.target.closest('[data-shell]');
        if (!btn) return;
        CT.platform.setShell(btn.dataset.shell);
      });
      CT.app._switcherBound = true;
    }

    /* Logout */
    var logoutBtn = document.getElementById('ct-logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function() { CT.app.logout(); });
    }
  },

  /* ══════════════════════════════════════════════════════════════
     AUTH
     ══════════════════════════════════════════════════════════════ */
  login: async function() {
    var email = document.getElementById('ct-email').value;
    var pass  = document.getElementById('ct-password').value;
    var errEl = document.getElementById('ct-login-error');
    try {
      errEl.textContent = '';
      var result = await CT.api.login(email, pass);
      localStorage.setItem('kmrc_logged_in', '1');
      CT.app.onLogin(result.user || result);
    } catch (err) {
      errEl.textContent = '❌ ' + err.message;
    }
  },

  onLogin: function(user) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('bo-app').style.display = 'flex';

    /* ── Set platform state ── */
    CT.platform.state.user = user;
    CT.platform.state.role = CT.platform.resolveRole(user);
    var role = CT.platform.state.role;

    /* User name + role badge */
    var nameEl = document.getElementById('ct-user-name');
    if (nameEl) nameEl.textContent = user.full_name || user.email || 'Admin';
    var roleEl = document.getElementById('ct-user-role');
    if (roleEl) {
      var roleDef = CT.platform.ROLES[role];
      roleEl.textContent = roleDef ? roleDef.label : role;
    }

    /* ── Determine initial shell ── */
    var shells   = CT.platform.getShellsForRole(role);
    var hashView = (location.hash || '').replace('#','');

    if (hashView) {
      /* Deep-link: infer shell from the view */
      var viewDef = CT.platform.getView(hashView);
      if (viewDef && shells.indexOf(viewDef.shell) !== -1) {
        CT.platform.state.shell = viewDef.shell;
      } else {
        CT.platform.state.shell = shells[0] || 'bo';
      }
    } else {
      CT.platform.state.shell = shells[0] || 'bo';
    }

    /* ── Build UI ── */
    CT.app.renderShellSwitcher();
    CT.app.renderSidebar();

    /* ── Navigate (support deep-link with drill-down params) ── */
    var hashParams = CT.platform.parseHash();
    if (hashParams && hashParams.view) {
      CT.app.navigate(hashParams.view, hashParams);
    } else {
      var initial = hashView || CT.platform.getDefaultView(CT.platform.state.shell, role) || 'dashboard';
      CT.app.navigate(initial);
    }
  },

  showLogin: function() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('bo-app').style.display = 'none';
  },

  logout: async function() {
    try { await CT.api.logout(); } catch(_) {}
    localStorage.removeItem('kmrc_logged_in');
    CT.platform.state.user = null;
    CT.platform.state.role = 'founder';
    CT.app.showLogin();
  },

  /* ══════════════════════════════════════════════════════════════
     SHELL SWITCHER
     ══════════════════════════════════════════════════════════════ */
  renderShellSwitcher: function() {
    var el = document.getElementById('ct-shell-switcher');
    if (!el) return;

    var role   = CT.platform.state.role;
    var shells = CT.platform.getShellsForRole(role);

    /* Single-shell user → no switcher */
    if (shells.length <= 1) {
      el.style.display = 'none';
      CT.app._updateShellChrome();
      return;
    }

    el.style.display = '';
    el.innerHTML = shells.map(function(sid) {
      var s = CT.platform.SHELLS[sid];
      var active = sid === CT.platform.state.shell ? ' active' : '';
      return '<button class="ct-shell-tab' + active + '" data-shell="' + sid + '">' +
               '<span class="ct-shell-emoji">' + s.emoji + '</span> ' +
               '<span class="ct-shell-label">' + s.shortLabel + '</span>' +
             '</button>';
    }).join('');

    CT.app._updateShellChrome();
  },

  /* Update sidebar accent + title to match active shell */
  _updateShellChrome: function() {
    var sidebar = document.querySelector('.ct-sidebar');
    if (sidebar) sidebar.setAttribute('data-shell', CT.platform.state.shell);

    var titleEl = document.getElementById('ct-shell-title');
    if (titleEl) {
      var s = CT.platform.SHELLS[CT.platform.state.shell];
      titleEl.textContent = s.emoji + ' ' + s.label;
    }

    /* Shell description */
    var descEl = document.getElementById('ct-shell-desc');
    if (descEl) {
      var s2 = CT.platform.SHELLS[CT.platform.state.shell];
      descEl.textContent = s2.description;
    }
  },

  /* ══════════════════════════════════════════════════════════════
     SIDEBAR
     ══════════════════════════════════════════════════════════════ */
  renderSidebar: function() {
    var nav = document.getElementById('ct-sidebar-nav');
    if (!nav) return;

    var shell    = CT.platform.state.shell;
    var role     = CT.platform.state.role;
    var sections = CT.platform.getSectionsForShell(shell, role);
    var views    = CT.platform.getSidebarViewsForShell(shell, role);

    /* Group views by section */
    var bySection = {};
    views.forEach(function(v) {
      if (!bySection[v.section]) bySection[v.section] = [];
      bySection[v.section].push(v);
    });

    var html = '';
    sections.forEach(function(sec) {
      var list = bySection[sec.id];
      if (!list || !list.length) return;

      // Cleanup avril 2026 : la section "expert" / "expert_ct" est pli\u00e9e par d\u00e9faut.
      // \u00c9tat persist\u00e9 dans localStorage (par section)
      var isExpert = (sec.id === 'expert' || sec.id === 'expert_ct' || sec.collapsed === true);
      if (isExpert) {
        var stored = null;
        try { stored = localStorage.getItem('ct-' + sec.id + '-open'); } catch (_) {}
        var isOpen = (stored === 'true');
        var caret = isOpen ? '\u25BC' : '\u25B6';
        html += '<div class="ct-section-title ct-section-title--collapsible" ' +
                  'data-section-toggle="' + sec.id + '" ' +
                  'role="button" ' +
                  'aria-expanded="' + isOpen + '" ' +
                  'style="cursor:pointer;user-select:none;display:flex;align-items:center;gap:6px;">' +
                  '<span class="ct-section-caret" style="font-size:0.7em;width:12px;display:inline-block;">' + caret + '</span>' +
                  '<span>' + sec.label + '</span>' +
                '</div>';
        html += '<div class="ct-section-body" data-section-body="' + sec.id + '" ' +
                  'style="display:' + (isOpen ? 'block' : 'none') + ';">';
        list.forEach(function(v) {
          var cls = 'ct-nav-item' + (v.id === CT.app.currentView ? ' active' : '');
          html += '<button class="' + cls + '" data-view="' + v.id + '">' +
                    '<span class="ct-nav-emoji">' + v.emoji + '</span>' +
                    '<span class="ct-nav-label">' + v.label + '</span>' +
                  '</button>';
        });
        html += '</div>';
      } else {
        html += '<div class="ct-section-title">' + sec.label + '</div>';
        list.forEach(function(v) {
          var cls = 'ct-nav-item' + (v.id === CT.app.currentView ? ' active' : '');
          html += '<button class="' + cls + '" data-view="' + v.id + '">' +
                    '<span class="ct-nav-emoji">' + v.emoji + '</span>' +
                    '<span class="ct-nav-label">' + v.label + '</span>' +
                  '</button>';
        });
      }
    });

    /* Admin tools — founder/admin only, BO only */
    if (shell === 'bo' && (role === 'founder' || role === 'admin')) {
      html += '<div class="ct-section-title">🔧 Admin</div>';
      html += '<button class="ct-nav-item ct-nav-item-admin" data-action="seed">' +
                '<span class="ct-nav-emoji">🌱</span><span class="ct-nav-label">Seed test</span></button>';
      html += '<button class="ct-nav-item ct-nav-item-admin" data-action="reset">' +
                '<span class="ct-nav-emoji">🧹</span><span class="ct-nav-label">Reset tout</span></button>';
    }

    nav.innerHTML = html;

    if (shell === 'ct' && CT.platform.canAccess('pricing', role) && !nav.querySelector('[data-view="pricing"]')) {
      var pricing = CT.platform.getView('pricing');
      if (pricing) {
        var btnHtml = '<button class="ct-nav-item' + (pricing.id === CT.app.currentView ? ' active' : '') + '" data-view="' + pricing.id + '">' +
                        '<span class="ct-nav-emoji">' + pricing.emoji + '</span>' +
                        '<span class="ct-nav-label">' + pricing.label + '</span>' +
                      '</button>';
        nav.insertAdjacentHTML('beforeend', '<div class="ct-section-title">🏷️ Atelier Prix & Sourcing</div>' + btnHtml);
      }
    }

    /* ── Inject signal badges (async, non-blocking) ── */
    if (shell === 'bo') {
      CT.app._injectSignalBadges();
    }
  },

  /* Fetch signal counts per target_view and inject badges into sidebar */
  _injectSignalBadges: function() {
    if (!CT.api || !CT.api.signalsList) return;
    CT.api.signalsList({ limit: 200 }).then(function(data) {
      var signals = data.signals || [];
      /* Count by target_view, only open+critical/urgent */
      var counts = {};
      signals.forEach(function(s) {
        if (!s.target_view) return;
        if (!counts[s.target_view]) counts[s.target_view] = { total: 0, urgent: 0 };
        counts[s.target_view].total++;
        if (s.severity === 'urgent' || s.severity === 'critical') counts[s.target_view].urgent++;
      });
      /* Inject into sidebar nav items */
      Object.keys(counts).forEach(function(viewId) {
        var btn = document.querySelector('#ct-sidebar-nav [data-view="' + viewId + '"]');
        if (!btn) return;
        var c = counts[viewId];
        var color = c.urgent > 0 ? '#ef4444' : '#f59e0b';
        var badge = document.createElement('span');
        badge.className = 'ct-signal-badge';
        badge.style.cssText = 'margin-left:auto;background:' + color + ';color:white;font-size:11px;' +
          'font-weight:700;padding:1px 7px;border-radius:10px;min-width:20px;text-align:center';
        badge.textContent = c.total;
        btn.appendChild(badge);
      });
    }).catch(function() { /* silent */ });
  },

  /* ══════════════════════════════════════════════════════════════
     NAVIGATION
     ══════════════════════════════════════════════════════════════ */
  navigate: function(view, params) {
    var role = CT.platform.state.role;

    /* ── Auto-switch shell if view belongs to the other shell ── */
    var viewDef = CT.platform.VIEWS.find(function(v) { return v.id === view; });
    if (viewDef && viewDef.shell !== CT.platform.state.shell) {
      CT.platform.state.shell = viewDef.shell;
      CT.app.renderShellSwitch();
      CT.app.renderSidebar();
    }

    /* ── Access check ── */
    if (!CT.platform.canAccess(view, role)) {
      var m = document.getElementById('ct-main');
      if (m) m.innerHTML =
        '<div class="ct-error">' +
          '<div style="font-size:48px;margin-bottom:12px">🔒</div>' +
          '<h3>Accès non autorisé</h3>' +
          '<p style="margin-top:8px;color:#64748b">Vous n\'avez pas la permission d\'accéder à cette vue.</p>' +
        '</div>';
      return;
    }

    /* ── Auto-switch shell if view belongs to the other shell ── */
    var viewShell = CT.platform.shellForView(view);
    if (viewShell && viewShell !== CT.platform.state.shell) {
      CT.platform.state.shell = viewShell;
      CT.app.renderShellSwitcher();
      CT.app.renderSidebar();
    }

    /* ── Save context (Phase 2 drill-down) ── */
    CT.app.drillDownCtx = params || null;
    CT.app.currentView = view;

    /* ── Sidebar active state ── */
    document.querySelectorAll('#ct-sidebar-nav .ct-nav-item').forEach(function(el) {
      el.classList.toggle('active', el.dataset.view === view);
    });

    /* ── Render ── */
    var main   = document.getElementById('ct-main');
    var viewFn = CT.app._resolveViewFn(view);

    if (viewFn) {
      viewFn(main);
      if (history && history.replaceState) {
        history.replaceState(null, '', '#' + view);
      }
    } else {
      main.innerHTML =
        '<div class="ct-empty-state">' +
          '<div style="font-size:48px;margin-bottom:16px">🚧</div>' +
          '<h3>Vue en construction</h3>' +
          '<p style="color:#94a3b8;margin-top:8px">' + view + ' — bientôt disponible</p>' +
        '</div>';
      if (history && history.replaceState) {
        history.replaceState(null, '', '#' + view);
      }
    }
  },

  /* Map view IDs → render functions
     Convention: registry id === CT.views[id] function name.
     Legacy aliases kept for backward compatibility. */
  _resolveViewFn: function(view) {
    if (!CT.views) return null;
    /* Direct match (covers 95% of cases) */
    if (typeof CT.views[view] === 'function') return CT.views[view];
    /* Legacy aliases — old hash URLs still work */
    var legacy = {
      'action-center': 'actionCenter',
      'parcels': 'orders',                       // parcels was merged into orders
      'parcel_reconciliation': 'reconciliation', // ADR-007 : renommé pour clarifier (colis vs cash)
      'finances': 'finances'                     // ADR-007 : retiré du menu mais URL legacy fonctionne
    };
    var mapped = legacy[view];
    if (mapped && typeof CT.views[mapped] === 'function') return CT.views[mapped];
    return null;
  },

  /* ══════════════════════════════════════════════════════════════
     SEED / RESET (admin tools)
     ══════════════════════════════════════════════════════════════ */
  doSeed: async function() {
    if (!confirm('🌱 Injecter les données de test ?\nCela créera 20 commandes + 13 colis + scans + incidents + factures.')) return;
    var main = document.getElementById('ct-main');
    main.innerHTML = '<div class="ct-loading">🌱 Injection des données de test...</div>';
    try {
      var result = await CT.api.seedTest();
      alert('✅ ' + result.message);
      CT.app.navigate(CT.app.currentView);
    } catch (err) {
      alert('❌ Seed: ' + err.message);
      CT.app.navigate(CT.app.currentView);
    }
  },

  doReset: async function() {
    if (!confirm('🧹 SUPPRIMER toutes les commandes, colis, scans, incidents ?\n\nCette action est irréversible !')) return;
    if (!confirm('⚠️ VRAIMENT supprimer ? Dernière chance !')) return;
    var main = document.getElementById('ct-main');
    main.innerHTML = '<div class="ct-loading">🧹 Suppression en cours...</div>';
    try {
      var result = await CT.api.resetAll('orders');
      alert('✅ ' + result.message);
      CT.app.navigate(CT.app.currentView);
    } catch (err) {
      alert('❌ Reset: ' + err.message);
      CT.app.navigate(CT.app.currentView);
    }
  }
};

/* Auto-init */
document.addEventListener('DOMContentLoaded', function() {
  CT.app.init();
});
