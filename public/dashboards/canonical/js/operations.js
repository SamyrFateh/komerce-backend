/**
 * @komerce-arch
 * @role          canonical-operations-dashboard
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_admin_session, server_resolved_admin_context, requested_market_view
 * @outputs       canonical_operations_dashboard
 * @depends       admin-context, dashboard-schema, dashboard-renderer, primitives
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, canonical_admin_no_legacy_imports, server_market_scope_is_authority
 * @impact-areas  admin-dashboard, operations, logistics, market-authorization
 * @version       2026-08
 */

'use strict';

(function initCanonicalOperations(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalOperations = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createCanonicalOperations() {
  const GLOBAL_ENDPOINT = '/api/admin/dashboard/operations';
  const MARKET_ENDPOINT_PREFIX = '/api/admin/dashboard/operations/market/';

  const OPERATIONS_SCHEMA = Object.freeze({
    id: 'operations',
    title: 'Opérations',
    description: 'Voir ce qui doit avancer maintenant : commandes, logistique, relais et incidents.',
    metrics: {
      source: 'operations.metrics',
      pick: [
        { key: 'commandes-aujourdhui', label: 'Commandes aujourd’hui' },
        { key: 'paiements-attente', label: 'Paiements en attente' },
        { key: 'colis-preparation', label: 'Colis préparation' },
        { key: 'colis-transit', label: 'Colis en transit' },
        { key: 'disponibles-relais', label: 'Disponibles relais' },
        { key: 'retards-critiques', label: 'Retards critiques' },
        { key: 'completude-scans', label: 'Complétude scans' },
        { key: 'collecte-relais', label: 'Taux collecte relais' },
      ],
    },
    alerts: {
      source: 'operations.signals',
      title: 'Incidents & signaux opérationnels',
      emptyText: 'Aucun incident opérationnel ouvert.',
    },
    sections: [
      {
        id: 'commandes-actives',
        title: 'File d’exécution',
        description: 'Les commandes actives, les plus anciennes sans avancement en premier.',
        type: 'table',
        source: 'operations.active-orders',
        columns: [
          { key: 'reference', label: 'Commande' },
          { key: 'statut', label: 'Statut' },
          { key: 'paiement', label: 'Paiement' },
          { key: 'relais', label: 'Relais' },
          { key: 'ile', label: 'Destination' },
          { key: 'colis', label: 'Colis', align: 'right' },
          { key: 'attente', label: 'Sans avancement', align: 'right' },
        ],
        emptyText: 'Aucune commande active.',
      },
      {
        id: 'retards-critiques',
        title: 'Colis en retard critique',
        description: 'Colis expédiés depuis plus de 14 jours et non encore disponibles ou retirés.',
        type: 'table',
        source: 'operations.critical-delays',
        columns: [
          { key: 'tracking', label: 'Colis' },
          { key: 'commande', label: 'Commande' },
          { key: 'statut', label: 'Statut' },
          { key: 'relais', label: 'Relais' },
          { key: 'transit', label: 'Transit', align: 'right' },
        ],
        emptyText: 'Aucun retard critique.',
      },
    ],
    drill: [
      { id: 'pilotage', label: 'Retour Pilotage', href: '/admin-next' },
      { id: 'commerce', label: 'Voir Commerce', href: '/admin-next/commerce' },
      { id: 'demo-staging', label: 'Cockpit commande · staging', href: '/admin-next/demo' },
    ],
  });

  const KPI_KEYS = Object.freeze({
    cmds_aujourdhui: 'commandes-aujourdhui',
    paiements_en_attente: 'paiements-attente',
    colis_preparation: 'colis-preparation',
    colis_transit: 'colis-transit',
    disponibles_relais: 'disponibles-relais',
    retards_critiques: 'retards-critiques',
    taux_completude_scans: 'completude-scans',
    taux_collecte_relais: 'collecte-relais',
  });

  function formatNumber(value, maximumFractionDigits = 2) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(numeric);
  }

  function metricValue(metric) {
    if (!metric || metric.value == null) return '—';
    if (metric.unit === '%') return `${formatNumber(metric.value)} %`;
    if (metric.unit === 'KMF') return `${formatNumber(metric.value, 0)} KMF`;
    return formatNumber(metric.value, 0);
  }

  function metricTone(metric) {
    if (!metric) return 'neutral';
    if (metric.key === 'retards_critiques' && Number(metric.value) > 0) return 'critical';
    if (metric.key === 'paiements_en_attente' && Number(metric.value) > 0) return 'warning';
    if (metric.data_quality && metric.data_quality.warning) return 'warning';
    return 'neutral';
  }

  function metricHelper(metric) {
    if (!metric) return undefined;
    if (metric.data_quality && metric.data_quality.warning) return String(metric.data_quality.warning);
    if (metric.delta && metric.delta.is_comparable && metric.delta.value != null) {
      const sign = Number(metric.delta.value) > 0 ? '+' : '';
      return `${sign}${formatNumber(metric.delta.value)} % vs ${metric.delta.vs_period || 'référence'}`;
    }
    return undefined;
  }

  function projectMetrics(payload) {
    const projected = {};
    const kpis = Array.isArray(payload && payload.kpis) ? payload.kpis : [];
    kpis.forEach(metric => {
      const key = metric && KPI_KEYS[metric.key];
      if (!key) return;
      const helper = metricHelper(metric);
      projected[key] = {
        value: metricValue(metric),
        tone: metricTone(metric),
        ...(helper ? { helper } : {}),
      };
    });
    return projected;
  }

  function projectActiveOrders(payload) {
    return (Array.isArray(payload && payload.active_orders) ? payload.active_orders : []).map(row => ({
      reference: row.reference || '—',
      statut: row.status || '—',
      paiement: row.payment_status || '—',
      relais: row.relais_name || '—',
      ile: row.destination_island || '—',
      colis: formatNumber(row.parcels_count, 0),
      attente: `${formatNumber(row.hours_since_last_event, 0)} h`,
    }));
  }

  function projectCriticalDelays(payload) {
    return (Array.isArray(payload && payload.critical_delays) ? payload.critical_delays : []).map(row => ({
      tracking: row.tracking_number || '—',
      commande: row.order_reference || '—',
      statut: row.status || '—',
      relais: row.relais_name || '—',
      transit: `${formatNumber(row.days_in_transit, 0)} j`,
    }));
  }

  function projectSignals(payload) {
    return (Array.isArray(payload && payload.signals) ? payload.signals : []).map(row => {
      const rawLevel = row.severity;
      const level = rawLevel === 'urgent' || rawLevel === 'critical'
        ? 'critical'
        : (rawLevel === 'warning' ? 'warning' : 'info');
      const message = [row.summary, row.recommendation].filter(Boolean).join(' · ') || 'Action requise';
      return {
        level,
        title: row.title || row.signal_type || 'Signal opérationnel',
        message,
      };
    });
  }

  function resolveSources(payload) {
    return Object.freeze({
      'operations.metrics': projectMetrics(payload),
      'operations.signals': projectSignals(payload),
      'operations.active-orders': projectActiveOrders(payload),
      'operations.critical-delays': projectCriticalDelays(payload),
    });
  }

  function endpointForContext(adminContext, contextContract, requestedMarket) {
    if (!contextContract || typeof contextContract.resolveMarketView !== 'function') {
      throw new Error('canonical_operations_admin_context_contract_missing');
    }
    const view = contextContract.resolveMarketView(adminContext, requestedMarket);
    if (view.mode === 'global') return GLOBAL_ENDPOINT;
    return MARKET_ENDPOINT_PREFIX + encodeURIComponent(view.marketCode);
  }

  async function jsonRequest(fetchFn, url) {
    const response = await fetchFn(url, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Erreur HTTP ${response.status}`);
    return body;
  }

  function mount(options) {
    const rootNode = options.root;
    const rendererContract = options.renderer;
    const doc = options.document;
    const ui = options.ui;
    const fetchFn = options.fetch;
    const endpoint = endpointForContext(options.adminContext, options.contextContract, options.requestedMarket);

    if (!rootNode) throw new Error('canonical_operations_root_missing');
    if (!rendererContract || typeof rendererContract.createRenderer !== 'function') {
      throw new Error('canonical_operations_renderer_missing');
    }

    const renderer = rendererContract.createRenderer({ document: doc, ui });
    renderer.render(rootNode, OPERATIONS_SCHEMA, { state: 'loading', stateMessage: 'Chargement des Opérations…' });

    return jsonRequest(fetchFn, endpoint)
      .then(payload => {
        const result = renderer.render(rootNode, OPERATIONS_SCHEMA, { data: resolveSources(payload) });
        return Object.freeze({ payload, result, endpoint });
      })
      .catch(error => {
        renderer.render(rootNode, OPERATIONS_SCHEMA, { state: 'error', stateMessage: error.message });
        throw error;
      });
  }

  return Object.freeze({
    GLOBAL_ENDPOINT,
    MARKET_ENDPOINT_PREFIX,
    OPERATIONS_SCHEMA,
    KPI_KEYS,
    formatNumber,
    projectMetrics,
    projectActiveOrders,
    projectCriticalDelays,
    projectSignals,
    resolveSources,
    endpointForContext,
    jsonRequest,
    mount,
  });
});
