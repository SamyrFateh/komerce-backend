/**
 * @komerce-arch
 * @role          canonical-commerce-dashboard
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_admin_session, server_resolved_admin_context, requested_market_view, period
 * @outputs       canonical_commerce_dashboard
 * @depends       admin-context, dashboard-schema, dashboard-renderer, primitives
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, canonical_admin_no_legacy_imports, server_market_scope_is_authority
 * @impact-areas  admin-dashboard, commerce, market-authorization
 * @version       2026-08
 */

'use strict';

(function initCanonicalCommerce(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalCommerce = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createCanonicalCommerce() {
  const GLOBAL_ENDPOINT = '/api/admin/dashboard/commerce';
  const MARKET_ENDPOINT_PREFIX = '/api/admin/dashboard/commerce/market/';
  const PERIODS = Object.freeze(['7', '30', '90']);

  const COMMERCE_SCHEMA = Object.freeze({
    id: 'commerce',
    title: 'Commerce',
    description: 'Comprendre ce qui se vend, la valeur créée et l’avancement des commandes.',
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
      source: 'commerce.metrics',
      pick: [
        { key: 'ca-encaisse', label: 'CA encaissé' },
        { key: 'commandes', label: 'Commandes créées' },
        { key: 'panier-moyen', label: 'Panier moyen' },
        { key: 'marge', label: 'Marge consolidée' },
      ],
    },
    sections: [
      {
        id: 'top-produits',
        title: 'Top produits',
        description: 'Les produits qui concentrent le plus de chiffre d’affaires encaissé.',
        type: 'table',
        source: 'commerce.top-products',
        columns: [
          { key: 'produit', label: 'Produit' },
          { key: 'categorie', label: 'Catégorie' },
          { key: 'quantite', label: 'Qté', align: 'right' },
          { key: 'ca', label: 'CA', align: 'right' },
        ],
        emptyText: 'Aucune vente encaissée sur la période.',
      },
      {
        id: 'categories',
        title: 'Performance par catégorie',
        description: 'Volume et chiffre d’affaires encaissé par famille de produits.',
        type: 'table',
        source: 'commerce.categories',
        columns: [
          { key: 'categorie', label: 'Catégorie' },
          { key: 'commandes', label: 'Commandes', align: 'right' },
          { key: 'quantite', label: 'Qté', align: 'right' },
          { key: 'ca', label: 'CA', align: 'right' },
        ],
        emptyText: 'Aucune catégorie vendue sur la période.',
      },
      {
        id: 'funnel',
        title: 'Funnel commandes',
        description: 'La progression réelle des commandes créées jusqu’au retrait au relais.',
        type: 'table',
        source: 'commerce.funnel',
        columns: [
          { key: 'etape', label: 'Étape' },
          { key: 'commandes', label: 'Commandes', align: 'right' },
          { key: 'taux', label: '% des créées', align: 'right' },
        ],
        emptyText: 'Aucune commande sur la période.',
      },
    ],
    drill: [
      { id: 'pilotage', label: 'Retour Pilotage', href: '/admin-next' },
      { id: 'demo-staging', label: 'Cockpit commande · staging', href: '/admin-next/demo' },
    ],
  });

  const KPI_KEYS = Object.freeze({
    ca_encaisse: 'ca-encaisse',
    cmds_creees: 'commandes',
    panier_moyen: 'panier-moyen',
    marge_consolidee: 'marge',
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

  function metricValue(metric) {
    if (!metric || metric.value == null) return '—';
    if (metric.unit === 'KMF') return formatKmf(metric.value);
    if (metric.unit === '%') return `${formatNumber(metric.value)} %`;
    return formatNumber(metric.value, 0);
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

  function metricTone(metric) {
    if (!metric) return 'neutral';
    if (metric.data_quality && metric.data_quality.warning) return 'warning';
    if (metric.key === 'marge_consolidee' && Number(metric.value) < 0) return 'critical';
    return 'neutral';
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

  function projectTopProducts(payload) {
    return (Array.isArray(payload && payload.top_products) ? payload.top_products : []).map(row => ({
      produit: row.name || '—',
      categorie: row.category || '—',
      quantite: formatNumber(row.quantity, 0),
      ca: formatKmf(row.revenue_kmf),
    }));
  }

  function projectCategories(payload) {
    return (Array.isArray(payload && payload.categories) ? payload.categories : []).map(row => ({
      categorie: row.category || '—',
      commandes: formatNumber(row.orders, 0),
      quantite: formatNumber(row.quantity, 0),
      ca: formatKmf(row.revenue_kmf),
    }));
  }

  function projectFunnel(payload) {
    const steps = payload && payload.funnel && Array.isArray(payload.funnel.steps)
      ? payload.funnel.steps
      : [];
    return steps.map(step => ({
      etape: step.label || step.id || '—',
      commandes: formatNumber(step.count, 0),
      taux: `${formatNumber(step.pct)} %`,
    }));
  }

  function resolveSources(payload) {
    return Object.freeze({
      'commerce.metrics': projectMetrics(payload),
      'commerce.top-products': projectTopProducts(payload),
      'commerce.categories': projectCategories(payload),
      'commerce.funnel': projectFunnel(payload),
    });
  }

  function endpointForContext(adminContext, contextContract, requestedMarket) {
    if (!contextContract || typeof contextContract.resolveMarketView !== 'function') {
      throw new Error('canonical_commerce_admin_context_contract_missing');
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

    if (!rootNode) throw new Error('canonical_commerce_root_missing');
    if (!rendererContract || typeof rendererContract.createRenderer !== 'function') {
      throw new Error('canonical_commerce_renderer_missing');
    }

    const renderer = rendererContract.createRenderer({ document: doc, ui });

    async function load(nextPeriod) {
      period = normalizePeriod(nextPeriod == null ? period : nextPeriod);
      renderer.render(rootNode, COMMERCE_SCHEMA, { state: 'loading', stateMessage: 'Chargement de Commerce…' });

      try {
        const payload = await jsonRequest(fetchFn, `${endpoint}?period=${encodeURIComponent(period)}`);
        const result = renderer.render(rootNode, COMMERCE_SCHEMA, {
          data: resolveSources(payload),
          filters: { period },
          onFilterChange: (key, value) => {
            if (key !== 'period') return;
            load(value).catch(() => {});
          },
        });
        return Object.freeze({ payload, result, endpoint, period });
      } catch (error) {
        renderer.render(rootNode, COMMERCE_SCHEMA, { state: 'error', stateMessage: error.message });
        throw error;
      }
    }

    return load(period);
  }

  return Object.freeze({
    GLOBAL_ENDPOINT,
    MARKET_ENDPOINT_PREFIX,
    PERIODS,
    COMMERCE_SCHEMA,
    KPI_KEYS,
    normalizePeriod,
    formatNumber,
    formatKmf,
    projectMetrics,
    projectTopProducts,
    projectCategories,
    projectFunnel,
    resolveSources,
    endpointForContext,
    jsonRequest,
    mount,
  });
});
