/**
 * @komerce-arch
 * @role          canonical-pricing-decision-overview
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        pricing_workspace_projection, optional_server_market_decision
 * @outputs       decision_first_pricing_overview_dom
 * @depends       pricing-workspace, canonical primitives, decision-primitives
 * @used-by       canonical admin Pricing runtime
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_acts_dashboard_observes, browser_never_recomputes_economic_truth, market_bounds_possible_human_decides, one_contribution_many_views
 * @impact-areas  admin-dashboard, pricing, economic-engine, market-autonomy
 * @version       2026-09
 */
'use strict';

(function initPricingDecisionOverview(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (!root) return;
  root.KomercePricingDecisionOverview = api;
  api.install(root);
})(typeof globalThis !== 'undefined' ? globalThis : null, function createPricingDecisionOverview() {
  'use strict';

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function formatNumber(value, digits = 0) {
    const n = number(value);
    return n == null ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(n);
  }

  function formatKmf(value) {
    const n = number(value);
    return n == null ? '—' : `${formatNumber(n)} KMF`;
  }

  function formatRatio(workspace, value) {
    return workspace && typeof workspace.formatRatio === 'function'
      ? workspace.formatRatio(value)
      : (number(value) == null ? '—' : `${formatNumber(number(value) * 100, 1)} %`);
  }

  function formatPercentRatio(workspace, value) {
    return workspace && typeof workspace.formatPercentRatio === 'function'
      ? workspace.formatPercentRatio(value)
      : (number(value) == null ? '—' : `${formatNumber(number(value) * 100, 1)} %`);
  }

  function productsByRef(payload) {
    return new Map((Array.isArray(payload && payload.products) ? payload.products : [])
      .filter(row => row && row.product_ref)
      .map(row => [row.product_ref, row]));
  }

  function underFloorProducts(payload) {
    const products = productsByRef(payload);
    return (Array.isArray(payload && payload.recommendations) ? payload.recommendations : [])
      .map(recommendation => ({ recommendation, product: products.get(recommendation && recommendation.product_ref) || null }))
      .filter(({ recommendation, product }) => {
        const current = number(product && product.price_kmf);
        const floor = number(recommendation && recommendation.minimum_safe_price_kmf);
        return current != null && floor != null && current < floor;
      });
  }

  function alertTone(alert) {
    const severity = String(alert && (alert.severity || alert.level || alert.tone || '')).toLowerCase();
    if (severity === 'critical' || severity === 'error' || severity === 'danger') return 'critical';
    if (severity === 'warning' || severity === 'warn') return 'warning';
    return 'info';
  }

  function globalDecisionItems(payload) {
    const executive = payload && payload.economic && payload.economic.executive || {};
    const items = [];
    const belowFloor = underFloorProducts(payload);
    if (belowFloor.length) {
      items.push({
        key: 'price-below-safe-floor',
        label: 'Prix sous plancher serveur',
        helper: 'Prix actuel inférieur au minimum sûr déjà calculé par le moteur',
        value: String(belowFloor.length),
        tone: 'critical',
        icon: '!',
        href: '#pricing-products',
        actionLabel: 'Voir les produits →',
      });
    }
    (Array.isArray(executive.alerts) ? executive.alerts : []).slice(0, 3).forEach((alert, index) => {
      items.push({
        key: `economic-alert-${index}`,
        label: alert.message || alert.category || 'Alerte économique',
        helper: alert.detail || 'Signal fourni par le moteur économique',
        value: alert.value == null ? 'Signal' : String(alert.value),
        tone: alertTone(alert),
        icon: '!',
      });
    });
    return items.slice(0, 4);
  }

  function globalMetricItems(payload) {
    const summary = payload && payload.summary || {};
    const executive = payload && payload.economic && payload.economic.executive || {};
    return [
      { key: 'status', label: 'État économique', value: executive.status_label || executive.status || '—', tone: String(executive.status || '').toLowerCase().includes('critical') ? 'critical' : 'neutral' },
      { key: 'active-products', label: 'Produits actifs', value: formatNumber(summary.active_products), tone: 'neutral' },
      { key: 'active-costs', label: 'Coûts actifs', value: formatNumber(summary.active_cost_components), tone: 'neutral' },
      { key: 'competitors', label: 'Obs. concurrence', value: formatNumber(summary.competitor_observations), tone: Number(summary.competitor_observations) > 0 ? 'neutral' : 'warning' },
      { key: 'under-floor', label: 'Sous plancher sûr', value: String(underFloorProducts(payload).length), tone: underFloorProducts(payload).length ? 'critical' : 'positive' },
    ];
  }

  function globalProductItems(payload) {
    const products = productsByRef(payload);
    return (Array.isArray(payload && payload.recommendations) ? payload.recommendations : [])
      .slice(0, 12)
      .map(recommendation => {
        const product = products.get(recommendation.product_ref) || {};
        const current = number(product.price_kmf);
        const floor = number(recommendation.minimum_safe_price_kmf);
        const belowFloor = current != null && floor != null && current < floor;
        return {
          title: product.name || recommendation.product_ref || 'Produit',
          helper: `Plancher ${formatKmf(recommendation.minimum_safe_price_kmf)} · conseillé ${formatKmf(recommendation.recommended_price_kmf)}`,
          value: `Actuel ${formatKmf(product.price_kmf)}`,
          tone: belowFloor ? 'critical' : 'neutral',
          href: recommendation.product_ref ? `/admin/products/${encodeURIComponent(recommendation.product_ref)}` : undefined,
          actionLabel: 'Product 360 →',
        };
      });
  }

  function marketDecisionMeta(decision) {
    const status = decision && decision.decision_status;
    if (status === 'COVERED') return { label: 'Marché couvert', tone: 'positive' };
    if (status === 'UNCOVERED') return { label: 'Couverture insuffisante', tone: 'warning' };
    if (status === 'NOT_DECISIONAL') return { label: 'Décision impossible', tone: 'critical' };
    return { label: status || 'Décision indisponible', tone: 'neutral' };
  }

  function marketDecisionItems(decision) {
    if (!decision) return [];
    const meta = marketDecisionMeta(decision);
    const items = [{
      key: 'market-decision',
      label: meta.label,
      helper: decision.reason || 'Décision serveur',
      value: decision.coverage && decision.coverage.coverage_ratio == null ? '—' : String(decision.coverage && decision.coverage.coverage_ratio),
      tone: meta.tone,
      icon: meta.tone === 'positive' ? '✓' : '!',
      href: '#pricing-market-decision',
      actionLabel: 'Voir la décision →',
    }];
    if (decision.authorization === 'DENY_NEW_UNDER_CDR_POSITION') {
      items.push({
        key: 'market-authorization',
        label: 'Nouvelle position sous CDR bloquée',
        helper: 'Le gate serveur refuse cette nouvelle position économique',
        value: 'Bloquée',
        tone: 'critical',
        icon: '×',
        href: '#pricing-market-decision',
        actionLabel: 'Voir le gate →',
      });
    }
    return items;
  }

  function marketMetricItems(payload, decision, workspace) {
    const summary = payload && payload.summary || {};
    const coverage = decision && decision.coverage || {};
    const components = Array.isArray(payload && payload.cost_components) ? payload.cost_components : [];
    const overrides = components.filter(component => component && component.inherited === false).length;
    return [
      { key: 'coverage', label: 'Couverture réelle', value: formatRatio(workspace, coverage.coverage_ratio), tone: marketDecisionMeta(decision).tone },
      { key: 'contribution', label: 'Contribution reconnue', value: formatKmf(coverage.numerator_contribution_kmf), tone: 'neutral' },
      { key: 'structure', label: 'Structure à couvrir', value: formatKmf(coverage.denominator_n3_kmf), tone: 'neutral' },
      { key: 'maturity', label: 'Maturité', value: formatPercentRatio(workspace, coverage.maturity && coverage.maturity.maturity_ratio), tone: 'neutral' },
      { key: 'overrides', label: 'Overrides pays', value: String(overrides), tone: overrides ? 'info' : 'neutral' },
      { key: 'active-costs', label: 'Coûts actifs', value: formatNumber(summary.active_cost_components), tone: 'neutral' },
    ];
  }

  function marketCostItems(payload) {
    return (Array.isArray(payload && payload.cost_components) ? payload.cost_components : [])
      .filter(component => component && component.inherited === false)
      .slice(0, 12)
      .map(component => ({
        title: component.label || component.key || 'Charge',
        helper: [component.economic_nature, component.allocation_perimeter, component.category].filter(Boolean).join(' · '),
        value: component.effective_value == null ? (component.default_value == null ? 'Override pays' : String(component.default_value)) : String(component.effective_value),
        tone: component.is_active === false ? 'warning' : 'info',
      }));
  }

  function globalTrust(payload) {
    const executive = payload && payload.economic && payload.economic.executive || {};
    let generatedAt;
    if (executive.generated_at) {
      const date = new Date(executive.generated_at);
      if (!Number.isNaN(date.getTime())) generatedAt = date.toLocaleString('fr-FR');
    }
    return {
      stateLabel: 'Moteur économique canonique',
      scopeLabel: 'Modèle global Komerce',
      generatedAt,
      qualityLabel: executive.recommendation && executive.recommendation.text
        ? `Recommandation serveur : ${executive.recommendation.text}`
        : undefined,
    };
  }

  function marketTrust(payload, decision, marketCode) {
    const scope = payload && payload.scope || {};
    const access = payload && payload.access || {};
    let generatedAt;
    if (decision && decision.evaluated_at) {
      const date = new Date(decision.evaluated_at);
      if (!Number.isNaN(date.getTime())) generatedAt = date.toLocaleString('fr-FR');
    }
    return {
      stateLabel: 'Décision serveur',
      scopeLabel: `${scope.market_name || marketCode || 'Marché'} · ${scope.market_code || marketCode || '—'}`,
      generatedAt,
      qualityLabel: access.read_only ? 'Viewer · lecture / simulation' : 'Manager · décision pays',
    };
  }

  function cardSection(doc, title, description, id) {
    const section = doc.createElement('section');
    section.className = 'kmc-decision-surface-card';
    if (id) section.id = id;
    section.appendChild(text(doc, 'h2', 'kmc-decision-dashboard-section-title', title));
    if (description) section.appendChild(text(doc, 'p', 'kmc-decision-dashboard-section-copy', description));
    const body = doc.createElement('div');
    section.appendChild(body);
    return { section, body };
  }

  function renderOverview(rootNode, payload, decision, options, workspace, decisionUi) {
    const doc = options.document;
    const ui = options.ui;
    const marketMode = Boolean(options.requestedMarket);
    const overview = doc.createElement('article');
    overview.className = 'kmc-dashboard kmc-decision-dashboard kmc-pricing-decision-overview';
    overview.dataset.dashboardId = 'pricing';
    overview.dataset.dashboardVisual = 'decision-first-v1';
    overview.dataset.pricingDecisionOverview = '';

    const header = doc.createElement('header');
    header.className = 'kmc-dashboard-header';
    header.appendChild(text(doc, 'p', 'canonical-eyebrow', marketMode ? 'ATELIER ÉCONOMIQUE · MARCHÉ' : 'ATELIER ÉCONOMIQUE · GLOBAL'));
    header.appendChild(text(doc, 'h1', 'kmc-dashboard-title', marketMode ? `État économique · ${options.requestedMarket}` : 'Atelier économique'));
    header.appendChild(text(doc, 'p', 'kmc-dashboard-description', marketMode
      ? 'Lire d’abord la couverture, la maturité et les frontières serveur avant de manipuler les leviers pays.'
      : 'Lire d’abord la santé du moteur, les alertes et les frontières de prix avant de modifier les hypothèses.'));
    overview.appendChild(header);

    const decisions = marketMode ? marketDecisionItems(decision) : globalDecisionItems(payload);
    if (decisions.length) {
      const host = doc.createElement('div');
      decisionUi.DecisionStrip.render(host, { items: decisions });
      overview.appendChild(host);
    }

    const metrics = cardSection(doc, marketMode ? 'État de la période' : 'État du moteur', marketMode
      ? 'Contribution, structure et maturité reprises de la décision serveur ; aucun seuil n’est recalculé côté navigateur.'
      : 'Indicateurs du workspace et du moteur économique, sans reconstruction métier dans la couche visuelle.', marketMode ? 'pricing-market-decision' : 'pricing-engine-state');
    ui.MetricStrip.render(metrics.body, { items: marketMode ? marketMetricItems(payload, decision, workspace) : globalMetricItems(payload) });
    overview.appendChild(metrics.section);

    const rankedItems = marketMode ? marketCostItems(payload) : globalProductItems(payload);
    if (rankedItems.length) {
      const ranked = cardSection(doc, marketMode ? 'Overrides pays' : 'Frontières prix produit', marketMode
        ? 'Lignes dont la valeur pays remplace explicitement l’héritage global.'
        : 'Prix actuel, plancher sûr et recommandation déjà produits par le moteur.', marketMode ? 'pricing-market-overrides' : 'pricing-products');
      decisionUi.RankedList.render(ranked.body, { items: rankedItems });
      overview.appendChild(ranked.section);
    }

    const footer = doc.createElement('div');
    decisionUi.TrustFooter.render(footer, marketMode ? marketTrust(payload, decision, options.requestedMarket) : globalTrust(payload));
    overview.appendChild(footer);

    const existing = rootNode.querySelector('[data-pricing-decision-overview]');
    if (existing) existing.remove();
    const workspaceHeader = rootNode.querySelector('.kmc-workspace-header');
    if (workspaceHeader && workspaceHeader.parentNode) workspaceHeader.parentNode.insertBefore(overview, workspaceHeader.nextSibling);
    else rootNode.prepend(overview);
    return overview;
  }

  async function fetchMarketDecision(workspace, options) {
    if (!options.requestedMarket) return null;
    const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
    return workspace.jsonRequest(options.fetch, `${endpoint}/decision`);
  }

  function install(rootObject) {
    const workspace = rootObject && rootObject.KomerceCanonicalPricingWorkspace;
    const decisionUi = rootObject && rootObject.KomerceDecisionUI;
    if (!workspace || !decisionUi || workspace.__decisionOverviewInstalled || typeof workspace.mount !== 'function') return false;
    const originalMount = workspace.mount.bind(workspace);
    workspace.mount = async function decisionOverviewMount(options) {
      const payload = await originalMount(options);
      let decision = null;
      if (options.requestedMarket) {
        try { decision = await fetchMarketDecision(workspace, options); }
        catch (_) { decision = null; }
      }
      renderOverview(options.root, payload, decision, options, workspace, decisionUi);
      return payload;
    };
    workspace.__decisionOverviewInstalled = true;
    return true;
  }

  return Object.freeze({
    number,
    productsByRef,
    underFloorProducts,
    alertTone,
    globalDecisionItems,
    globalMetricItems,
    globalProductItems,
    marketDecisionMeta,
    marketDecisionItems,
    marketMetricItems,
    marketCostItems,
    globalTrust,
    marketTrust,
    renderOverview,
    fetchMarketDecision,
    install,
  });
});
