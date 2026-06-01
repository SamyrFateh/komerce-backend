/**
 * KOMERCE Dashboard — API Client
 * ════════════════════════════════════════════════════════════════════════
 * Wrapper fetch() avec gestion auth (cookie httpOnly), filtres, et erreurs.
 *
 * Conventions :
 *   - Tous les appels passent par fetchJSON() ou fetchMutation().
 *   - Zéro fetch() brut dans les vues — toujours passer par KmcApi.
 *   - Les filtres globaux (from/to/island/…) sont injectés par les vues
 *     via le paramètre `filters` ; les paramètres spécifiques à l'endpoint
 *     (ex: vip_threshold, period) sont passés dans `extra`.
 */

(function (global) {
  'use strict';

  const BASE_DASHBOARD = '/api/admin/dashboard';
  const BASE_API       = '/api';

  // ── Helpers internes ──────────────────────────────────────────────────────

  function buildQS(params) {
    const p = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v != null && v !== '') p.set(k, v);
    });
    return p.toString();
  }

  async function fetchJSON(url, options = {}) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
        ...options,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new ApiError(`${res.status} ${res.statusText}`, res.status, body);
      }
      const text = await res.text();
      return text ? JSON.parse(text) : {};
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(err.message || 'Network error', 0, null);
    }
  }

  async function fetchMutation(url, method, body) {
    return fetchJSON(url, {
      method,
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: body != null ? JSON.stringify(body) : undefined,
    });
  }

  function dashboardUrl(endpoint, filters, extra) {
    const qs = buildQS({ ...filters, ...extra });
    return `${BASE_DASHBOARD}/${endpoint}${qs ? '?' + qs : ''}`;
  }

  function apiUrl(path, params) {
    const qs = buildQS(params);
    return `${BASE_API}${path}${qs ? '?' + qs : ''}`;
  }

  class ApiError extends Error {
    constructor(message, status, body) {
      super(message);
      this.status = status;
      this.body   = body;
    }
  }

  // ── Dashboard endpoints (déjà présents) ───────────────────────────────────

  function getControlTower(filters, extra)   { return fetchJSON(dashboardUrl('control-tower',   filters, extra)); }
  function getCosting(filters, extra)        { return fetchJSON(dashboardUrl('costing',          filters, extra)); }
  function getLogistics(filters, extra)      { return fetchJSON(dashboardUrl('logistics',        filters, extra)); }
  function getEventWorkspaces(filters, extra){ return fetchJSON(dashboardUrl('event-workspaces', filters, extra)); }
  function getUnified(filters, extra)        { return fetchJSON(dashboardUrl('unified',          filters, extra)); }

  // ── Vague 1 — Domaines opérationnels ─────────────────────────────────────

  /**
   * Clients — KPI + segments + at_risk + vip_clients + evolution + par_relais
   * @param {object} filters  Filtres globaux (from, to, island, …)
   * @param {object} extra    { vip_threshold?: number }
   */
  function getClients(filters, extra) {
    return fetchJSON(dashboardUrl('clients', filters, extra));
  }

  /**
   * Clients — liste paginée avec recherche
   * @param {object} filters  Filtres globaux
   * @param {object} extra    { page, page_size, segment, search, island, vip_threshold }
   */
  function getClientsList(filters, extra) {
    return fetchJSON(dashboardUrl('clients/list', filters, extra));
  }

  /**
   * Clients — fiche détail d'un client par téléphone
   * @param {string} phone
   */
  function getClientDetail(phone) {
    return fetchJSON(apiUrl('/dashboard/clients/detail', { phone }));
  }

  /**
   * Sales — CA, commandes, funnel, top produits, cohortes
   * @param {object} filters
   * @param {object} extra    { period?: number }  (nb jours, ex: 7, 30, 90)
   */
  function getSales(filters, extra) {
    return fetchJSON(dashboardUrl('sales', filters, extra));
  }

  /**
   * Ops — données opérationnelles (utilisé par pilotage, hub-relais, etc.)
   * @param {object} filters
   */
  function getOps(filters) {
    return fetchJSON(dashboardUrl('ops', filters));
  }

  /**
   * Parcels v2 — liste des colis
   * @param {object} params  URLSearchParams directs (sort, order, status, …)
   */
  function getParcels(params) {
    return fetchJSON(apiUrl('/v2/parcels', params));
  }

  function getParcelKpis()         { return fetchJSON(apiUrl('/v2/parcels/kpis')); }
  function getParcelAlerts()       { return fetchJSON(apiUrl('/v2/parcels/alerts')); }
  function getParcelCritical()     { return fetchJSON(apiUrl('/v2/parcels/critical')); }
  function getParcelReconciliation() { return fetchJSON(apiUrl('/v2/parcels/reconciliation')); }

  // ── Vague 2 — Finance & pricing ───────────────────────────────────────────

  /**
   * Finance — soldes, encaissements, décaissements
   * @param {object} filters
   * @param {object} extra    { period?: number }
   */
  function getFinance(filters, extra) {
    return fetchJSON(dashboardUrl('finance', filters, extra));
  }

  // Economic
  function getEconomicExecutive()        { return fetchJSON(apiUrl('/admin/economic/executive')); }
  function getEconomicHistory(params)    { return fetchJSON(apiUrl('/admin/economic/history', params)); }
  function getEconomicVariables()        { return fetchJSON(apiUrl('/admin/economic/variables')); }
  function getEconomicCharges(params)    { return fetchJSON(apiUrl('/admin/economic/charges', params)); }
  function getEconomicCoherence()        { return fetchJSON(apiUrl('/admin/economic/coherence')); }
  function updateEconomicVariable(id, body) { return fetchMutation(apiUrl('/admin/economic/variables/' + id), 'PUT', body); }
  function createEconomicCharge(body)    { return fetchMutation(apiUrl('/admin/economic/charges'), 'POST', body); }
  function updateEconomicCharge(id, body){ return fetchMutation(apiUrl('/admin/economic/charges/' + id), 'PUT', body); }
  function redistributeEconomic(body)    { return fetchMutation(apiUrl('/admin/economic/redistribute'), 'POST', body); }

  // Finance config
  function getFinanceConfig()            { return fetchJSON(apiUrl('/admin/finance-config')); }
  function updateFinanceConfig(id, body) { return fetchMutation(apiUrl('/admin/finance-config/' + id), 'PUT', body); }

  // Cash
  function getCashUncollected(params)    { return fetchJSON(apiUrl('/cash/uncollected', params)); }
  function getCashReconciliation(params) { return fetchJSON(apiUrl('/cash/reconciliation', params)); }

  // Invoices
  function getInvoices(params)           { return fetchJSON(apiUrl('/invoices', params)); }

  // ── Vague 3 — Catalogue & approvisionnement ───────────────────────────────

  // Customs
  function getCustomsShipments(params)         { return fetchJSON(apiUrl('/admin/customs-shipments', params)); }
  function getCustomsShipment(id)              { return fetchJSON(apiUrl('/admin/customs-shipments/' + id)); }
  function getCustomsRatesEffective()          { return fetchJSON(apiUrl('/admin/customs-shipments/rates/effective')); }
  function createCustomsShipment(body)         { return fetchMutation(apiUrl('/admin/customs-shipments'), 'POST', body); }
  function updateCustomsShipment(id, body)     { return fetchMutation(apiUrl('/admin/customs-shipments/' + id), 'POST', body); }

  // Suppliers / Partners
  function getPartners(params)                 { return fetchJSON(apiUrl('/admin/partners', params)); }
  function getPartnersLogistique()             { return fetchJSON(apiUrl('/admin/partners', { type: 'logistique', active: true })); }
  function getPartnersStats()                  { return fetchJSON(apiUrl('/admin/partners/stats')); }
  function createPartner(body)                 { return fetchMutation(apiUrl('/admin/partners'), 'POST', body); }
  function updatePartner(id, body)             { return fetchMutation(apiUrl('/admin/partners/' + id), 'PUT', body); }
  function deletePartner(id)                   { return fetchMutation(apiUrl('/admin/partners/' + id), 'DELETE'); }

  // Products (catalogue, utilisé par pricing/sourcing)
  function getProducts(params)                 { return fetchJSON(apiUrl('/products', { limit: 500, ...params })); }

  // Loyalty
  function getLoyaltyPending()                 { return fetchJSON(apiUrl('/admin/loyalty/pending')); }
  function getLoyaltyHistory(params)           { return fetchJSON(apiUrl('/admin/loyalty/history', params)); }
  function createLoyaltyAction(id, body)       { return fetchMutation(apiUrl('/admin/loyalty/' + id), 'POST', body); }

  // ── Cache ─────────────────────────────────────────────────────────────────

  async function clearCache(prefix) {
    const res = await fetch(`${BASE_DASHBOARD}/cache/clear`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix }),
    });
    return res.ok ? await res.json() : null;
  }

  // ── Export ────────────────────────────────────────────────────────────────

  global.KmcApi = {
    // Déjà présents
    getControlTower,
    getCosting,
    getLogistics,
    getEventWorkspaces,
    getUnified,
    clearCache,

    // Vague 1 — Opérationnel
    getClients,
    getClientsList,
    getClientDetail,
    getSales,
    getOps,
    getParcels,
    getParcelKpis,
    getParcelAlerts,
    getParcelCritical,
    getParcelReconciliation,

    // Vague 2 — Finance
    getFinance,
    getEconomicExecutive,
    getEconomicHistory,
    getEconomicVariables,
    getEconomicCharges,
    getEconomicCoherence,
    updateEconomicVariable,
    createEconomicCharge,
    updateEconomicCharge,
    redistributeEconomic,
    getFinanceConfig,
    updateFinanceConfig,
    getCashUncollected,
    getCashReconciliation,
    getInvoices,

    // Vague 3 — Catalogue
    getCustomsShipments,
    getCustomsShipment,
    getCustomsRatesEffective,
    createCustomsShipment,
    updateCustomsShipment,
    getPartners,
    getPartnersLogistique,
    getPartnersStats,
    createPartner,
    updatePartner,
    deletePartner,
    getProducts,
    getLoyaltyPending,
    getLoyaltyHistory,
    createLoyaltyAction,

    ApiError,
  };
})(window);
