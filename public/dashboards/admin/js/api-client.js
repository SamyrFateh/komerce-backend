/**
 * @komerce-arch
 * @role          admin-dashboard-api-client
 * @domain        admin-dashboard
 * @layer         api-client
 * @criticality   critical
 * @inputs        filters_state, view_params
 * @outputs       fetchJSON_promises
 * @depends       none
 * @used-by       HubRelaisView.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      kmc_api_only
 * @impact-areas  admin-dashboard
 * @version       2026-06
 *
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

'use strict';

(function (global) {
  'use strict';

  const BASE_DASHBOARD = '/api/admin/dashboard';
  const BASE_LEGACY_DASHBOARD = '/api/dashboard';
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

  function legacyDashboardUrl(endpoint, filters, extra) {
    const qs = buildQS({ ...filters, ...extra });
    return `${BASE_LEGACY_DASHBOARD}/${endpoint}${qs ? '?' + qs : ''}`;
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
  // Sous-routes costing détaillées (ex-fetch() bruts de CostingView, migrées vers KmcApi).
  function getCostingOrders(params)          { return fetchJSON(apiUrl('/admin/costing/orders',   params)); }
  function getCostingProducts(params)        { return fetchJSON(apiUrl('/admin/costing/products', params)); }
  function getCostingRelais(params)          { return fetchJSON(apiUrl('/admin/costing/relais',   params)); }
  function getLogistics(filters, extra)      { return fetchJSON(dashboardUrl('logistics',        filters, extra)); }
  function getUnified(filters, extra)        { return fetchJSON(dashboardUrl('unified',          filters, extra)); }

  // ── Vague 1 — Domaines opérationnels ─────────────────────────────────────

  /**
   * Clients — KPI + segments + at_risk + vip_clients + evolution + par_relais
   * @param {object} filters  Filtres globaux (from, to, island, …)
   * @param {object} extra    { vip_threshold?: number }
   */
  function getClients(filters, extra) {
    return fetchJSON(legacyDashboardUrl('clients', filters, extra));
  }

  /**
   * Clients — liste paginée avec recherche
   * @param {object} filters  Filtres globaux
   * @param {object} extra    { page, page_size, segment, search, island, vip_threshold }
   */
  function getClientsList(filters, extra) {
    return fetchJSON(legacyDashboardUrl('clients/list', filters, extra));
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
    return fetchJSON(legacyDashboardUrl('sales', filters, extra));
  }

  /**
   * Ops — données opérationnelles (utilisé par pilotage, hub-relais, etc.)
   * @param {object} filters
   */
  function getOps(filters) {
    return fetchJSON(legacyDashboardUrl('ops', filters));
  }

  /**
   * Pipeline — commandes brutes groupées par statut
   * (confirmed/ordered/preparation/shipped/in_transit/available/collected/cancelled/refunded)
   * Utilisé par Hub & Relais pour les onglets Commander/Emballer/Attente.
   */
  function getPipeline() {
    return fetchJSON(legacyDashboardUrl('pipeline'));
  }

  /**
   * Parcels v2 — liste des colis
   * @param {object} params  URLSearchParams directs (sort, order, status, …)
   */
  function getParcels(params) {
    return fetchJSON(apiUrl('/v2/parcels', params));
  }

  function getParcelReconciliation() { return fetchJSON(apiUrl('/v2/parcels/reconciliation')); }

  // ── Vague 2 — Finance & pricing ───────────────────────────────────────────

  /**
   * Finance — soldes, encaissements, décaissements
   * @param {object} filters
   * @param {object} extra    { period?: number }
   */
  function getFinance(filters, extra) {
    return fetchJSON(legacyDashboardUrl('finance', filters, extra));
  }

  // Economic
  function getEconomicExecutive()        { return fetchJSON(apiUrl('/admin/economic/executive')); }
  function getEconomicHistory(params)    { return fetchJSON(apiUrl('/admin/economic/history', params)); }
  function getEconomicVariables()        { return fetchJSON(apiUrl('/admin/economic/variables')); }
  function getEconomicCharges(params)    { return fetchJSON(apiUrl('/admin/economic/charges', params)); }
  function getEconomicCoherence()        { return fetchJSON(apiUrl('/admin/economic/coherence')); }

  // Finance config
  function getFinanceConfig()            { return fetchJSON(apiUrl('/admin/finance-config')); }

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
  function getCustomsCategories(params)        { return fetchJSON(apiUrl('/admin/customs-categories', params)); }

  // Suppliers / Partners
  function getPartners(params)                 { return fetchJSON(apiUrl('/admin/partners', params)); }
  function getPartnersLogistique()             { return fetchJSON(apiUrl('/admin/partners', { type: 'logistique', active: true })); }
  function getPartnersStats()                  { return fetchJSON(apiUrl('/admin/partners/stats')); }
  function createPartner(body)                 { return fetchMutation(apiUrl('/admin/partners'), 'POST', body); }
  function updatePartner(id, body)             { return fetchMutation(apiUrl('/admin/partners/' + id), 'PUT', body); }
  function deletePartner(id)                   { return fetchMutation(apiUrl('/admin/partners/' + id), 'DELETE'); }

  // Products (catalogue, utilisé par pricing/sourcing)
  function getProducts(params)                 { return fetchJSON(apiUrl('/products', { limit: 500, ...params })); }

  // ── Pricing Strategy (ADR-013) — manquait dans KmcApi, vues jamais branchées ──
  function getPricingStrategy(params)           { return fetchJSON(apiUrl('/pricing/strategy', params)); }
  function applyPricingStrategy(body)           { return fetchMutation(apiUrl('/pricing/strategy/apply'), 'POST', body); }
  function createPricingCompetitor(body)        { return fetchMutation(apiUrl('/pricing/strategy/competitors'), 'POST', body); }
  function deletePricingCompetitor(id)          { return fetchMutation(apiUrl('/pricing/strategy/competitors/' + id), 'DELETE'); }

  // Pricing — chaîne doctrinale (boîtes & flèches + impact live)
  function getPricingFlow(body)                { return fetchMutation(apiUrl('/pricing/flow'), 'POST', body || {}); }
  // Pricing — pilotage catalogue (vérité unique, relaie le moteur)
  function getPricingDashboard()               { return fetchJSON(apiUrl('/pricing/dashboard')); }

  // ── Vague 1 — Transitaire ────────────────────────────────────────────────

  /**
   * Transitaire — KPIs (ready_to_ship, in_transit, total_weight_shipped,
   *               avg_wait_hours, overdue_shipments)
   */
  function getTransitaireStats()          { return fetchJSON(apiUrl('/transitaire/stats')); }

  /**
   * Transitaire — colis prêts à expédier (Hub → Transit)
   * Retourne { parcels: [{ id, reference, order_ref, customer_name,
   *   destination_island, relais_name, nb_items, weight_kg, shipped_at }] }
   */
  function getTransitaireParcels()        { return fetchJSON(apiUrl('/transitaire/parcels')); }

  /**
   * Transitaire — historique des transits récents
   * Retourne { events: [{ parcel_ref, order_ref, actor_name, created_at, notes }] }
   */
  function getTransitaireHistory()        { return fetchJSON(apiUrl('/transitaire/history')); }

  /**
   * Transitaire — expédier un colis (Hub → Transit)
   * @param {string|number} parcelId
   * @param {string}        notes     Optionnel
   * @returns {{ success: boolean, error?: string }}
   */
  function shipTransitaireParcel(parcelId, notes) {
    return fetchMutation(apiUrl('/transitaire/ship'), 'POST', {
      parcel_id: parcelId,
      notes: notes || '',
    });
  }

  // ── Vague 1 — Signals (ActionCenterView) ─────────────────────────────────

  /**
   * Signals — KPIs globaux (total, par sévérité)
   * Retourne { total, urgent, critical, warning, info }
   */
  function getSignalsStats() { return fetchJSON(apiUrl('/admin/signals/stats')); }

  /**
   * Signals — liste des signaux actifs
   * @param {object} params  { limit?, severity?, signal_type? }
   * Retourne { signals: [{ id, signal_type, severity, title, summary,
   *   recommendation, entity_id, target_view, target_filters, created_at }] }
   */
  function getSignalsList(params) { return fetchJSON(apiUrl('/admin/signals', params)); }

  /**
   * Signals — régénérer tous les signaux (recalcul moteur)
   * @param {string[]} types  Optionnel — limiter aux types donnés
   */
  function generateSignals(types) {
    return fetchMutation(apiUrl('/admin/signals/generate'), 'POST', types ? { types } : {});
  }

  /** Signals — marquer un signal comme vu */
  function acknowledgeSignal(id) {
    return fetchMutation(apiUrl('/admin/signals/' + id + '/acknowledge'), 'POST');
  }

  /**
   * Signals — reporter un signal
   * @param {string|number} id
   * @param {number}        hours  Durée du snooze (défaut 24h)
   */
  function snoozeSignal(id, hours) {
    return fetchMutation(apiUrl('/admin/signals/' + id + '/snooze'), 'POST', { hours: hours || 24 });
  }

  /** Signals — marquer un signal comme résolu */
  function resolveSignal(id) {
    return fetchMutation(apiUrl('/admin/signals/' + id + '/resolve'), 'POST');
  }

  // ── Vague 1 — Orders (ProblemsView) ──────────────────────────────────────

  /**
   * Orders — liste des commandes
   * @param {object} params  { limit?, status?, search?, island?, … }
   * Retourne { orders: [...] }
   */
  function getOrders(params) { return fetchJSON(apiUrl('/orders', params)); }

  // ── Vague 1 — Hub & Relais (HubRelaisView) ───────────────────────────────

  /**
   * Hub — marquer une commande comme "commandée" (confirmed → ordered)
   * @param {string} ref  Référence commande
   */
  function hubMarkOrdered(ref) {
    return fetchMutation(apiUrl('/hub/orders/mark-ordered'), 'POST', { reference: ref });
  }

  /**
   * Hub — expédier un colis depuis le Hub (scan shipped)
   * @param {string} ref  Référence colis
   */
  function hubShip(ref) {
    return fetchMutation(apiUrl('/v2/parcels/' + ref + '/scan'), 'POST', {
      event_type: 'shipped',
      notes: 'Expédié Hub — CT',
    });
  }

  /**
   * Hub — lancer la distribution automatique des commandes en colis
   * Retourne { distributed, skipped, parcels_created }
   */
  function autoDistribute() {
    return fetchMutation(apiUrl('/hub/auto-distribute'), 'POST');
  }

  /**
   * Hub — récupérer l'état de distribution actuel
   * Retourne { parcels: [...], unassigned_orders: [...] }
   */
  function getDistribution() { return fetchJSON(apiUrl('/hub/auto-distribute')); }

  /**
   * Relais — confirmer l'encaissement cash d'une commande
   * @param {string} ref  Référence commande
   */
  function relaisConfirmCash(ref) {
    return fetchMutation(apiUrl('/v2/orders/' + ref + '/confirm-cash'), 'POST');
  }

  /**
   * Relais — scanner l'arrivée d'un colis au relais
   * @param {string} ref  Référence colis
   */
  function relaisReceive(ref) {
    return fetchMutation(apiUrl('/v2/parcels/' + ref + '/scan'), 'POST', {
      event_type: 'arrived',
      notes: 'Réception relais — CT',
    });
  }

  /**
   * Relais — scanner la remise client (collecté)
   * @param {string} ref  Référence colis
   */
  function relaisCollect(ref) {
    return fetchMutation(apiUrl('/v2/parcels/' + ref + '/scan'), 'POST', {
      event_type: 'collected',
      notes: 'Remis client — CT',
    });
  }

  // ── Vague 1 — Inventaire Hub (InventoryView) ──────────────────────────────

  /**
   * Inventaire — KPIs (received, proposed, assigned, buffered,
   *              open_parcels, overdue)
   */
  function getHubInventoryStats() { return fetchJSON(apiUrl('/hub/inventory/stats')); }

  /**
   * Inventaire — articles avec leur proposition d'assignation
   * Retourne { items: [{ id, status, product_name, order_ref, destination_island,
   *   wait_minutes, proposed_parcel_id, proposed_parcel_ref, buffer_reason }] }
   */
  function getHubInventoryProposals() { return fetchJSON(apiUrl('/hub/inventory/proposals')); }

  /**
   * Inventaire — colis ouverts disponibles pour l'assignation manuelle
   * Retourne { parcels: [{ id, reference, destination_island, item_count }] }
   */
  function getHubInventoryOpenParcels() { return fetchJSON(apiUrl('/hub/inventory/open-parcels')); }

  /**
   * Inventaire — assigner manuellement un article à un colis (scan)
   * @param {{ inventory_item_id: string|number, parcel_id: string|number }} body
   * Retourne { matched_proposal: boolean, parcel_ref: string }
   */
  function hubInventoryScanAssign(body) {
    return fetchMutation(apiUrl('/hub/inventory/scan-assign'), 'POST', body);
  }

  /**
   * Inventaire — recalculer toutes les propositions d'assignation (moteur)
   * Retourne { proposed, skipped }
   */
  function hubInventoryProposeAll() {
    return fetchMutation(apiUrl('/hub/inventory/propose-all'), 'POST');
  }

  // ── Lot 4 — Sourcing Intelligence ─────────────────────────────────────────

  function getSourcingSynthesis() {
    return fetchJSON(apiUrl('/admin/sourcing/synthesis'));
  }

  function getSourcingAnalysis(params) {
    return fetchJSON(apiUrl('/admin/sourcing/analysis', params));
  }

  function updateSourcingProduct(id, body) {
    return fetchMutation(
      apiUrl('/admin/sourcing/products/' + encodeURIComponent(id)),
      'PUT',
      body
    );
  }

  // ── Lot 4 — Scanner catalogue fournisseur ─────────────────────────────────

  function getSourcingCatalogs(params) {
    return fetchJSON(apiUrl('/admin/sourcing/catalogs', params));
  }

  function getSourcingCandidates(params) {
    return fetchJSON(apiUrl('/admin/sourcing/candidates', params));
  }

  function getSourcingCandidate(id) {
    return fetchJSON(
      apiUrl('/admin/sourcing/candidates/' + encodeURIComponent(id))
    );
  }

  function updateSourcingCandidate(id, body) {
    return fetchMutation(
      apiUrl('/admin/sourcing/candidates/' + encodeURIComponent(id)),
      'PUT',
      body
    );
  }

  function importSourcingCatalog(body) {
    return fetchMutation(
      apiUrl('/admin/sourcing/catalogs/import'),
      'POST',
      body
    );
  }

  function scanSourcingCandidate(id) {
    return fetchMutation(
      apiUrl('/admin/sourcing/candidates/' + encodeURIComponent(id) + '/scan'),
      'POST'
    );
  }

  function importSourcingProduct(id) {
    return fetchMutation(
      apiUrl('/admin/sourcing/candidates/' + encodeURIComponent(id) + '/import-product'),
      'POST'
    );
  }

  function watchlistSourcingCandidate(id) {
    return fetchMutation(
      apiUrl('/admin/sourcing/candidates/' + encodeURIComponent(id) + '/watchlist'),
      'POST'
    );
  }

  function rejectSourcingCandidate(id, body) {
    return fetchMutation(
      apiUrl('/admin/sourcing/candidates/' + encodeURIComponent(id) + '/reject'),
      'POST',
      body
    );
  }
  // ── Lot 6 — Settings ──────────────────────────────────────────────────────

  /** Toutes les règles groupées par catégorie. Retourne { categories } */
  function getSettings() {
    return fetchJSON(`${BASE_API}/admin/rules`);
  }

  /** Détail d'une règle + historique. Retourne { rule, history } */
  function getSettingRule(key) {
    return fetchJSON(`${BASE_API}/admin/rules/${encodeURIComponent(key)}`);
  }

  /** Modifier la valeur d'une règle. @param {{ value, reason }} body */
  function patchSettingRule(key, body) {
    return fetchMutation(`${BASE_API}/admin/rules/${encodeURIComponent(key)}`, 'PATCH', body);
  }

  /** Remettre une règle à sa valeur d'origine. */
  function resetSettingRule(key) {
    return fetchMutation(`${BASE_API}/admin/rules/${encodeURIComponent(key)}/reset`, 'POST');
  }

  /** Matrices de taxes par catégorie. Retourne { taxes } */
  function getSettingsTaxes() {
    return fetchJSON(`${BASE_API}/admin/pricing-matrices/taxes`);
  }

  /** Mettre à jour les taxes d'une catégorie. @param {{ douane_pct, tva_pct, taxe_add_pct, reason }} body */
  function putSettingsTaxes(category, body) {
    return fetchMutation(`${BASE_API}/admin/pricing-matrices/taxes/${encodeURIComponent(category)}`, 'PUT', body);
  }

  /** Matrices de dimensions par catégorie. Retourne { dims } */
  function getSettingsDims() {
    return fetchJSON(`${BASE_API}/admin/pricing-matrices/dims`);
  }

  /** Mettre à jour les dimensions d'une catégorie. @param {{ length_cm, width_cm, height_cm, reason }} body */
  function putSettingsDims(category, body) {
    return fetchMutation(`${BASE_API}/admin/pricing-matrices/dims/${encodeURIComponent(category)}`, 'PUT', body);
  }

  /** Audit trail global (toutes les règles). Retourne { history } */
  function getSettingsAudit() {
    return fetchJSON(`${BASE_API}/admin/rules/audit`);
  }

  // ── Lot 6 — Simulator ─────────────────────────────────────────────────────

  /** Statut courant du simulateur. Retourne { running, tick_count, orders_tracked, config, stats, recent_journal } */
  function simStatus() {
    return fetchJSON(`${BASE_API}/admin/simulator/status`);
  }

  /** Démarrer la simulation. @param {{ cadence_minutes, max_orders, chaos_level, scenarios }} config */
  function simStart(config) {
    return fetchMutation(`${BASE_API}/admin/simulator/start`, 'POST', config);
  }

  /** Arrêter la simulation en cours. */
  function simStop() {
    return fetchMutation(`${BASE_API}/admin/simulator/stop`, 'POST');
  }

  /** Supprimer toutes les données de test générées par la simulation. */
  function simCleanup() {
    return fetchMutation(`${BASE_API}/admin/simulator/cleanup`, 'POST');
  }

  /** Journal complet de la dernière simulation. Retourne { entries } */
  function simJournal() {
    return fetchJSON(`${BASE_API}/admin/simulator/journal`);
  }

  // ── Lot 6 — Shared Carts ──────────────────────────────────────────────────

  /** Liste des paniers partagés (filtrés). @param {{ status? }} extra */
  function getSharedCarts(extra) {
    const qs = buildQS(extra || {});
    return fetchJSON(`${BASE_API}/admin/shared-carts${qs ? '?' + qs : ''}`);
  }

  /** Détail complet d'un panier : { cart, items, contributions, events } */
  function getSharedCart(id) {
    return fetchJSON(`${BASE_API}/admin/shared-carts/${encodeURIComponent(id)}`);
  }

  /** Prolonger l'expiration. @param {{ days }} body */
  function extendSharedCart(id, body) {
    return fetchMutation(`${BASE_API}/admin/shared-carts/${encodeURIComponent(id)}/extend`, 'POST', body);
  }

  /** Forcer l'expiration. @param {{ reason? }} body */
  function expireSharedCart(id, body) {
    return fetchMutation(`${BASE_API}/admin/shared-carts/${encodeURIComponent(id)}/expire`, 'POST', body);
  }

  /** Ajouter une note d'arbitrage. @param {{ note }} body */
  function noteSharedCart(id, body) {
    return fetchMutation(`${BASE_API}/admin/shared-carts/${encodeURIComponent(id)}/note`, 'POST', body);
  }

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
    getCostingOrders,
    getCostingProducts,
    getCostingRelais,
    getLogistics,
    getUnified,
    clearCache,

    // Vague 1 — Opérationnel
    getClients,
    getClientsList,
    getClientDetail,
    getSales,
    getOps,
    getPipeline,
    getParcels,
    getParcelReconciliation,
    getTransitaireStats,
    getTransitaireParcels,
    getTransitaireHistory,
    shipTransitaireParcel,

    // Vague 2 — Finance
    getFinance,
    getEconomicExecutive,
    getEconomicHistory,
    getEconomicVariables,
    getEconomicCharges,
    getEconomicCoherence,
    getFinanceConfig,
    getCashUncollected,
    getCashReconciliation,
    getInvoices,

    // Vague 3 — Catalogue
    getCustomsShipments,
    getCustomsShipment,
    getCustomsRatesEffective,
    createCustomsShipment,
    getCustomsCategories,
    getPartners,
    getPartnersLogistique,
    getPartnersStats,
    createPartner,
    updatePartner,
    deletePartner,
    getProducts,
    getPricingStrategy,
    applyPricingStrategy,
    createPricingCompetitor,
    deletePricingCompetitor,
    getPricingFlow,
    getPricingDashboard,

    // Signals / ActionCenterView (6)
    getSignalsStats,
    getSignalsList,
    generateSignals,
    acknowledgeSignal,
    snoozeSignal,
    resolveSignal,

    // Orders / ProblemsView (1)
    getOrders,

    // Hub / Relais / HubRelaisView (7)
    hubMarkOrdered,
    hubShip,
    autoDistribute,
    getDistribution,
    relaisConfirmCash,
    relaisReceive,
    relaisCollect,

    // Inventory / InventoryView (5)
    getHubInventoryStats,
    getHubInventoryProposals,
    getHubInventoryOpenParcels,
    hubInventoryScanAssign,
    hubInventoryProposeAll,

    // Lot 4 — Sourcing Intelligence (3)
    getSourcingSynthesis,
    getSourcingAnalysis,
    updateSourcingProduct,

    // Lot 4 — Scanner catalogue (9)
    getSourcingCatalogs,
    getSourcingCandidates,
    getSourcingCandidate,
    updateSourcingCandidate,
    importSourcingCatalog,
    scanSourcingCandidate,
    importSourcingProduct,
    watchlistSourcingCandidate,
    rejectSourcingCandidate,
    // Lot 6 — Settings (9)
    getSettings,
    getSettingRule,
    patchSettingRule,
    resetSettingRule,
    getSettingsTaxes,
    putSettingsTaxes,
    getSettingsDims,
    putSettingsDims,
    getSettingsAudit,

    // Lot 6 — Simulator (5)
    simStatus,
    simStart,
    simStop,
    simCleanup,
    simJournal,

    // Lot 6 — Shared Carts (5)
    getSharedCarts,
    getSharedCart,
    extendSharedCart,
    expireSharedCart,
    noteSharedCart,

    ApiError,
  };
})(window);
