/**
 * @komerce-arch
 * @role          boutique-api-client
 * @domain        boutique
 * @layer         api-client
 * @criticality   high
 * @inputs        api_requests, credentials, payloads
 * @outputs       normalized_api_responses, api_errors
 * @depends       backend_api
 * @used-by       boutique.js, public/boutique/index.html, feature_modules
 * @doctrine      api_frontend_unique, credentials_preserved, errors_lisibles
 * @impact-areas  all-boutique-api, checkout, catalog, tracking, shared-cart
 * @version       2026-06
 */
'use strict';

/* ═══════════════════════════════════════════════════════════════
   KOMERCE — API Unifiée v1.1
   Couche unique pour tous les écrans (Hub, Pipeline, Relais, Dashboard, Admin)

   Changelog v1.1 :
   - Auth par cookie httpOnly (credentials: 'include') — plus de Bearer token en JS
   - _state.api défaut = window.location.origin (fonctionne en same-origin Railway)
   - auth.login lit data.user au lieu de data.token
   - auth.logout appelle POST /api/auth/logout + efface flag localStorage
   - auth.restore() → GET /api/auth/me pour retrouver la session depuis le cookie
   - K.parcels.optimize(orderId) → POST /api/parcels/optimize
   - K.parcels.bootstrap(orderId) → POST /api/parcels/bootstrap/:orderId
   ═══════════════════════════════════════════════════════════════ */

