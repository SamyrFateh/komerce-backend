/* ===================================================================
   Komerce Control Tower — ct-app-v7.js
   Router principal + Sidebar + Seed/Reset
   + vue Transitaire
   =================================================================== */
window.CT = window.CT || {};

CT.app = {
  currentView: 'dashboard',

  // ── Init ────────────────────────────────────────────────────
  init: function() {
    var loginForm = document.getElementById('ct-login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', function(e) {
        e.preventDefault();
        CT.app.login();
      });
    }

    // Construire la sidebar si le conteneur existe
    CT.app.buildSidebar();

    // Check if already logged in
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

  // ── Sidebar ────────────────────────────────────────────────
  buildSidebar: function() {
    var nav = document.getElementById('ct-sidebar');
    if (!nav) return;

    var items = [
      { id: 'dashboard',      emoji: '🎯', label: 'Dashboard' },
      { id: 'orders',         emoji: '📋', label: 'Commandes & Colis' },
      { id: 'parcels',        emoji: '📦', label: 'Tous les colis' },
      { id: 'hub',            emoji: '🏭', label: 'Hub' },
      { id: 'transitaire',    emoji: '🚢', label: 'Transitaire' },
      { id: 'relais',         emoji: '📍', label: 'Relais' },
      { id: 'finances',       emoji: '💰', label: 'Finances' },
      { id: 'invoices',       emoji: '🧾', label: 'Factures' },
      { id: 'alerts',         emoji: '⚡', label: 'Alertes' },
      { id: 'incidents',      emoji: '🚨', label: 'Incidents' },
      { id: 'reconciliation', emoji: '⚖️', label: 'Réconciliation' },
      { id: 'simulator',      emoji: '🤖', label: 'Simulateur' }
    ];

    nav.innerHTML = items.map(function(item) {
      return (
        '<button class="ct-nav-item" data-view="' + item.id + '" onclick="CT.app.navigate(\'' + item.id + '\')">' +
          '<span class="ct-nav-emoji">' + item.emoji + '</span>' +
          '<span class="ct-nav-label">' + item.label + '</span>' +
        '</button>'
      );
    }).join('');
  },

  // ── Login ───────────────────────────────────────────────────
  login: async function() {
    var email = document.getElementById('ct-email').value;
    var pass = document.getElementById('ct-password').value;
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
    var nameEl = document.getElementById('ct-user-name');
    if (nameEl) nameEl.textContent = user.full_name || user.email || 'Admin';

    // Hash deep-link si présent, sinon dashboard
    var initialView = (location.hash || '').replace('#', '') || 'dashboard';
    CT.app.navigate(initialView);
  },

  showLogin: function() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('bo-app').style.display = 'none';
  },

  logout: async function() {
    try { await CT.api.logout(); } catch(_) {}
    localStorage.removeItem('kmrc_logged_in');
    CT.app.showLogin();
  },

  // ── Navigation ──────────────────────────────────────────────
  navigate: function(view) {
    CT.app.currentView = view;

    // Update sidebar active state
    document.querySelectorAll('.ct-nav-item').forEach(function(item) {
      item.classList.toggle('active', item.dataset.view === view);
    });

    // Render view
    var main = document.getElementById('ct-main');
    var viewFn = {
      'dashboard':      CT.views.dashboard,
      'orders':         CT.views.orders,
      'parcels':        CT.views.parcels,
      'finances':       CT.views.finances,
      'invoices':       CT.views.invoices,
      'alerts':         CT.views.alerts,
      'incidents':      CT.views.incidents,
      'reconciliation': CT.views.reconciliation,
      'hub':            CT.views.hub,
      'transitaire':    CT.views.transitaire,
      'relais':         CT.views.relais,
      'simulator':      CT.views.simulator,
      'settings':       CT.views.settings,
      'previsions':     CT.views.previsions,
      'inventory':      CT.views.inventory
    }[view];

    if (viewFn) {
      viewFn(main);
      if (history && history.replaceState) {
        history.replaceState(null, '', '#' + view);
      }
    } else {
      main.innerHTML = '<div class="ct-error">Vue inconnue: ' + view + '</div>';
    }
  },

  // ── Seed / Reset ────────────────────────────────────────────
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

// Auto-init
document.addEventListener('DOMContentLoaded', function() {
  CT.app.init();
});