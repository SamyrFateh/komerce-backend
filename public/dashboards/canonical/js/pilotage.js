/**
 * @komerce-arch
 * @role          canonical-pilotage-dashboard
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_admin_session, server_resolved_admin_context
 * @outputs       canonical_pilotage_dashboard
 * @depends       admin-context, dashboard-schema, dashboard-renderer, primitives
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, canonical_admin_no_legacy_imports, server_market_scope_is_authority
 * @impact-areas  admin-dashboard, pilotage, market-authorization
 * @version       2026-08
 */

'use strict';

(function initCanonicalPilotage(root, factory) {
  const api = factory();
  /* istanbul ignore else -- CommonJS sous Jest, global navigateur en staging. */
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  /* istanbul ignore else -- exercé par le navigateur. */
  if (root) root.KomerceCanonicalPilotage = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createCanonicalPilotage() {
  const GLOBAL_ENDPOINT = '/api/admin/dashboard/unified';
  const MARKET_ENDPOINT_PREFIX = '/api/admin/dashboard/unified/market/';

  const PILOTAGE_SCHEMA = Object.freeze({
    id: 'pilotage',
    title: 'Pilotage',
    description: 'Voir la santé de Komerce, comprendre les signaux et décider où agir.',
    metrics: {
      source: 'pilotage.metrics',
      pick: [
        { key: 'ca-encaisse', label: 'CA encaissé' },
        { key: 'commandes-actives', label: 'Commandes actives' },
        { key: 'marge-consolidee', label: 'Marge consolidée' },
        { key: 'alertes-critiques', label: 'Alertes critiques' },
        { key: 'completude-couts', label: 'Complétude coûts' },
      ],
    },
    alerts: {
      source: 'pilotage.alerts',
      title: 'Signaux à traiter',
      emptyText: 'Aucun signal prioritaire.',
    },
    sections: [
      {
        id: 'vues-decision',
        title: 'Vues de décision',
        description: 'Les angles canoniques déjà alimentés par le backend.',
        type: 'table',
        source: 'pilotage.views',
        columns: [
          { key: 'vue', label: 'Vue' },
          { key: 'mission', label: 'Mission' },
          { key: 'indicateurs', label: 'Indicateurs' },
        ],
        emptyText: 'Aucune vue de décision disponible.',
      },
      {
        id: 'chaine-economique',
        title: 'Chaîne économique',
        description: 'Le parcours de vérité du prix estimé jusqu’au recalibrage.',
        type: 'table',
        source: 'pilotage.flow',
        columns: [
          { key: 'etape', label: 'Étape' },
          { key: 'destination', label: 'Drill' },
        ],
        emptyText: 'Aucune étape économique disponible.',
      },
    ],
    drill: [
      { id: 'commerce-canonical', label: 'Commerce', href: '/admin/commerce' },
      { id: 'operations-canonical', label: 'Opérations', href: '/admin/operations' },
      { id: 'finance-canonical', label: 'Finance', href: '/admin/finance' },
      { id: 'demo-staging', label: 'Cockpit commande · staging', href: '/admin/demo' },
    ],
  });

  const KPI_KEYS = Object.freeze({
    ca_encaisse: 'ca-encaisse',
    cmds_actives: 'commandes-actives',
    marge_consolidee: 'marge-consolidee',
    alertes_critiques: 'alertes-critiques',
    taux_completude_couts: 'completude-couts',
  });

  function formatNumber(value) {
    if (value == null || value === '') return '—';
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return String(value);
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(numeric);
  }

  function formatMetricValue(metric) {
    if (!metric || metric.value == null) return '—';
    const value = formatNumber(metric.value);
    if (metric.unit === 'KMF') return `${value} KMF`;
    if (metric.unit === '%') return `${value} %`;
    return value;
  }

  function metricTone(metric) {
    if (!metric) return 'neutral';
    if (metric.key === 'alertes_critiques') return Number(metric.value) > 0 ? 'critical' : 'positive';
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
    const kpis = Array.isArray(payload && payload.kpis_global) ? payload.kpis_global : [];
    kpis.forEach(metric => {
      const targetKey = metric && KPI_KEYS[metric.key];
      if (!targetKey) return;
      const helper = metricHelper(metric);
      projected[targetKey] = {
        value: formatMetricValue(metric),
        tone: metricTone(metric),
        ...(helper ? { helper } : {}),
      };
    });
    return projected;
  }

  function projectAlert(item) {
    if (!item || typeof item !== 'object') return null;
    const title = item.title || item.label || item.source || item.key || 'Signal';
    const count = item.count != null ? Number(item.count) : null;
    const message = item.message || (Number.isFinite(count) ? `${count} élément(s) concerné(s)` : 'Action requise');
    const rawLevel = item.level || item.severity;
    const level = rawLevel === 'urgent' ? 'critical' : (['critical', 'warning', 'info'].includes(rawLevel) ? rawLevel : 'info');
    return {
      level,
      title: String(title),
      message: String(message),
      ...(item.action_url || item.href ? { href: item.action_url || item.href } : {}),
      ...(item.action_label || item.actionLabel ? { actionLabel: item.action_label || item.actionLabel } : {}),
    };
  }

  function projectAlerts(payload) {
    const alerts = Array.isArray(payload && payload.system_alerts) ? payload.system_alerts : [];
    return alerts.map(projectAlert).filter(Boolean);
  }

  function projectViews(payload) {
    const blocks = Array.isArray(payload && payload.view_blocks) ? payload.view_blocks : [];
    return blocks.map(block => ({
      vue: block && block.title ? String(block.title) : '—',
      mission: block && block.subtitle ? String(block.subtitle) : '—',
      indicateurs: Array.isArray(block && block.kpis_summary)
        ? block.kpis_summary.map(kpi => kpi && kpi.label).filter(Boolean).join(' · ')
        : '—',
    }));
  }

  function projectFlow(payload) {
    const stages = payload && payload.economic_flow && Array.isArray(payload.economic_flow.stages)
      ? payload.economic_flow.stages
      : [];
    return stages.map(stage => ({
      etape: stage && stage.label ? String(stage.label) : '—',
      destination: stage && stage.url ? String(stage.url) : '—',
    }));
  }

  function resolveSources(payload) {
    return Object.freeze({
      'pilotage.metrics': projectMetrics(payload),
      'pilotage.alerts': projectAlerts(payload),
      'pilotage.views': projectViews(payload),
      'pilotage.flow': projectFlow(payload),
    });
  }

  function endpointForContext(adminContext, contextContract, requestedMarket) {
    if (!contextContract || typeof contextContract.resolveMarketView !== 'function') {
      throw new Error('canonical_pilotage_admin_context_contract_missing');
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
    const ui = options.ui;
    const doc = options.document;
    const fetchFn = options.fetch;
    const endpoint = endpointForContext(
      options.adminContext,
      options.contextContract,
      options.requestedMarket
    );

    if (!rootNode) throw new Error('canonical_pilotage_root_missing');
    if (!rendererContract || typeof rendererContract.createRenderer !== 'function') {
      throw new Error('canonical_pilotage_renderer_missing');
    }

    rootNode.className = '';
    const renderer = rendererContract.createRenderer({ document: doc, ui });
    renderer.render(rootNode, PILOTAGE_SCHEMA, { state: 'loading', stateMessage: 'Chargement du Pilotage…' });

    return jsonRequest(fetchFn, endpoint)
      .then(payload => {
        const result = renderer.render(rootNode, PILOTAGE_SCHEMA, { data: resolveSources(payload) });
        return Object.freeze({ payload, result, endpoint });
      })
      .catch(error => {
        renderer.render(rootNode, PILOTAGE_SCHEMA, { state: 'error', stateMessage: error.message });
        throw error;
      });
  }

  return Object.freeze({
    GLOBAL_ENDPOINT,
    MARKET_ENDPOINT_PREFIX,
    KPI_KEYS,
    PILOTAGE_SCHEMA,
    formatMetricValue,
    metricTone,
    metricHelper,
    projectMetrics,
    projectAlerts,
    projectViews,
    projectFlow,
    resolveSources,
    endpointForContext,
    jsonRequest,
    mount,
  });
});