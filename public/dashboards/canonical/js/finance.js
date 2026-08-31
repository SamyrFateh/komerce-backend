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
 * @version       2026-08
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
    description: 'Lire l’argent réellement encaissé, les coûts réels, la marge et les écarts à traiter.',
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
      {
        id: 'couts-incomplets',
        title: 'Commandes à coût incomplet',
        description: 'Commandes dont la chaîne de coût réel n’est pas encore complète.',
        type: 'table',
        source: 'finance.incomplete-costs',
        columns: [
          { key: 'commande', label: 'Commande' },
          { key: 'statut', label: 'Statut' },
          { key: 'paiement', label: 'Paiement' },
          { key: 'montant', label: 'Montant', align: 'right' },
          { key: 'cree', label: 'Créée le' },
        ],
        emptyText: 'Toutes les commandes de la période ont leurs coûts complets.',
      },
    ],
    drill: [
      { id: 'accounting-workspace', label: 'Comptabilité & encaissements', href: '/admin/workspaces/accounting' },
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
    return `${formatNumber(value, 0)} KMF`;
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

  function projectIncompleteCosts(payload) {
    return (Array.isArray(payload && payload.incomplete_cost_orders) ? payload.incomplete_cost_orders : []).map(row => ({
      commande: row.reference || '—',
      statut: row.status || '—',
      paiement: row.payment_status || '—',
      montant: formatKmf(row.total_kmf),
      cree: formatDate(row.created_at),
    }));
  }

  function resolveSources(payload) {
    return Object.freeze({
      'finance.metrics': projectMetrics(payload),
      'finance.payment-mix': projectPaymentMix(payload),
      'finance.refunds': projectRefunds(payload),
      'finance.incomplete-costs': projectIncompleteCosts(payload),
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
    normalizePeriod,
    formatNumber,
    formatKmf,
    formatDate,
    projectMetrics,
    projectPaymentMix,
    projectRefunds,
    projectIncompleteCosts,
    resolveSources,
    endpointForContext,
    jsonRequest,
    mount,
  });
});
