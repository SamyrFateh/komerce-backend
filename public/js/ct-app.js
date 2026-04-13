/* ===================================================================
   Komerce Control Tower — ct-app.js
   Main application: router, sidebar, init, login, auto-login.
   =================================================================== */
window.CT = window.CT || {};

CT.currentView = null;

CT.SIDEBAR_ITEMS = [
  { id: 'overview',  view: 'overview' },
  { id: 'pipeline',  view: 'pipeline' },
  { id: 'finance',   view: 'finance' },
  { id: 'relais',    view: 'relais' },
  { id: 'clients',   view: 'clients' },
  { id: 'retards',   view: 'retards' },
  { id: 'scenarios', view: 'scenarios' }
];

/**
 * Navigate to a view by ID.
 */
CT.navigate = function(viewId) {
  var view = CT.views[viewId];
  if (!view) return;
  CT.currentView = viewId;

  // Update sidebar active state
  document.querySelectorAll('.ct-nav-item').forEach(function(el) {
    el.classList.toggle('active', el.dataset.view === viewId);
  });

  // Update page title
  document.getElementById('page-title').textContent = view.label;

  // Load view into content area
  var content = document.getElementById('content-area');
  view.load(content);

  // Update URL hash
  history.replaceState(null, '', '#' + viewId);

  // Update last refresh time
  document.getElementById('last-refresh').textContent = new Date().toLocaleTimeString('fr-FR');

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');
};

/**
 * Initialize the application shell (sidebar, event handlers).
 */
CT.init = function() {
  // Build sidebar navigation
  var nav = document.getElementById('sidebar-nav');
  nav.innerHTML = CT.SIDEBAR_ITEMS.map(function(item) {
    var view = CT.views[item.view];
    if (!view) return '';
    return '<div class="ct-nav-item" data-view="' + item.id + '">' +
           view.icon + ' ' + view.label +
           '</div>';
  }).join('');

  // Sidebar click handlers
  nav.querySelectorAll('.ct-nav-item').forEach(function(el) {
    el.addEventListener('click', function() {
      CT.navigate(el.dataset.view);
    });
  });

  // Refresh button
  document.getElementById('btn-refresh').addEventListener('click', function() {
    if (CT.currentView) CT.navigate(CT.currentView);
  });

  // Logout
  document.getElementById('btn-logout').addEventListener('click', async function() {
    try { await CT.api.logout(); } catch(e) { /* ignore */ }
    localStorage.removeItem('kmrc_logged_in');
    document.getElementById('app-shell').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
  });

  // Mobile menu toggle
  document.getElementById('menu-toggle').addEventListener('click', function() {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Navigate to hash or default
  var hash = location.hash.slice(1);
  CT.navigate(hash && CT.views[hash] ? hash : 'overview');
};

/**
 * Show the app shell and hide the login screen.
 */
CT._showApp = function(user) {
  localStorage.setItem('kmrc_logged_in', '1');
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'flex';
  if (user) {
    document.getElementById('user-info').textContent = user.full_name || user.email || '';
  }
  CT.init();
};

/**
 * Show the login screen.
 */
CT._showLogin = function() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-shell').style.display = 'none';
};

/* ---------------------------------------------------------------
   Login Form Handler
   --------------------------------------------------------------- */
document.getElementById('login-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  var email = document.getElementById('login-email').value;
  var pass = document.getElementById('login-pass').value;
  var errEl = document.getElementById('login-error');
  var btn = this.querySelector('button[type="submit"]');
  errEl.hidden = true;
  btn.textContent = '⏳ Connexion...';
  btn.disabled = true;

  try {
    var data = await CT.api.login(email, pass);
    CT._showApp(data.user || data);
  } catch (e) {
    errEl.textContent = e.message || 'Erreur de connexion';
    errEl.hidden = false;
  }

  btn.textContent = 'Se connecter';
  btn.disabled = false;
});

/* ---------------------------------------------------------------
   Auto-login Check
   --------------------------------------------------------------- */
(async function() {
  // Only try auto-login if we previously logged in
  if (!localStorage.getItem('kmrc_logged_in')) {
    CT._showLogin();
    return;
  }
  try {
    var user = await CT.api.me();
    if (user && user.id) {
      CT._showApp(user);
    } else {
      CT._showLogin();
    }
  } catch (e) {
    localStorage.removeItem('kmrc_logged_in');
    CT._showLogin();
  }
})();
