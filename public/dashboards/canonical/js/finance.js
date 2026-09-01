/**
 * @komerce-arch
 * @role          canonical-finance-dashboard
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_admin_session, server_resolved_admin_context, requested_market_view, period
 * @outputs       canonical_finance_dashboard
 * @depends       admin-context, dashboard-schema, dashboard-renderer, primitives
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, canonical_admin_no_legacy_imports, server_market_scope_is_authority
 * @impact-areas  admin-dashboard, finance, economic-engine, market-authorization
 * @version       2026-09
 */

'use strict';

(function initCanonicalFinance(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalFinance = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createCanonicalFinance() {
  const GLOBAL_ENDPOINT = '/api/admin/dashboard/finance';
  const MARKET_ENDPOINT_PREFIX = '/api/admin/dashboard/finance/market/';
  const PERIODS = Object.freeze(['7', '30', '90']);

  const FINANCE_SCHEMA = Object.freeze({
    id: 'finance',
    title: 'Finance',
    description: 'Lire l’argent encaissé, la vérité des coûts, la marge et les écarts à traiter.',
    filters: [
      {
        key: 'period',
        label: 'Période',
        type: 'select',
        options: [
          { value: '7', label: '7 jours' },
          { value: '30', label: '30 jours' },
          { value: '90', label: '90 jours' },
        ],
      },
    ],
    metrics: {
      source: 'finance.metrics',
      pick: [
        { key: 'ca-encaisse', label: 'CA encaissé' },
        { key: 'cout-reel', label: 'Coût réel' },
        { key: 'marge', label: 'Marge consolidée' },
        { key: 'completude', label: 'Complétude coûts' },
        { key: 'cout-incomplet', label: 'Coûts incomplets' },
        { key: 'paiement-attente', label: 'Paiements en attente' },
        { key: 'remboursements', label: 'Remboursements' },
      ],
    },
    sections: [
      {
        id: 'trajectoire-financiere',
        title: 'Trajectoire financière',
        description: 'CA encaissé, coût réel et marge consolidée par période. La couverture indique la part des commandes dont le coût est complet.',
        type: 'table',
        source: 'finance.trend',
        columns: [
          { key: 'periode', label: 'Période' },
          { key: 'commandes', label: 'Cmds payées', align: 'right' },
          { key: 'ca', label: 'CA', align: 'right' },
          { key: 'cout', label: 'Coût réel', align: 'right' },
          { key: 'marge', label: 'Marge consolidée', align: 'right' },
          { key: 'couverture', label: 'Couverture', align: 'right' },
        ],
        emptyText: 'Aucune trajectoire financière sur la période.',
      },
      {
        id: 'verite-costing',
        title: 'Vérité du costing',
        description: 'Les niveaux de coût et de marge produits par les autorités métier, sans recalcul dans le navigateur.',
        type: 'table',
        source: 'finance.costing-summary',
        columns: [
          { key: 'indicateur', label: 'Indicateur' },
          { key: 'valeur', label: 'Valeur', align: 'right' },
          { key: 'couverture', label: 'Données', align: 'right' },
          { key: 'qualite', label: 'Qualité' },
        ],
        emptyText: 'Aucune donnée de costing.',
      },
      {
        id: 'variances-costing',
        title: 'Variances récentes',
        description: 'Écart entre coût estimé et coût réel sur les commandes de la période. Une marge consolidée n’est affichable que quand le coût est complet.',
        type: 'table',
        source: 'finance.costing-orders',
        columns: [
          { key: 'commande', label: 'Commande' },
          { key: 'costing', label: 'Costing' },
          { key: 'vente', label: 'Vente', align: 'right' },
          { key: 'estime', label: 'Estimé', align: 'right' },
          { key: 'reel', label: 'Réel', align: 'right' },
          { key: 'variance', label: 'Variance', align: 'right' },
          { key: 'marge', label: 'Marge réelle', align: 'right' },
        ],
        emptyText: 'Aucune commande à comparer sur la période.',
      },
      {
        id: 'couts-par-famille',
        title: 'Coût réel par famille',
        description: 'Répartition des allocations réelles par type de coût sur le périmètre autorisé.',
        type: 'table',
        source: 'finance.cost-families',
        columns: [
          { key: 'famille', label: 'Famille' },
          { key: 'commandes', label: 'Commandes', align: 'right' },
          { key: 'montant', label: 'Montant', align: 'right' },
        ],
        emptyText: 'Aucun coût réel alloué sur la période.',
      },
      {
        id: 'rentabilite-relais',
        title: 'Rentabilité relais',
        description: 'CA et marge par relais. La marge réelle ne porte que sur les commandes dont le costing est complet.',
        type: 'table',
        source: 'finance.relay-profitability',
        columns: [
          { key: 'relais', label: 'Relais' },
          { key: 'commandes', label: 'Cmds', align: 'right' },
          { key: 'ca', label: 'CA', align: 'right' },
          { key: 'marge_estimee', label: 'Marge estimée', align: 'right' },
          { key: 'marge_reelle', label: 'Marge réelle', align: 'right' },
          { key: 'couverture', label: 'Couverture', align: 'right' },
        ],
        emptyText: 'Aucune rentabilité relais calculable sur la période.',
      },
      {
        id: 'modes-paiement',
        title: 'Encaissements par mode',
        description: 'Répartition des commandes payées et du montant encaissé par moyen de paiement.',
        type: 'table',
        source: 'finance.payment-mix',
        columns: [
          { key: 'mode', label: 'Mode' },
          { key: 'commandes', label: 'Commandes', align: 'right' },
          { key: 'montant', label: 'Montant', align: 'right' },
        ],
        emptyText: 'Aucun encaissement sur la période.',
      },
      {
        id: 'remboursements-recents',
        title: 'Remboursements récents',
        description: 'Les remboursements finalisés sur la période financière sélectionnée.',
        type: 'table',
        source: 'finance.refunds',
        columns: [
          { key: 'commande', label: 'Commande' },
          { key: 'methode', label: 'Méthode' },
          { key: 'montant', label: 'Montant', align: 'right' },
          { key: 'date', label: 'Finalisé le' },
        ],
        emptyText: 'Aucun remboursement finalisé sur la période.',
      },
    ],
    drill: [
      { id: 'accounting-workspace', label: 'Comptabilité & encaissements', href: '/admin/workspaces/accounting' },
      { id: 'pricing-workspace', label: 'Pricing & coûts', href: '/admin/workspaces/pricing' },
    ],
  });

  const KPI_KEYS = Object.freeze({
    ca_encaisse: 'ca-encaisse',
    cout_reel: 'cout-reel',
    marge_consolidee: 'marge',
    taux_completude_couts: 'completude',
    cmds_cout_incomplet: 'cout-incomplet',
    paiements_en_attente: 'paiement-attente',
    remboursements: 'remboursements',
  });

  const COST_STATUS_LABELS = Object.freeze({
    actual: 'Réel complet',
    partial_real: 'Réel partiel',
    estimated: 'Estimé',
    incomplete: 'Incomplet',
  });

  function normalizePeriod(value) {
    const period = String(value == null ? '30' : value);
    return PERIODS.includes(period) ? period : '30';
  }

  function formatNumber(value, maximumFractionDigits = 2) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(numeric);
  }

  function formatKmf(value) {
    if (value == null || value === '') return '—';
    return `${formatNumber(value, 0)} KMF`;
  }

  function formatSignedKmf(value) {
    if (value == null || value === '') return '—';
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '—';
    const prefix = numeric > 0 ? '+' : '';
    return `${prefix}${formatNumber(numeric, 0)} KMF`;
  }

  function formatDate(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' }).format(date);
  }

  function metricValue(metric) {
    if (!metric || metric.value == null) return '—';
    if (metric.unit === 'KMF') return formatKmf(metric.value);
    if (metric.unit === '%') return `${formatNumber(metric.value)} %`;
    return formatNumber(metric.value, 0);
  }

  function metricTone(metric) {
    if (!metric) return 'neutral';
    if (metric.key === 'marge_consolidee' && Number(metric.value) < 0) return 'critical';
    if (metric.key === 'taux_completude_couts' && Number(metric.value) < 100) return 'warning';
    if (['cmds_cout_incomplet', 'paiements_en_attente', 'remboursements'].includes(metric.key) && Number(metric.value) > 0) return 'warning';
    if (metric.data_quality && metric.data_quality.warning) return 'warning';
    return 'neutral';
  }

  function metricHelper(metric) {
    if (!metric) return undefined;
    if (metric.data_quality && metric.data_quality.warning) return String(metric.data_quality.warning);
    if (metric.delta && metric.delta.is_comparable && metric.delta.value != null) {
      const sign = Number(metric.delta.value) > 0 ? '+' : '';
      return `${sign}${formatNumber(metric.delta.value)} % vs ${metric.delta.vs_period || 'période précédente'}`;
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

  function projectTrend(payload) {
    return (Array.isArray(payload && payload.trend) ? payload.trend : []).map(row => ({
      periode: formatDate(row.bucket),
      commandes: formatNumber(row.paid_orders, 0),
      ca: formatKmf(row.revenue_kmf),
      cout: formatKmf(row.real_cost_kmf),
      marge: formatKmf(row.consolidated_margin_kmf),
      couverture: row.cost_coverage_pct == null ? '—' : `${formatNumber(row.cost_coverage_pct, 1)} %`,
    }));
  }

  function projectCostingSummary(payload) {
    return (Array.isArray(payload && payload.costing_kpis) ? payload.costing_kpis : []).map(metric => {
      const quality = metric && metric.data_quality ? metric.data_quality : {};
      const total = quality.items_total;
      const withData = quality.items_with_data;
      const coverage = total == null || withData == null
        ? '—'
        : `${formatNumber(withData, 0)}/${formatNumber(total, 0)}`;
      return {
        indicateur: metric.label || metric.key || '—',
        valeur: metricValue(metric),
        couverture: coverage,
        qualite: quality.warning || quality.completeness || '—',
      };
    });
  }

  function projectCostingOrders(payload) {
    return (Array.isArray(payload && payload.costing_orders) ? payload.costing_orders : []).map(row => ({
      commande: row.reference || '—',
      costing: COST_STATUS_LABELS[row.cost_status] || row.cost_status || '—',
      vente: formatKmf(row.sale_total_kmf),
      estime: formatKmf(row.estimated_cost_kmf),
      reel: formatKmf(row.real_cost_kmf),
      variance: formatSignedKmf(row.variance_kmf),
      marge: formatKmf(row.consolidated_margin_kmf),
    }));
  }

  function projectCostFamilies(payload) {
    return (Array.isArray(payload && payload.cost_families) ? payload.cost_families : []).map(row => ({
      famille: row.cost_type || '—',
      commandes: formatNumber(row.orders, 0),
      montant: formatKmf(row.amount_kmf),
    }));
  }

  function projectRelayProfitability(payload) {
    return (Array.isArray(payload && payload.relay_profitability) ? payload.relay_profitability : []).map(row => ({
      relais: row.relais_name || '—',
      commandes: formatNumber(row.orders, 0),
      ca: formatKmf(row.revenue_kmf),
      marge_estimee: formatKmf(row.estimated_margin_kmf),
      marge_reelle: formatKmf(row.consolidated_margin_kmf),
      couverture: row.cost_coverage_pct == null ? '—' : `${formatNumber(row.cost_coverage_pct, 1)} %`,
    }));
  }

  function projectPaymentMix(payload) {
    return (Array.isArray(payload && payload.payment_mix) ? payload.payment_mix : []).map(row => ({
      mode: row.payment_mode || '—',
      commandes: formatNumber(row.orders, 0),
      montant: formatKmf(row.total_kmf),
    }));
  }

  function projectRefunds(payload) {
    const rows = payload && payload.refunds && Array.isArray(payload.refunds.recent)
      ? payload.refunds.recent
      : [];
    return rows.map(row => ({
      commande: row.order_reference || '—',
      methode: row.refund_method || '—',
      montant: formatKmf(row.amount_kmf),
      date: formatDate(row.completed_at),
    }));
  }

  function resolveSources(payload) {
    return Object.freeze({
      'finance.metrics': projectMetrics(payload),
      'finance.trend': projectTrend(payload),
      'finance.costing-summary': projectCostingSummary(payload),
      'finance.costing-orders': projectCostingOrders(payload),
      'finance.cost-families': projectCostFamilies(payload),
      'finance.relay-profitability': projectRelayProfitability(payload),
      'finance.payment-mix': projectPaymentMix(payload),
      'finance.refunds': projectRefunds(payload),
    });
  }

  function endpointForContext(adminContext, contextContract, requestedMarket) {
    if (!contextContract || typeof contextContract.resolveMarketView !== 'function') {
      throw new Error('canonical_finance_admin_context_contract_missing');
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
    let period = normalizePeriod(options.period);

    if (!rootNode) throw new Error('canonical_finance_root_missing');
    if (!rendererContract || typeof rendererContract.createRenderer !== 'function') {
      throw new Error('canonical_finance_renderer_missing');
    }

    const renderer = rendererContract.createRenderer({ document: doc, ui });

    async function load(nextPeriod) {
      period = normalizePeriod(nextPeriod == null ? period : nextPeriod);
      renderer.render(rootNode, FINANCE_SCHEMA, { state: 'loading', stateMessage: 'Chargement de Finance…' });

      try {
        const payload = await jsonRequest(fetchFn, `${endpoint}?period=${encodeURIComponent(period)}`);
        const result = renderer.render(rootNode, FINANCE_SCHEMA, {
          data: resolveSources(payload),
          filters: { period },
          onFilterChange: (key, value) => {
            if (key !== 'period') return;
            load(value).catch(() => {});
          },
        });
        return Object.freeze({ payload, result, endpoint, period });
      } catch (error) {
        renderer.render(rootNode, FINANCE_SCHEMA, { state: 'error', stateMessage: error.message });
        throw error;
      }
    }

    return load(period);
  }

  return Object.freeze({
    GLOBAL_ENDPOINT,
    MARKET_ENDPOINT_PREFIX,
    PERIODS,
    FINANCE_SCHEMA,
    KPI_KEYS,
    COST_STATUS_LABELS,
    normalizePeriod,
    formatNumber,
    formatKmf,
    formatSignedKmf,
    formatDate,
    projectMetrics,
    projectTrend,
    projectCostingSummary,
    projectCostingOrders,
    projectCostFamilies,
    projectRelayProfitability,
    projectPaymentMix,
    projectRefunds,
    resolveSources,
    endpointForContext,
    jsonRequest,
    mount,
  });
});