window.K = (() => {
  'use strict';

  function normalizeApiUrl(raw) {
    const fallback = (typeof window !== 'undefined' && window.location) ? window.location.origin : '';
    if (!raw) return fallback;

    try {
      const url = new URL(String(raw), fallback || undefined);
      const current = (typeof window !== 'undefined' && window.location) ? window.location : null;
      const isSameOrigin = current && url.origin === current.origin;
      const isLocalDev = current
        && ['localhost', '127.0.0.1'].includes(current.hostname)
        && ['localhost', '127.0.0.1'].includes(url.hostname);

      if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback;
      if (!isSameOrigin && !isLocalDev) return fallback;

      return url.origin;
    } catch (_) {
      return fallback;
    }
  }
  // ── STATE ──────────────────────────────────────────────────
  const _state = {
    // Défaut : même origine (Railway ou localhost)
    // Si l'utilisateur a défini une URL custom, on l'utilise.
    api: normalizeApiUrl(localStorage.getItem('komerce_api_url')),
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
        const result = await _doFetch(item.path, item.method, item.body, item.retries, item.options);
        item.resolve(result);
      } catch (e) {
        item.reject(e);
      } finally {
        _rl.active--;
        setTimeout(_drainQueue, 0);
      }
    }, wait);
  }

  // ── TIMEOUT CENTRAL (FIX 2026-07-10 — chargement infini boutique) ──
  // Deadline GLOBALE par requête (retries + backoffs inclus). Garanties :
  //   1. Aucune requête ne peut rester pendue > timeoutMs → la queue
  //      (_rl, MAX_CONC=2) est TOUJOURS libérée : deux requêtes pendues
  //      ne peuvent plus geler toute la boutique.
  //   2. Les retries sont bornés par la même deadline — ils ne peuvent
  //      pas masquer une erreur au-delà du timeout global.
  //   3. Erreur explicite et lisible : e.isTimeout=true, e.name='TimeoutError'.
  const DEFAULT_TIMEOUT_MS = 10_000;

  function _timeoutError(path, ms) {
    const e = new Error(`Délai dépassé (timeout ${ms}ms) — ${path}`);
    e.name = 'TimeoutError';
    e.isTimeout = true;
    return e;
  }

  async function _doFetch(path, method, body, maxRetries, options) {
    options = options || {};
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;

    // AbortController interne + relais du signal externe éventuel (options.signal)
    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    let timedOut = false;
    let timer = null;
    if (controller) {
      timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      if (options.signal) {
        if (options.signal.aborted) controller.abort();
        else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    const opts = {
      method,
      credentials: 'include',           // Envoie le cookie httpOnly kmrc_jwt
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}
      ),
      ...(body ? { body: JSON.stringify(body) } : {}),
      ...(controller ? { signal: controller.signal } : {}),
    };

    // Course explicite contre la deadline : garantit que la promesse SE RÈGLE
    // même si l'implémentation fetch ignore le signal d'abort. Sans ça, une
    // requête pendue occuperait un slot de la queue pour toujours.
    function _raceDeadline(promise) {
      const remaining = Math.max(0, deadline - Date.now());
      let raceTimer;
      const timeout = new Promise((_, reject) => {
        raceTimer = setTimeout(() => { timedOut = true; if (controller) controller.abort(); reject(_timeoutError(path, timeoutMs)); }, remaining);
      });
      return Promise.race([promise, timeout]).finally(() => clearTimeout(raceTimer));
    }

    try {
      let lastErr;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (Date.now() >= deadline) throw lastErr || _timeoutError(path, timeoutMs);
        try {
          const res = await _raceDeadline(fetch(_state.api + path, opts));

          // Retry on rate limit / transient errors — seulement si la deadline le permet
          if ((res.status === 429 || res.status === 503 || res.status === 502) && attempt < maxRetries) {
            const backoff = Math.pow(2, attempt) * 800;
            if (Date.now() + backoff >= deadline) {
              const json = await _raceDeadline(res.json().catch(() => ({})));
              const err = new Error(json.error || `HTTP ${res.status}`);
              err.status = res.status;
              err.code = json.code || null;
              throw err;
            }
            await _sleep(backoff);
            continue;
          }

          const json = await _raceDeadline(res.json().catch(() => ({})));
          if (!res.ok) {
            const err = new Error(json.error || `HTTP ${res.status}`);
            err.status = res.status;   // permet aux vues de distinguer 401 vs 5xx
            // Correctif V2-B.1 §5 — propage le code métier backend (ex.
            // 'shared_cart_item_already_claimed') jusqu'aux appelants, sans
            // quoi seule err.message (texte) était disponible et aucun
            // gestionnaire ne pouvait distinguer un conflit de réclamation
            // d'une autre erreur 409/400.
            err.code = json.code || null;
            throw err;
          }
          return json;

        } catch (e) {
          // Abort déclenché par notre timer → erreur timeout lisible, pas de retry
          if (timedOut || (e && e.name === 'AbortError' && Date.now() >= deadline)) {
            throw _timeoutError(path, timeoutMs);
          }
          // Abort externe (options.signal) → propager tel quel, pas de retry
          if (e && e.name === 'AbortError') throw e;
          lastErr = e;
          if (attempt < maxRetries && Date.now() + 400 * (attempt + 1) < deadline) {
            await _sleep(400 * (attempt + 1));
          } else if (attempt < maxRetries) {
            break; // plus de budget temps pour un retry
          }
        }
      }
      throw lastErr || _timeoutError(path, timeoutMs);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── CORE REQUEST ───────────────────────────────────────────
  function request(path, method = 'GET', body = null, retries = 2, options = {}) {
    return new Promise((resolve, reject) => {
      _rl.queue.push({ path, method, body, retries, options, resolve, reject });
      _drainQueue();
    });
  }

  // Téléchargement binaire authentifié. Le cookie httpOnly reste l'unique
  // preuve de session ; aucune URL signée ou publique n'est construite ici.
  async function download(path, options = {}) {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await fetch(_state.api + path, {
        method: 'GET',
        credentials: 'include',
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        const err = new Error(payload.error || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      const disposition = res.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="?([^";]+)"?/i);
      return {
        blob: await res.blob(),
        filename: match ? match[1] : 'document.pdf',
      };
    } catch (err) {
      if (err && err.name === 'AbortError') throw _timeoutError(path, timeoutMs);
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ── AUTH ────────────────────────────────────────────────────
  const auth = {
    async login(email, password, apiUrl) {
      if (apiUrl) {
        _state.api = normalizeApiUrl(apiUrl);
        localStorage.setItem('komerce_api_url', _state.api);
      }
      const health = await request('/api/health');
      const data = await request('/api/auth/login', 'POST', { email, password });
      // Le backend répond { user: {...} } + pose un cookie httpOnly kmrc_jwt
      _state.user = data.user;
      localStorage.setItem('komerce_session', '1');
      return { user: data.user, health };
    },

    async logout() {
      try {
        await request('/api/auth/logout', 'POST');
      } catch (_) { /* ignore */ }
      _state.user = null;
      localStorage.removeItem('komerce_session');
    },

    // Restaure la session depuis le cookie httpOnly (à appeler au chargement de page)
    async restore() {
      try {
        const user = await request('/api/auth/me');
        _state.user = user;
        localStorage.setItem('komerce_session', '1');
        return user;
      } catch (_) {
        _state.user = null;
        localStorage.removeItem('komerce_session');
        return null;
      }
    },

    getUser() { return _state.user; },
    // Hint UI uniquement — la vérité de session est le cookie httpOnly kmrc_jwt (voir /api/auth/me).
    isConnected() { return !!_state.user; },

    setUrl(url) {
      _state.api = normalizeApiUrl(url);
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

    // ── Moteur d'optimisation (Vague 4) ──
    optimize(orderId, config = {}) {
      return request('/api/parcels/optimize', 'POST', { order_id: orderId, config });
    },
    bootstrap(orderId) {
      return request(`/api/parcels/bootstrap/${orderId}`, 'POST');
    },
  };

  // ── HUB ────────────────────────────────────────────────────
  const hub = {
    scanItem(barcode, scannedBy) {
      return request('/api/hub/scan', 'POST', { barcode, scanned_by: scannedBy });
    },
    pack(parcelId) {
      return request('/api/hub/pack', 'POST', { parcel_id: parcelId });
    },
    seal(parcelId) {
      return request('/api/hub/seal', 'POST', { parcel_id: parcelId });
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
	 // ✅ ICI
  create(data) {
    return request('/api/orders', 'POST', data);
	 },
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
    download,
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
