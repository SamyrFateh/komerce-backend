/* ===================================================================
   Komerce Control Tower — ct-api.js v4.0 — Parcel-First
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

  // ── Auth ──────────────────────────────────────────────────
  login: function(email, password) { return this.post('/api/auth/login', { email: email, password: password }); },
  logout: function() { return this.post('/api/auth/logout'); },
  me: function() { return this.get('/api/auth/me'); },
  guestCheckout: function(phone, fullName) { return this.post('/api/auth/guest-checkout', { phone: phone, full_name: fullName }); },

  // ── Dashboard (legacy) ────────────────────────────────────
  dashboard: function(endpoint) { return this.get('/api/dashboard/' + endpoint); },

  // ── Orders ────────────────────────────────────────────────
  createOrder: function(data) { return this.post('/api/orders', data); },
  updateOrderStatus: function(id, status) { return this.patch('/api/orders/' + id + '/status', { status: status }); },
  deleteOrder: function(id) { return this.del('/api/admin/orders/' + id); },
  getOrder: function(ref) { return this.get('/api/orders/' + ref); },

  // ── Admin ─────────────────────────────────────────────────
  adminOrders: function(params) {
    var qs = new URLSearchParams(params || {}).toString();
    return this.get('/api/admin/orders' + (qs ? '?' + qs : ''));
  },
  seedTest: function() { return this.post('/api/admin/seed-test', { confirm: true }); },
  resetAll: function(mode) { return this.post('/api/admin/reset', { mode: mode || 'orders' }); },
  adminCounts: function() { return this.get('/api/admin/counts'); },
  adminUsers: function() { return this.get('/api/admin/users'); },

  // ── Payments ──────────────────────────────────────────────
  stripeCreateIntent: function(orderRef) { return this.post('/api/payments/stripe/intent', { order_reference: orderRef }); },
  cashConfirm: function(cashRefCode) { return this.post('/api/payments/cash/confirm', { cash_ref_code: cashRefCode }); },
  paymentRates: function() { return this.get('/api/payments/rates'); },
  stripeConfig: function() { return this.get('/api/payments/config'); },

  // ── Products ──────────────────────────────────────────────
  products: async function() {
    var data = await this.get('/api/products');
    return data.products || data || [];
  },

  // ── Parcels (legacy v1) ───────────────────────────────────
  parcels: function(params) {
    var qs = new URLSearchParams(params || {}).toString();
    return this.get('/api/parcels' + (qs ? '?' + qs : ''));
  },
  getParcel: function(ref) { return this.get('/api/parcels/' + ref); },
  updateParcelStatus: function(id, status, notes) {
    return this.patch('/api/parcels/' + id + '/status', { status: status, notes: notes || null });
  },
  parcelEvents: function(ref) { return this.get('/api/parcels/' + ref + '/events'); },

  // ── Hub Dashboard ─────────────────────────────────────────
  hubDashboard: function() { return this.get('/api/hub-dash/dashboard'); },
  hubQueue: function(params) {
    var qs = new URLSearchParams(params || {}).toString();
    return this.get('/api/hub-dash/queue' + (qs ? '?' + qs : ''));
  },
  hubOrderDetail: function(id) { return this.get('/api/hub-dash/orders/' + id); },
  hubStartPrep: function(id) { return this.post('/api/hub-dash/orders/' + id + '/start-prep', {}); },
  hubShipParcel: function(parcelId, data) {
    return this.post('/api/hub-dash/parcels/' + parcelId + '/ship', data || {});
  },

  // ── Transit Dashboard ─────────────────────────────────────
  transitDashboard: function() { return this.get('/api/transit/dashboard'); },
  transitParcels: function(params) {
    var qs = new URLSearchParams(params || {}).toString();
    return this.get('/api/transit/parcels' + (qs ? '?' + qs : ''));
  },
  transitDelayed: function() { return this.get('/api/transit/delayed'); },
  transitAlerts: function() { return this.get('/api/transit/alerts'); },
  resolveAlert: function(id) { return this.post('/api/transit/alerts/' + id + '/resolve', {}); },
  setParcelDestination: function(id, data) { return this.patch('/api/transit/parcels/' + id + '/destination', data); },

  // ════════════════════════════════════════════════════════════
  // ── PARCEL-FIRST V2 API ────────────────────────────────────
  // ════════════════════════════════════════════════════════════

  // ── Scans (source de vérité) ──────────────────────────────
  scanParcel: function(parcelRef, eventType, data) {
    return this.post('/api/v2/scans/' + parcelRef, Object.assign({ event_type: eventType }, data || {}));
  },
  parcelTimeline: function(parcelRef) {
    return this.get('/api/v2/scans/' + parcelRef + '/timeline');
  },

  // ── Traçabilité ───────────────────────────────────────────
  parcelTrace: function(parcelRef) {
    return this.get('/api/v2/parcels/' + parcelRef + '/trace');
  },

  // ── Vérification relais ───────────────────────────────────
  verifyParcelContent: function(parcelRef, items, notes) {
    return this.post('/api/v2/parcels/' + parcelRef + '/verify', { items: items, notes: notes });
  },

  // ── Incidents ─────────────────────────────────────────────
  getIncidents: function(params) {
    var qs = new URLSearchParams(params || {}).toString();
    return this.get('/api/v2/incidents' + (qs ? '?' + qs : ''));
  },
  resolveIncident: function(id, data) {
    return this.post('/api/v2/incidents/' + id + '/resolve', data);
  },

  // ── Réconciliation ────────────────────────────────────────
  runReconciliation: function() {
    return this.post('/api/v2/reconciliation/run', {});
  },
  getReconciliationReport: function() {
    return this.get('/api/v2/reconciliation/report');
  },
  orderFulfillment: function(orderId) {
    return this.get('/api/v2/reconciliation/order/' + orderId);
  },

  // ── Dashboard v2 (parcel-first) ───────────────────────────
  hubDashV2: function() { return this.get('/api/v2/dashboard/hub'); },
  relaisDashV2: function() { return this.get('/api/v2/dashboard/relais'); },
  opsDashV2: function() { return this.get('/api/v2/dashboard/ops'); },

  // ── Alertes ───────────────────────────────────────────────
  getAlerts: function(params) {
    var qs = new URLSearchParams(params || {}).toString();
    return this.get('/api/v2/alerts' + (qs ? '?' + qs : ''));
  },
  acknowledgeAlert: function(id) {
    return this.post('/api/v2/alerts/' + id + '/ack', {});
  }
};
