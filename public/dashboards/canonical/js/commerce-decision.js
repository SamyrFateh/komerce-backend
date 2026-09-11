/**
 * @komerce-arch
 * @role          canonical-commerce-decision-view
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_commerce_payload, decision_primitives
 * @outputs       decision_first_commerce_dom
 * @depends       commerce, primitives, decision-primitives
 * @used-by       canonical admin Commerce runtime
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, decision_first_dashboard_visuals
 * @impact-areas  admin-dashboard, commerce
 * @version       2026-09
 */
'use strict';

(function initCommerceDecision(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.KomerceCanonicalCommerce && root.KomerceDecisionUI) {
    root.KomerceCanonicalCommerce = api.enhance(root.KomerceCanonicalCommerce, root.KomerceDecisionUI);
  }
})(typeof globalThis !== 'undefined' ? globalThis : null, function createCommerceDecision() {
  'use strict';

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function kpi(payload, key) {
    return (Array.isArray(payload && payload.kpis) ? payload.kpis : [])
      .find(item => item && item.key === key) || null;
  }

  function overallWarningCount(payload) {
    const quality = payload && payload.data_quality && typeof payload.data_quality === 'object'
      ? payload.data_quality : null;
    if (quality && Array.isArray(quality.warnings)) return quality.warnings.length;
    return (Array.isArray(payload && payload.kpis) ? payload.kpis : [])
      .filter(item => item && item.data_quality && item.data_quality.warning).length;
  }

  function incompleteProfitability(payload) {
    return (Array.isArray(payload && payload.product_profitability) ? payload.product_profitability : [])
      .filter(row => {
        if (!row) return false;
        if (row.consolidated_margin_kmf == null) return true;
        const coverage = Number(row.cost_coverage_pct);
        return Number.isFinite(coverage) && coverage < 100;
      });
  }

  function decisionItems(payload, base) {
    const items = [];
    const lost = payload && payload.funnel ? Number(payload.funnel.lost) : NaN;
    const incomplete = incompleteProfitability(payload);
    const margin = kpi(payload, 'marge_consolidee');
    const warnings = overallWarningCount(payload);

    if (Number.isFinite(lost) && lost > 0) {
      items.push({
        key: 'orders-lost',
        label: 'Commandes perdues',
        helper: 'Perte explicitement remontée par le funnel',
        value: base.formatNumber(lost, 0),
        tone: 'critical',
        icon: '↓',
        href: '#commerce-funnel',
        actionLabel: 'Voir le funnel →',
      });
    }

    if (incomplete.length) {
      items.push({
        key: 'profitability-incomplete',
        label: 'Costing incomplet',
        helper: 'Produits sans marge réelle complète',
        value: base.formatNumber(incomplete.length, 0),
        tone: 'warning',
        icon: '¤',
        href: '#commerce-profitability',
        actionLabel: 'Voir la rentabilité →',
      });
    }

    if (margin && Number.isFinite(Number(margin.value)) && Number(margin.value) < 0) {
      items.push({
        key: 'negative-margin',
        label: 'Marge négative',
        helper: 'Marge consolidée de la période',
        value: base.metricValue(margin),
        tone: 'critical',
        icon: '!',
        href: '#commerce-kpis',
        actionLabel: 'Voir les KPI →',
      });
    }

    if (warnings > 0) {
      items.push({
        key: 'data-quality',
        label: 'Qualité des données',
        helper: 'Warnings pouvant affecter la lecture commerciale',
        value: base.formatNumber(warnings, 0),
        tone: 'warning',
        icon: 'i',
      });
    }

    return items.slice(0, 4);
  }

  function metricItems(payload, base) {
    const labels = {
      'ca-encaisse': 'CA encaissé',
      commandes: 'Commandes créées',
      'panier-moyen': 'Panier moyen',
      marge: 'Marge consolidée',
    };
    const items = Object.entries(base.projectMetrics(payload)).map(([key, item]) => ({
      key,
      label: labels[key] || key,
      ...item,
    }));
    const lost = payload && payload.funnel ? Number(payload.funnel.lost) : NaN;
    if (Number.isFinite(lost)) {
      items.push({
        key: 'commandes-perdues',
        label: 'Commandes perdues',
        value: base.formatNumber(lost, 0),
        tone: lost > 0 ? 'critical' : 'neutral',
      });
    }
    return items;
  }

  function rankedCategories(payload, base) {
    return (Array.isArray(payload && payload.categories) ? payload.categories : []).map(row => ({
      title: row.category || 'Catégorie',
      helper: `${base.formatNumber(row.orders, 0)} commande(s) · ${base.formatNumber(row.quantity, 0)} unité(s)`,
      value: base.formatKmf(row.revenue_kmf),
      tone: 'info',
    }));
  }

  function rankedProducts(payload, base) {
    return (Array.isArray(payload && payload.top_products) ? payload.top_products : []).map(row => ({
      title: row.name || row.product_ref || 'Produit',
      helper: `${row.category || 'Sans catégorie'} · ${base.formatNumber(row.quantity, 0)} unité(s)`,
      value: base.formatKmf(row.revenue_kmf),
      tone: 'neutral',
    }));
  }

  function profitabilityItems(payload, base) {
    return (Array.isArray(payload && payload.product_profitability) ? payload.product_profitability : []).map(row => {
      const coverage = row.cost_coverage_pct == null ? '—' : `${base.formatNumber(row.cost_coverage_pct, 1)} %`;
      const realMargin = row.consolidated_margin_kmf == null
        ? 'marge réelle inconnue'
        : `marge réelle ${base.formatKmf(row.consolidated_margin_kmf)}`;
      const numericMargin = Number(row.consolidated_margin_kmf);
      const numericCoverage = Number(row.cost_coverage_pct);
      const incomplete = row.consolidated_margin_kmf == null || (Number.isFinite(numericCoverage) && numericCoverage < 100);
      return {
        title: row.name || row.product_ref || 'Produit',
        helper: `Couverture coûts ${coverage} · ${realMargin}`,
        value: base.formatKmf(row.revenue_kmf),
        tone: Number.isFinite(numericMargin) && numericMargin < 0 ? 'critical' : (incomplete ? 'warning' : 'neutral'),
      };
    });
  }

  function funnelStages(payload, base) {
    const steps = payload && payload.funnel && Array.isArray(payload.funnel.steps)
      ? payload.funnel.steps : [];
    return steps.map(step => ({
      label: step.label || step.id || 'Étape',
      value: base.formatNumber(step.count, 0),
      ...(step.pct == null ? {} : { rate: `${base.formatNumber(step.pct)} %` }),
    }));
  }

  function trust(payload, base) {
    const quality = payload && payload.data_quality && typeof payload.data_quality === 'object'
      ? payload.data_quality : {};
    const scope = payload && payload.scope;
    let generatedAt;
    if (quality.generated_at) {
      const date = new Date(quality.generated_at);
      if (!Number.isNaN(date.getTime())) generatedAt = date.toLocaleString('fr-FR');
    }
    const warnings = overallWarningCount(payload);
    return {
      stateLabel: quality.scope_enforced === false ? 'Scope à vérifier' : 'Source canonique',
      scopeLabel: scope && scope.mode === 'market' && scope.market
        ? `${scope.market.code} · ${scope.market.name || ''}`.trim()
        : 'Vue autorisée',
      generatedAt,
      qualityLabel: payload && payload.period != null ? `Période : ${base.formatNumber(payload.period, 0)} jours` : undefined,
      ...(warnings > 0 ? { warningLabel: `${warnings} warning(s)` } : {}),
    };
  }

  function cardSection(doc, title, description, id) {
    const section = doc.createElement('section');
    section.className = 'kmc-decision-surface-card';
    if (id) section.setAttribute('id', id);
    section.appendChild(text(doc, 'h2', 'kmc-decision-dashboard-section-title', title));
    if (description) section.appendChild(text(doc, 'p', 'kmc-decision-dashboard-section-copy', description));
    const body = doc.createElement('div');
    section.appendChild(body);
    return { section, body };
  }

  function periodControl(doc, period, onPeriodChange) {
    const toolbar = doc.createElement('div');
    toolbar.className = 'kmc-decision-toolbar';
    const copy = doc.createElement('div');
    copy.className = 'kmc-decision-toolbar-copy';
    copy.appendChild(text(doc, 'span', 'kmc-decision-toolbar-label', 'Période observée'));
    copy.appendChild(text(doc, 'strong', 'kmc-decision-toolbar-value', `${period} jours`));
    toolbar.appendChild(copy);

    const select = doc.createElement('select');
    select.className = 'kmc-decision-toolbar-select';
    select.setAttribute('aria-label', 'Période Commerce');
    ['7', '30', '90'].forEach(value => {
      const option = doc.createElement('option');
      option.value = value;
      option.textContent = `${value} jours`;
      if (String(period) === value) option.selected = true;
      select.appendChild(option);
    });
    if (typeof onPeriodChange === 'function') {
      select.addEventListener('change', event => {
        Promise.resolve(onPeriodChange(event.target.value)).catch(() => {});
      });
    }
    toolbar.appendChild(select);
    return toolbar;
  }

  function render(rootNode, payload, options, base, decisionUi) {
    const doc = options.document;
    const ui = options.ui;
    rootNode.replaceChildren();
    rootNode.className = '';

    const dashboard = doc.createElement('article');
    dashboard.className = 'kmc-dashboard kmc-decision-dashboard';
    dashboard.setAttribute('data-dashboard-id', 'commerce');
    dashboard.setAttribute('data-dashboard-visual', 'decision-first-v1');

    const header = doc.createElement('header');
    header.className = 'kmc-dashboard-header';
    header.appendChild(text(doc, 'p', 'canonical-eyebrow', 'DASHBOARD · COMMERCE'));
    header.appendChild(text(doc, 'h1', 'kmc-dashboard-title', 'Commerce'));
    header.appendChild(text(doc, 'p', 'kmc-dashboard-description', 'Voir ce qui se vend, ce qui se perd et où concentrer l’attention commerciale.'));
    dashboard.appendChild(header);
    dashboard.appendChild(periodControl(doc, options.period || payload.period || '30', options.onPeriodChange));

    const decisions = decisionItems(payload, base);
    if (decisions.length) {
      const host = doc.createElement('div');
      decisionUi.DecisionStrip.render(host, { items: decisions });
      dashboard.appendChild(host);
    }

    const kpis = cardSection(doc, 'Indicateurs clés', 'Les valeurs commerciales réellement fournies par la source canonique.', 'commerce-kpis');
    ui.MetricStrip.render(kpis.body, { items: metricItems(payload, base) });
    dashboard.appendChild(kpis.section);

    const topGrid = doc.createElement('div');
    topGrid.className = 'kmc-decision-dashboard-grid-2';
    const categories = cardSection(doc, 'Catégories', 'Classement dans l’ordre fourni par le backend.', 'commerce-categories');
    decisionUi.RankedList.render(categories.body, { items: rankedCategories(payload, base) });
    topGrid.appendChild(categories.section);
    const products = cardSection(doc, 'Top produits', 'Produits qui concentrent le chiffre d’affaires encaissé.', 'commerce-products');
    decisionUi.RankedList.render(products.body, { items: rankedProducts(payload, base) });
    topGrid.appendChild(products.section);
    dashboard.appendChild(topGrid);

    const funnel = cardSection(doc, 'Funnel commandes', 'Progression réelle des commandes sans taux recalculé côté navigateur.', 'commerce-funnel');
    decisionUi.Funnel.render(funnel.body, { stages: funnelStages(payload, base) });
    dashboard.appendChild(funnel.section);

    const profitability = profitabilityItems(payload, base);
    if (profitability.length) {
      const section = cardSection(doc, 'Rentabilité produits', 'La marge réelle reste inconnue tant que le costing n’est pas complet.', 'commerce-profitability');
      decisionUi.RankedList.render(section.body, { items: profitability });
      dashboard.appendChild(section.section);
    }

    const footer = doc.createElement('div');
    decisionUi.TrustFooter.render(footer, trust(payload, base));
    dashboard.appendChild(footer);
    rootNode.appendChild(dashboard);
    return { element: dashboard, visual: 'decision-first-v1' };
  }

  function enhance(base, decisionUi) {
    if (!base || typeof base.mount !== 'function') throw new Error('commerce_decision_base_missing');
    const baseMount = base.mount;
    const enhanced = {
      ...base,
      mount(options) {
        return baseMount(options).then(result => {
          const rerender = nextPeriod => enhanced.mount({ ...options, period: nextPeriod });
          return {
            ...result,
            result: render(options.root, result.payload, {
              ...options,
              period: result.period,
              onPeriodChange: rerender,
            }, base, decisionUi),
            decisionFirst: true,
          };
        });
      },
      projectDecisionItems: payload => decisionItems(payload, base),
      projectMetricItems: payload => metricItems(payload, base),
      projectRankedCategories: payload => rankedCategories(payload, base),
      projectRankedProducts: payload => rankedProducts(payload, base),
      projectProfitabilityItems: payload => profitabilityItems(payload, base),
      projectFunnelStages: payload => funnelStages(payload, base),
      projectTrust: payload => trust(payload, base),
    };
    return Object.freeze(enhanced);
  }

  return Object.freeze({
    kpi,
    overallWarningCount,
    incompleteProfitability,
    decisionItems,
    metricItems,
    rankedCategories,
    rankedProducts,
    profitabilityItems,
    funnelStages,
    trust,
    render,
    enhance,
  });
});
