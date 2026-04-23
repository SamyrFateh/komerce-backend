/* ===================================================================
   Komerce Control Tower — ct-api.js v6.2
   API layer: all HTTP calls go through here.
   Auth is handled by httpOnly cookie (kmrc_jwt), set by the server.
   v6.1: + hubMarkOrdered (confirmed → ordered)
   v6.2: fix transit functions inside CT.api object
   =================================================================== */
window.CT = window.CT || {};

CT.api = {
  BASE: '',

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
    var text = await res.text();
    if (!text) return {};
    return JSON.parse(text);
  },

  get: function(path) { return this.fetch(path); },
  post: function(path, body) { return this.fetch(path, { method: 'POST', body: JSON.stringify(body || {}) }); },
  put: function(path, body) { return this.fetch(path, { method: 'PUT', body: JSON.stringify(body) }); },
  patch: function(path, body) { return this.fetch(path, { method: 'PATCH', body: JSON.stringify(body) }); },
  del: function(path) { return this.fetch(path, { method: 'DELETE' }); },

  // ---- Auth ----
  login: function(email, password) { return this.post('/api/auth/login', { email: email, password: password }); },
  logout: function() { return this.post('/api/auth/logout'); },
  me: function() { return this.get('/api/auth/me'); },

  // ---- Admin ----
  seedTest: function() { return this.post('/api/admin/seed-test', { confirm: true }); },
  resetAll: function(mode) { return this.post('/api/admin/reset', { mode: mode || 'orders' }); },
  adminCounts: function() { return this.get('/api/admin/counts'); },

  // ═══════════════════════════════════════════════════════════════
  // PARCEL-FIRST v2 ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  // ---- Parcels (COLIS) ----
  v2Parcels: function(params) {
    var qs = new URLSearchParams(params || {}).toString();
    return this.get('/api/v2/parcels' + (qs ? '?' + qs : ''));
  },
  v2ParcelDetail: function(ref) { return this.get('/api/v2/parcels/' + ref); },
  v2ParcelKpis: function() { return this.get('/api/v2/parcels/kpis'); },
  v2ParcelAlerts: function() { return this.get('/api/v2/parcels/alerts'); },
  v2ParcelCritical: function() { return this.get('/api/v2/parcels/critical'); },
  v2ParcelReconciliation: function() { return this.get('/api/v2/parcels/reconciliation'); },
  v2ParcelTimeline: function(ref) { return this.get('/api/v2/parcels/' + ref + '/timeline'); },

  // ---- Scan / Advance Status ----
  v2Scan: function(ref, eventType, notes) {
    return this.post('/api/v2/parcels/' + ref + '/scan', {
      event_type: eventType,
      notes: notes || null,
      actor_name: 'Admin Control Tower',
      actor_role: 'system'
    });
  },

  // ---- Orders v2 (Opérationnel) ----
  v2Orders: function(params) {
    var qs = new URLSearchParams(params || {}).toString();
    return this.get('/api/v2/orders' + (qs ? '?' + qs : ''));
  },
  v2OrderDetail: function(ref) { return this.get('/api/v2/orders/' + ref); },

  v2PendingCash: function() { return this.get('/api/v2/orders/pending-cash'); },
  v2ReadyForParcel: function() { return this.get('/api/v2/orders/ready-for-parcel'); },
  v2ConfirmCash: function(ref) { return this.post('/api/v2/orders/' + ref + '/confirm-cash'); },
  v2CreateParcel: function(ref) { return this.post('/api/v2/orders/' + ref + '/create-parcel'); },

  // ---- Incidents ----
  v2Incidents: function(params) {
    var qs = new URLSearchParams(params || {}).toString();
    return this.get('/api/v2/incidents' + (qs ? '?' + qs : ''));
  },
  v2ResolveIncident: function(id, resolution) {
    return this.post('/api/v2/incidents/' + id + '/resolve', { resolution: resolution });
  },

  // ---- Invoices ----
  invoicesList: function() { return this.get('/api/invoices'); },
  invoiceGet: function(id) { return this.get('/api/invoices/' + id); },

  // ---- Simulator ----
  simStart: function(config) { return this.post("/api/simulator/start", config); },
  simStop: function() { return this.post("/api/simulator/stop"); },
  simStatus: function() { return this.get("/api/simulator/status"); },
  simJournal: function() { return this.get("/api/simulator/journal"); },
  simCleanup: function() { return this.post("/api/simulator/cleanup"); },

  // ---- Hub operational ----
  hubMarkOrdered: function(ref) { return this.post("/api/hub/orders/mark-ordered", { reference: ref }); },
  hubShip: function(parcelId) { return this.post("/api/hub-dash/ship/" + parcelId); },
  hubStartPrep: function(parcelId) { return this.post("/api/hub-dash/start-prep/" + parcelId); },
  hubParcels: function() { return this.get("/api/v2/parcels"); },

  // ---- Relais operational ----
  relaisScanArrival: function(parcelId) { return this.post("/api/v2/parcels/" + parcelId + "/scan", { step: "available" }); },
  relaisScanCollect: function(parcelId) { return this.post("/api/v2/parcels/" + parcelId + "/scan", { step: "collected" }); },


  // ---- Auto-Distribution ----
  autoDistribute: function() { return this.post('/api/hub/auto-distribute'); },
  getDistribution: function() { return this.get('/api/hub/auto-distribute'); },
  reassignOrder: function(orderId, parcelId) { return this.post('/api/hub/reassign-order', { order_id: orderId, target_parcel_id: parcelId }); },

  // ---- Hub Inventory ----
  hubInventoryStats: function() { return this.get('/api/hub/inventory/stats'); },
  hubInventoryProposals: function() { return this.get('/api/hub/inventory/proposals'); },

    // ---- Transit Dashboard ----
  transitParcels: function() { return this.get('/api/transit-dashboard'); },
  markInTransit: function(ref) { return this.post('/api/transit-dashboard/' + ref + '/transit'); },

  // ---- Economic Engine ----
  ecoExecutive: function() { return this.get('/api/admin/economic/executive'); },
  ecoVariables: function() { return this.get('/api/admin/economic/variables'); },
  ecoUpdateVar: function(key, body) { return this.put('/api/admin/economic/variables/' + key, body); },
  ecoCharges: function() { return this.get('/api/admin/economic/charges'); },
  ecoAddCharge: function(body) { return this.post('/api/admin/economic/charges', body); },
  ecoUpdateCharge: function(id, body) { return this.put('/api/admin/economic/charges/' + id, body); },
  ecoToggleCharge: function(id) { return this.put('/api/admin/economic/charges/' + id + '/toggle'); },
  ecoCoherence: function() { return this.get('/api/admin/economic/coherence'); },
  ecoHistory: function() { return this.get('/api/admin/economic/history'); },
  ecoRedistribute: function() { return this.post('/api/admin/economic/redistribute'); },

  // Finance Config (variabilisée)
  financeConfig: function() { return this.get('/api/admin/finance-config'); },
  financeConfigUpdate: function(key, body) { return this.put('/api/admin/finance-config/' + key, body); },

  // Loyalty admin
  loyaltyPending: function() { return this.get('/api/admin/loyalty/pending'); },
  loyaltyHistory: function() { return this.get('/api/admin/loyalty/history'); },
  loyaltyGrant: function(userId) { return this.post('/api/admin/loyalty/' + userId + '/grant'); },
  loyaltySkip: function(userId) { return this.post('/api/admin/loyalty/' + userId + '/skip'); }
};

