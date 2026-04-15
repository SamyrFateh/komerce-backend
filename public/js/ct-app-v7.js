/* ===================================================================
   Komerce Control Tower — ct-app-v7.js
   Router principal + Sidebar 3 sections + Seed/Reset
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
    CT.app.navigate('dashboard');
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
      'dashboard': CT.views.dashboard,
      'orders': CT.views.orders,
      'parcels': CT.views.parcels,
      'pending-cash': CT.views.pendingCash,
      'create-parcel': CT.views.createParcel,
      'finances': CT.views.finances,
      'invoices': CT.views.invoices,
      'alerts': CT.views.alerts,
      'incidents': CT.views.incidents,
      'reconciliation': CT.views.reconciliation,
    }[view];

    if (viewFn) {
      viewFn(main);
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
  },
};

// Auto-init
document.addEventListener('DOMContentLoaded', function() { CT.app.init(); });
