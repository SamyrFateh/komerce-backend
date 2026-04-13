/* ===================================================================
   Komerce Control Tower — ct-app.js v3.0
   Router, sidebar, toast system, init, login.
   =================================================================== */
window.CT = window.CT || {};

CT.currentView = null;

/* ---------------------------------------------------------------
   Sidebar items — 5 dashboards métier + Scénarios
   --------------------------------------------------------------- */
CT.SIDEBAR_ITEMS = [
  { id: 'global',    icon: '🧠', label: 'Global',      section: 'dashboards' },
  { id: 'hub',       icon: '🏭', label: 'Hub Dubaï',    section: 'dashboards' },
  { id: 'transit',   icon: '🚢', label: 'Transit',      section: 'dashboards' },
  { id: 'relais',    icon: '🏝️', label: 'Relais',       section: 'dashboards' },
  { id: 'finance',   icon: '💰', label: 'Finance',      section: 'dashboards' },
  { id: 'scenarios', icon: '🎮', label: 'Scénarios',    section: 'tools' }
];

/* ---------------------------------------------------------------
   Simple event bus for toasts
   --------------------------------------------------------------- */
CT.bus = {
  _handlers: {},
  on: function(event, fn) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(fn);
  },
  emit: function(event) {
    var args = Array.prototype.slice.call(arguments, 1);
    (this._handlers[event] || []).forEach(function(fn) { fn.apply(null, args); });
  }
};

/* Toast system */
CT.bus.on('toast', function(msg, type) {
  var container = document.getElementById('toast-container');
  if (!container) return;
  var toast = document.createElement('div');
  toast.className = 'ct-toast ' + (type || 'success');
  toast.innerHTML = msg;
  container.appendChild(toast);
  setTimeout(function() {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(function() { toast.remove(); }, 300);
  }, 4000);
});

/* ---------------------------------------------------------------
   Navigate to a view
   --------------------------------------------------------------- */
CT.navigate = function(viewId) {
  var view = CT.views[viewId];
  if (!view) return;
  CT.currentView = viewId;

  // Update sidebar active state
  document.querySelectorAll('.ct-nav-item').forEach(function(el) {
    el.classList.toggle('active', el.dataset.view === viewId);
  });

  // Update page title
  document.getElementById('page-title').textContent = view.icon + ' ' + view.label;

  // Load view
  var content = document.getElementById('content-area');
  view.load(content);

  // URL hash
  history.replaceState(null, '', '#' + viewId);

  // Timestamp
  document.getElementById('last-refresh').textContent = new Date().toLocaleTimeString('fr-FR');

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');
};

/* ---------------------------------------------------------------
   Initialize app shell
   --------------------------------------------------------------- */
CT.init = function() {
  // Build sidebar
  var nav = document.getElementById('sidebar-nav');
  var currentSection = '';
  var html = '';
  CT.SIDEBAR_ITEMS.forEach(function(item) {
    var view = CT.views[item.id];
    if (!view) return;
    // Section separator
    if (item.section !== currentSection) {
      if (currentSection) html += '<div class="ct-nav-separator"></div>';
      currentSection = item.section;
    }
    html += '<div class="ct-nav-item" data-view="' + item.id + '">' +
            item.icon + ' ' + item.label +
            '</div>';
  });
  nav.innerHTML = html;

  // Sidebar clicks
  nav.querySelectorAll('.ct-nav-item').forEach(function(el) {
    el.addEventListener('click', function() { CT.navigate(el.dataset.view); });
  });

  // Refresh
  document.getElementById('btn-refresh').addEventListener('click', function() {
    if (CT.currentView) CT.navigate(CT.currentView);
  });

  // Logout
  document.getElementById('btn-logout').addEventListener('click', async function() {
    try { await CT.api.logout(); } catch(e) {}
    localStorage.removeItem('kmrc_logged_in');
    CT.notifications.stop();
    document.getElementById('app-shell').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
  });

  // Mobile menu
  document.getElementById('menu-toggle').addEventListener('click', function() {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Notification bell
  var bell = document.getElementById('notif-bell');
  if (bell) {
    bell.addEventListener('click', function(e) {
      e.stopPropagation();
      CT.notifications.toggle();
    });
  }

  // Close dropdown on outside click
  document.addEventListener('click', function(e) {
    var dropdown = document.getElementById('notif-dropdown');
    if (dropdown && dropdown.style.display === 'block') {
      if (!e.target.closest('#notif-bell') && !e.target.closest('#notif-dropdown')) {
        dropdown.style.display = 'none';
      }
    }
  });

  // Start notifications
  CT.notifications.init();

  // Navigate to hash or default
  var hash = location.hash.slice(1);
  CT.navigate(hash && CT.views[hash] ? hash : 'global');
};

/* ---------------------------------------------------------------
   Show/hide app
   --------------------------------------------------------------- */
CT._showApp = function(user) {
  localStorage.setItem('kmrc_logged_in', '1');
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'flex';
  if (user) {
    var name = user.full_name || user.email || '';
    var role = user.role || '';
    document.getElementById('user-info').textContent = name;
    if (role) document.getElementById('user-info').title = 'Rôle: ' + role;
  }
  CT.init();
};

CT._showLogin = function() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-shell').style.display = 'none';
};

/* ---------------------------------------------------------------
   Login handler
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
   Auto-login
   --------------------------------------------------------------- */
(async function() {
  if (!localStorage.getItem('kmrc_logged_in')) { CT._showLogin(); return; }
  try {
    var user = await CT.api.me();
    if (user && user.id) { CT._showApp(user); } else { CT._showLogin(); }
  } catch (e) {
    localStorage.removeItem('kmrc_logged_in');
    CT._showLogin();
  }
})();
