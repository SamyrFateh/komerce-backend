/* ===================================================================
   Komerce Control Tower — ct-api.js
   API layer: all HTTP calls go through here.
   Auth is handled by httpOnly cookie (kmrc_jwt), set by the server.
   =================================================================== */
window.CT = window.CT || {};

CT.api = {
  BASE: '', // Same origin

  /**
   * Core fetch wrapper — always sends credentials (httpOnly cookie).
   * Throws on non-OK responses with server error message.
   */
  async fetch(path, options) {
    options = options || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    var res = await fetch(this.BASE + path, {
      credentials: 'include',
      headers: headers,
      method: options.method || 'GET',
      body: options.body || undefined
    });
    if (!res.ok) {
      var err;
      try { err = await res.json(); } catch(_e) { err = { error: res.statusText }; }
      throw new Error(err.error || err.message || 'Erreur API (' + res.status + ')');
    }
    // Handle 204 No Content
    var text = await res.text();
    if (!text) return {};
    return JSON.parse(text);
  },

  get: function(path) { return this.fetch(path); },
  post: function(path, body) { return this.fetch(path, { method: 'POST', body: JSON.stringify(body) }); },
  put: function(path, body) { return this.fetch(path, { method: 'PUT', body: JSON.stringify(body) }); },
  patch: function(path, body) { return this.fetch(path, { method: 'PATCH', body: JSON.stringify(body) }); },
  del: function(path) { return this.fetch(path, { method: 'DELETE' }); },

  // ---- Auth ----
  login: function(email, password) { return this.post('/api/auth/login', { email: email, password: password }); },
  logout: function() { return this.post('/api/auth/logout'); },
  me: function() { return this.get('/api/auth/me'); },
  guestCheckout: function(phone, fullName) { return this.post('/api/auth/guest-checkout', { phone: phone, full_name: fullName }); },

  // ---- Dashboard ----
  dashboard: function(endpoint) { return this.get('/api/dashboard/' + endpoint); },

  // ---- Orders ----
  createOrder: function(data) { return this.post('/api/orders', data); },
  updateOrderStatus: function(id, status) { return this.patch('/api/orders/' + id + '/status', { status: status }); },
  deleteOrder: function(id) { return this.del('/api/admin/orders/' + id); },
  getOrder: function(ref) { return this.get('/api/orders/' + ref); },

  // ---- Admin ----
  adminOrders: function(params) {
    var qs = new URLSearchParams(params || {}).toString();
    return this.get('/api/admin/orders' + (qs ? '?' + qs : ''));
  },
  seedTest: function() { return this.post('/api/admin/seed-test', { confirm: true }); },
  resetAll: function() { return this.post('/api/admin/reset', { confirm: true }); },

  // ---- Products ----
  // API returns {products: [...], total, limit, offset} — we extract the array
  products: async function() {
    var data = await this.get('/api/products');
    return data.products || data || [];
  }
};
