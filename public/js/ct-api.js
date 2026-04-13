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
  resetAll: function(mode) { return this.post('/api/admin/reset', { mode: mode || 'orders' }); },
  adminCounts: function() { return this.get('/api/admin/counts'); },
  adminUsers: function() { return this.get('/api/admin/users'); },

  // ---- Payments (Stripe + Cash) ----
  stripeCreateIntent: function(orderRef) { return this.post('/api/payments/stripe/intent', { order_reference: orderRef }); },
  cashConfirm: function(cashRefCode) { return this.post('/api/payments/cash/confirm', { cash_ref_code: cashRefCode }); },
  paymentRates: function() { return this.get('/api/payments/rates'); },
  stripeConfig: function() { return this.get('/api/payments/config'); },

  // ---- Products ----
  // API returns {products: [...], total, limit, offset} — we extract the array
  products: async function() {
    var data = await this.get('/api/products');
    return data.products || data || [];
  },

  // ---- Parcels (colis — unité logistique R1) ----
  // GET /api/parcels  → { data: [...], pagination: {...} }
  parcels: function(params) {
    var qs = new URLSearchParams(params || {}).toString();
    return this.get('/api/parcels' + (qs ? '?' + qs : ''));
  },
  getParcel: function(ref) { return this.get('/api/parcels/' + ref); },
  // PATCH /api/parcels/:id/status  → change parcel status (logistic unit)
  updateParcelStatus: function(id, status, notes) {
    return this.patch('/api/parcels/' + id + '/status', { status: status, notes: notes || null });
  },
  parcelEvents: function(ref) { return this.get('/api/parcels/' + ref + '/events'); },

  // ---- Hub Dashboard (KPIs opérationnels + file + détail complet) ----
  // NOTE: route montée sur /api/hub-dash (pas hub-dashboard)
  hubDashboard: function() { return this.get('/api/hub-dash/dashboard'); },
  hubQueue: function(params) {
    var qs = new URLSearchParams(params || {}).toString();
    return this.get('/api/hub-dash/queue' + (qs ? '?' + qs : ''));
  },
  // GET /api/hub-dash/orders/:id → détail commande avec colis, items, timeline, incidents
  hubOrderDetail: function(id) { return this.get('/api/hub-dash/orders/' + id); },
  hubStartPrep: function(id) { return this.post('/api/hub-dash/orders/' + id + '/start-prep', {}); },
  hubShipParcel: function(parcelId, data) {
    return this.post('/api/hub-dash/parcels/' + parcelId + '/ship', data || {});
  },

  // ---- Transit Dashboard (colis-first) ----
  transitDashboard: function() { return this.get('/api/transit/dashboard'); },
  transitParcels: function(params) {
    var qs = new URLSearchParams(params || {}).toString();
    return this.get('/api/transit/parcels' + (qs ? '?' + qs : ''));
  },
  transitDelayed: function() { return this.get('/api/transit/delayed'); },
  transitAlerts: function() { return this.get('/api/transit/alerts'); },
  resolveAlert: function(id) { return this.post('/api/transit/alerts/' + id + '/resolve', {}); },
  setParcelDestination: function(id, data) { return this.patch('/api/transit/parcels/' + id + '/destination', data); }
};
