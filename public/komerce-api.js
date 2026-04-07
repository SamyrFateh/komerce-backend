/* ═══════════════════════════════════════════════════════════════
   KOMERCE — API Unifiée v1.0
   Couche unique pour tous les écrans (Hub, Pipeline, Relais, Dashboard, Admin)
   
   Usage :
     <script src="komerce-api.js"></script>
     await K.auth.login('email', 'password');
     const parcels = await K.parcels.list({ status: 'draft' });
   ═══════════════════════════════════════════════════════════════ */

const K = (() => {
  'use strict';

  // ── STATE ──────────────────────────────────────────────────
  const _state = {
    api: localStorage.getItem('komerce_api_url') || '',
    token: localStorage.getItem('komerce_token') || '',
    user: null,
  };

  // ── RATE LIMITER ───────────────────────────────────────────
  const _rl = {
    queue: [],
    active: 0,
    MAX_CONC: 2,
    MIN_DELAY_MS: 150,
    lastStart: 0,
  };

  function _drainQueue() {
    if (_rl.active >= _rl.MAX_CONC || _rl.queue.length === 0) return;
    const item = _rl.queue.shift();
    _rl.active++;

    const now = Date.now();
    const wait = Math.max(0, _rl.MIN_DELAY_MS - (now - _rl.lastStart));
    _rl.lastStart = now + wait;

    setTimeout(async () => {
      try {
        const result = await _doFetch(item.path, item.method, item.body, item.retries);
        item.resolve(result);
      } catch (e) {
        item.reject(e);
      } finally {
        _rl.active--;
        setTimeout(_drainQueue, 0);
      }
    }, wait);
  }

  async function _doFetch(path, method, body, maxRetries) {
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(_state.token ? { Authorization: `Bearer ${_state.token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    };

    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(_state.api + path, opts);

        // Retry on rate limit / transient errors
        if ((res.status === 429 || res.status === 503 || res.status === 502) && attempt < maxRetries) {
          const backoff = Math.pow(2, attempt) * 800;
          await _sleep(backoff);
          continue;
        }

        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        return json;

      } catch (e) {
        lastErr = e;
        if (attempt < maxRetries) {
          await _sleep(400 * (attempt + 1));
        }
      }
    }
    throw lastErr;
  }

  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── CORE REQUEST ───────────────────────────────────────────
  function request(path, method = 'GET', body = null, retries = 2) {
    if (!_state.api && path !== '/api/health') {
      return Promise.reject(new Error('API non configurée — connectez-vous d\'abord'));
    }
    return new Promise((resolve, reject) => {
      _rl.queue.push({ path, method, body, retries, resolve, reject });
      _drainQueue();
    });
  }

  // ── AUTH ────────────────────────────────────────────────────
  const auth = {
    async login(email, password, apiUrl) {
      if (apiUrl) {
        _state.api = apiUrl.replace(/\/$/, '');
        localStorage.setItem('komerce_api_url', _state.api);
      }
      const health = await request('/api/health');
      const data = await request('/api/auth/login', 'POST', { email, password });
      _state.token = data.token;
      _state.user = data.user;
      localStorage.setItem('komerce_token', data.token);
      return { user: data.user, health };
    },

    logout() {
      _state.token = '';
      _state.user = null;
      localStorage.removeItem('komerce_token');
    },

    getUser() { return _state.user; },
    getToken() { return _state.token; },
    isConnected() { return !!_state.token; },

    setUrl(url) {
      _state.api = url.replace(/\/$/, '');
      localStorage.setItem('komerce_api_url', _state.api);
    },
  };

  // ── PARCELS ────────────────────────────────────────────────
  const parcels = {
    list(filters = {}) {
      const qs = new URLSearchParams(filters).toString();
      return request('/api/parcels' + (qs ? '?' + qs : ''));
    },
    get(id) { return request(`/api/parcels/${id}`); },
    create(data) { return request('/api/parcels', 'POST', data); },
    update(id, data) { return request(`/api/parcels/${id}`, 'PUT', data); },
    addItem(parcelId, data) { return request(`/api/parcels/${parcelId}/items`, 'POST', data); },
    stats() { return request('/api/parcels/stats'); },
  };

  // ── HUB ────────────────────────────────────────────────────
  const hub = {
    scanItem(barcode, scannedBy) {
      return request('/api/scans/hub/scan-item', 'POST', { barcode, scanned_by: scannedBy });
    },
    pack(parcelId) {
      return request('/api/scans/hub/pack', 'POST', { parcel_id: parcelId });
    },
    seal(parcelId) {
      return request('/api/scans/hub/seal', 'POST', { parcel_id: parcelId });
    },
    getDraftParcels() {
      return request('/api/parcels?status=draft');
    },
  };

  // ── SCANS ──────────────────────────────────────────────────
  const scans = {
    create(data) { return request('/api/scans', 'POST', data); },
    list(filters = {}) {
      const qs = new URLSearchParams(filters).toString();
      return request('/api/scans' + (qs ? '?' + qs : ''));
    },
  };

  // ── ORDERS ─────────────────────────────────────────────────
  const orders = {
    list(filters = {}) {
      const qs = new URLSearchParams(filters).toString();
      return request('/api/orders' + (qs ? '?' + qs : ''));
    },
    get(id) { return request(`/api/orders/${id}`); },
    stats() { return request('/api/orders/stats'); },
  };

  // ── LOGISTICS ──────────────────────────────────────────────
  const logistics = {
    shipments: {
      list(filters = {}) {
        const qs = new URLSearchParams(filters).toString();
        return request('/api/logistics/shipments' + (qs ? '?' + qs : ''));
      },
      get(id) { return request(`/api/logistics/shipments/${id}`); },
      create(data) { return request('/api/logistics/shipments', 'POST', data); },
    },
    containers: {
      list() { return request('/api/logistics/containers'); },
    },
  };

  // ── CARRIERS ───────────────────────────────────────────────
  const carriers = {
    list() { return request('/api/carriers'); },
    get(id) { return request(`/api/carriers/${id}`); },
    create(data) { return request('/api/carriers', 'POST', data); },
    update(id, data) { return request(`/api/carriers/${id}`, 'PUT', data); },
  };

  // ── PRODUCTS ───────────────────────────────────────────────
  const products = {
    list(filters = {}) {
      const qs = new URLSearchParams(filters).toString();
      return request('/api/products' + (qs ? '?' + qs : ''));
    },
    get(id) { return request(`/api/products/${id}`); },
  };

  // ── PURCHASING ─────────────────────────────────────────────
  const purchasing = {
    suppliers: {
      list() { return request('/api/purchasing/suppliers'); },
      get(id) { return request(`/api/purchasing/suppliers/${id}`); },
    },
    orders: {
      list(filters = {}) {
        const qs = new URLSearchParams(filters).toString();
        return request('/api/purchasing/orders' + (qs ? '?' + qs : ''));
      },
    },
  };

  // ── UI HELPERS (partagés entre tous les écrans) ────────────
  const ui = {
    // Status → badge
    PARCEL_STATUS: {
      draft:       { label: 'Brouillon',    badge: 'b-gray'   },
      preparation: { label: 'Préparation',  badge: 'b-purple' },
      shipped:     { label: 'Expédié',      badge: 'b-teal'   },
      in_transit:  { label: 'En transit',   badge: 'b-blue'   },
      arrived:     { label: 'Arrivé',       badge: 'b-gold'   },
      available:   { label: 'Disponible',   badge: 'b-green'  },
      collected:   { label: 'Remis',        badge: 'b-green'  },
      cancelled:   { label: 'Annulé',       badge: 'b-red'    },
    },

    badge(status, map) {
      const m = map || ui.PARCEL_STATUS;
      const s = m[status] || { label: status, badge: 'b-gray' };
      return `<span class="badge ${s.badge}">${s.label}</span>`;
    },

    toast(msg, type = 'ok') {
      let t = document.getElementById('k-toast');
      if (!t) {
        t = document.createElement('div');
        t.id = 'k-toast';
        t.className = 'toast';
        document.body.appendChild(t);
      }
      t.textContent = msg;
      t.className = `toast ${type} show`;
      setTimeout(() => t.classList.remove('show'), 3500);
    },

    flash() {
      const el = document.createElement('div');
      el.className = 'success-flash';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 700);
    },

    fmtDate(d) {
      if (!d) return '—';
      return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    },

    fmtAge(dateStr) {
      if (!dateStr) return '—';
      const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
      if (days === 0) return 'Aujourd\'hui';
      if (days === 1) return '1j';
      return days + 'j';
    },

    ts() {
      return new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    },
  };

  // ── PUBLIC API ─────────────────────────────────────────────
  return {
    request,
    auth,
    parcels,
    hub,
    scans,
    orders,
    logistics,
    carriers,
    products,
    purchasing,
    ui,
  };
})();
