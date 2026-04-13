/* ===================================================================
   Komerce Control Tower — ct-notifications.js
   Smart polling notification system:
   - 🔔 Bell icon with badge counter
   - 📳 Vibration on mobile
   - ✨ Pulse animation on bell
   - 📑 Tab title flash
   - 📱 Browser push notifications
   =================================================================== */
window.CT = window.CT || {};

CT.notifications = {
  items: [],           // Notification items [{id, icon, text, time, read}]
  maxItems: 50,        // Max notifications to keep
  pollInterval: 30000, // 30 seconds
  _timer: null,
  _lastState: null,
  _tabFlashTimer: null,
  _originalTitle: document.title,
  _unread: 0,

  /* ---------------------------------------------------------------
     Initialize the notification system
     --------------------------------------------------------------- */
  init: function() {
    // Load stored notifications
    try {
      var stored = localStorage.getItem('ct_notifications');
      if (stored) this.items = JSON.parse(stored);
      var storedState = localStorage.getItem('ct_last_state');
      if (storedState) this._lastState = JSON.parse(storedState);
    } catch(e) {}

    this._updateBell();
    this._startPolling();
    this._requestPermission();
  },

  /* ---------------------------------------------------------------
     Start polling for changes
     --------------------------------------------------------------- */
  _startPolling: function() {
    var self = this;
    // Initial check after 3s (let dashboard load first)
    setTimeout(function() { self._poll(); }, 3000);
    this._timer = setInterval(function() { self._poll(); }, this.pollInterval);
  },

  stop: function() {
    if (this._timer) clearInterval(this._timer);
    this._stopTabFlash();
  },

  /* ---------------------------------------------------------------
     Poll API and detect changes
     --------------------------------------------------------------- */
  _poll: async function() {
    try {
      var ops = await CT.api.dashboard('ops');
      var newState = {
        commandes_en_cours: (ops.activite || {}).commandes_en_cours || 0,
        commandes_bloquees: (ops.activite || {}).commandes_bloquees || 0,
        livrees_aujourd_hui: (ops.activite || {}).livrees_aujourd_hui || 0,
        cash_pending: (ops.alertes || {}).cash_pending || 0,
        anomalies: (ops.alertes || {}).anomalies || 0,
        low_stock: (ops.alertes || {}).low_stock || 0,
        sla_late: (ops.sla || {}).late || 0,
        sla_blocked: (ops.sla || {}).blocked || 0,
        ts: Date.now()
      };

      if (this._lastState) {
        this._detectChanges(this._lastState, newState);
      }

      this._lastState = newState;
      localStorage.setItem('ct_last_state', JSON.stringify(newState));
    } catch(e) {
      // Silently fail — don't spam errors
    }
  },

  /* ---------------------------------------------------------------
     Detect changes between old and new state
     --------------------------------------------------------------- */
  _detectChanges: function(oldS, newS) {
    var alerts = [];

    // New orders
    if (newS.commandes_en_cours > oldS.commandes_en_cours) {
      var diff = newS.commandes_en_cours - oldS.commandes_en_cours;
      alerts.push({ icon: '🛒', text: diff + ' nouvelle' + (diff > 1 ? 's' : '') + ' commande' + (diff > 1 ? 's' : ''), level: 'info' });
    }

    // Newly blocked
    if (newS.commandes_bloquees > oldS.commandes_bloquees) {
      var diff = newS.commandes_bloquees - oldS.commandes_bloquees;
      alerts.push({ icon: '⛔', text: diff + ' commande' + (diff > 1 ? 's' : '') + ' bloquée' + (diff > 1 ? 's' : ''), level: 'danger' });
    }

    // New deliveries
    if (newS.livrees_aujourd_hui > oldS.livrees_aujourd_hui) {
      var diff = newS.livrees_aujourd_hui - oldS.livrees_aujourd_hui;
      alerts.push({ icon: '✅', text: diff + ' commande' + (diff > 1 ? 's' : '') + ' livrée' + (diff > 1 ? 's' : ''), level: 'success' });
    }

    // Cash pending increase
    if (newS.cash_pending > oldS.cash_pending) {
      var diff = newS.cash_pending - oldS.cash_pending;
      alerts.push({ icon: '💰', text: diff + ' paiement' + (diff > 1 ? 's' : '') + ' cash en attente', level: 'warning' });
    }

    // New anomalies
    if (newS.anomalies > oldS.anomalies) {
      var diff = newS.anomalies - oldS.anomalies;
      alerts.push({ icon: '⚠️', text: diff + ' anomalie' + (diff > 1 ? 's' : '') + ' détectée' + (diff > 1 ? 's' : ''), level: 'danger' });
    }

    // SLA late increase
    if (newS.sla_late > oldS.sla_late) {
      var diff = newS.sla_late - oldS.sla_late;
      alerts.push({ icon: '⏰', text: diff + ' retard' + (diff > 1 ? 's' : '') + ' SLA', level: 'danger' });
    }

    // Low stock
    if (newS.low_stock > oldS.low_stock) {
      alerts.push({ icon: '📦', text: 'Stock bas détecté', level: 'warning' });
    }

    // Push all detected changes
    alerts.forEach(function(a) {
      this._push(a.icon, a.text, a.level);
    }.bind(this));
  },

  /* ---------------------------------------------------------------
     Push a notification
     --------------------------------------------------------------- */
  _push: function(icon, text, level) {
    var notif = {
      id: 'n_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      icon: icon,
      text: text,
      level: level || 'info',
      time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      read: false
    };

    this.items.unshift(notif);
    if (this.items.length > this.maxItems) this.items.pop();
    this._unread++;

    // Save
    localStorage.setItem('ct_notifications', JSON.stringify(this.items));

    // UI effects
    this._updateBell();
    this._pulsebell();
    this._vibrate();
    this._flashTab();
    this._browserNotify(icon + ' ' + text);

    // Toast
    if (CT.bus) CT.bus.emit('toast', icon + ' ' + text, level === 'danger' ? 'error' : 'success');
  },

  /* ---------------------------------------------------------------
     Update bell badge
     --------------------------------------------------------------- */
  _updateBell: function() {
    this._unread = this.items.filter(function(n) { return !n.read; }).length;
    var badge = document.getElementById('notif-badge');
    if (badge) {
      if (this._unread > 0) {
        badge.textContent = this._unread > 99 ? '99+' : this._unread;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }
  },

  /* ---------------------------------------------------------------
     Pulse bell animation
     --------------------------------------------------------------- */
  _pulsebell: function() {
    var bell = document.getElementById('notif-bell');
    if (!bell) return;
    bell.classList.add('ct-bell-pulse');
    setTimeout(function() { bell.classList.remove('ct-bell-pulse'); }, 2000);
  },

  /* ---------------------------------------------------------------
     Vibration (mobile)
     --------------------------------------------------------------- */
  _vibrate: function() {
    if (navigator.vibrate) {
      navigator.vibrate([100, 50, 100]);
    }
  },

  /* ---------------------------------------------------------------
     Tab title flash
     --------------------------------------------------------------- */
  _flashTab: function() {
    var self = this;
    if (this._tabFlashTimer) return; // Already flashing
    var flash = true;
    this._tabFlashTimer = setInterval(function() {
      document.title = flash
        ? '🔴 (' + self._unread + ') Nouvelle alerte!'
        : self._originalTitle;
      flash = !flash;
    }, 1500);
    // Stop after 30s
    setTimeout(function() { self._stopTabFlash(); }, 30000);
  },

  _stopTabFlash: function() {
    if (this._tabFlashTimer) {
      clearInterval(this._tabFlashTimer);
      this._tabFlashTimer = null;
      document.title = this._originalTitle;
    }
  },

  /* ---------------------------------------------------------------
     Browser push notifications
     --------------------------------------------------------------- */
  _requestPermission: function() {
    if ('Notification' in window && Notification.permission === 'default') {
      // Will be requested on first interaction
    }
  },

  requestPermission: function() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  },

  _browserNotify: function(text) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Komerce CT', {
          body: text,
          icon: '/images/avatar_panier.png',
          badge: '/images/avatar_panier.png',
          tag: 'komerce-alert',
          renotify: true,
          silent: false
        });
      } catch(e) {}
    }
  },

  /* ---------------------------------------------------------------
     Toggle dropdown
     --------------------------------------------------------------- */
  toggle: function() {
    var dropdown = document.getElementById('notif-dropdown');
    if (!dropdown) return;
    var isOpen = dropdown.style.display === 'block';
    dropdown.style.display = isOpen ? 'none' : 'block';

    if (!isOpen) {
      this._renderDropdown();
      // Mark all as read
      this.items.forEach(function(n) { n.read = true; });
      localStorage.setItem('ct_notifications', JSON.stringify(this.items));
      this._unread = 0;
      this._updateBell();
      this._stopTabFlash();

      // Request browser notification permission on first open
      this.requestPermission();
    }
  },

  /* ---------------------------------------------------------------
     Render dropdown content
     --------------------------------------------------------------- */
  _renderDropdown: function() {
    var dropdown = document.getElementById('notif-dropdown');
    if (!dropdown) return;

    if (this.items.length === 0) {
      dropdown.innerHTML = '<div class="ct-notif-empty">🔔 Aucune notification</div>';
      return;
    }

    var html = '<div class="ct-notif-header">';
    html += '<span>Notifications</span>';
    html += '<button onclick="CT.notifications.clear()" class="ct-notif-clear">Effacer</button>';
    html += '</div>';
    html += '<div class="ct-notif-list">';
    this.items.slice(0, 20).forEach(function(n) {
      var levelCls = n.level === 'danger' ? 'ct-notif-danger' : (n.level === 'warning' ? 'ct-notif-warning' : (n.level === 'success' ? 'ct-notif-success' : ''));
      html += '<div class="ct-notif-item ' + levelCls + (n.read ? '' : ' ct-notif-unread') + '">';
      html += '<span class="ct-notif-icon">' + n.icon + '</span>';
      html += '<span class="ct-notif-text">' + n.text + '</span>';
      html += '<span class="ct-notif-time">' + n.time + '</span>';
      html += '</div>';
    });
    html += '</div>';
    dropdown.innerHTML = html;
  },

  /* ---------------------------------------------------------------
     Clear all notifications
     --------------------------------------------------------------- */
  clear: function() {
    this.items = [];
    this._unread = 0;
    localStorage.removeItem('ct_notifications');
    this._updateBell();
    this._renderDropdown();
  }
};
