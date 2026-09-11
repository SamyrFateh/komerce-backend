/**
 * @komerce-arch
 * @role          canonical-orders-decision-view
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_commerce_payload, decision_primitives
 * @outputs       decision_first_orders_dom
 * @depends       commerce, commerce-decision, primitives, decision-primitives
 * @used-by       canonical Commandes representation mode on /admin/commerce?view=orders
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, decision_first_dashboard_visuals, shared_source_distinct_business_view
 * @impact-areas  admin-dashboard, orders, commerce
 * @version       2026-09
 */
'use strict';

(function initOrdersDecision(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root
    && root.KomerceCanonicalCommerce
    && root.KomerceDecisionUI
    && api.isOrdersLocation(root.location)) {
    root.KomerceCanonicalCommerce = api.enhance(
      root.KomerceCanonicalCommerce,
      root.KomerceDecisionUI
    );
  }
})(typeof window !== 'undefined' ? window : null, function createOrdersDecision() {
  'use strict';

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function isOrdersLocation(locationLike) {
    if (!locationLike) return false;
    try {
      const params = new URLSearchParams(String(locationLike.search || ''));
      return params.get('view') === 'orders';
    } catch (_) {
      return false;
    }
  }

  function funnelSteps(payload) {
    return payload && payload.funnel && Array.isArray(payload.funnel.steps)
      ? payload.funnel.steps
      : [];
  }

  function lifecycleMetrics(payload, base) {
    return funnelSteps(payload).map(step => ({
      key: step.id || step.label || 'stage',
      label: step.label || step.id || 'Étape',
      value: base.formatNumber(step.count, 0),
      tone: 'neutral',
      ...(step.pct == null ? {} : { helper: `${base.formatNumber(step.pct)} % des commandes créées` }),
    }));
  }

  function lifecycleStages(payload, base) {
    return funnelSteps(payload).map(step => ({
      label: step.label || step.id || 'Étape',
      value: base.formatNumber(step.count, 0),
      ...(step.pct == null ? {} : { rate: `${base.formatNumber(step.pct)} %` }),
    }));
  }

  function warningCount(payload) {
    const quality = payload && payload.data_quality && typeof payload.data_quality === 'object'
      ? payload.data_quality
      : null;
    if (quality && Array.isArray(quality.warnings)) return quality.warnings.length;
    return (Array.isArray(payload && payload.kpis) ? payload.kpis : [])
      .filter(item => item && item.data_quality && item.data_quality.warning).length;
  }

  function decisionItems(payload, base) {
    const items = [];
    const lost = payload && payload.funnel ? Number(payload.funnel.lost) : NaN;
    const warnings = warningCount(payload);

    if (Number.isFinite(lost) && lost > 0) {
      items.push({
        key: 'orders-lost',
        label: 'Commandes perdues',
        helper: 'Commandes annulées ou remboursées explicitement remontées par la source canonique',
        value: base.formatNumber(lost, 0),
        tone: 'critical',
        icon: '↓',
        href: '#orders-funnel',
        actionLabel: 'Voir le cycle →',
      });
    }

    if (warnings > 0) {
      items.push({
        key: 'orders-data-quality',
        label: 'Qualité des données',
        helper: 'Warnings serveur pouvant affecter la lecture du cycle commandes',
        value: base.formatNumber(warnings, 0),
        tone: 'warning',
        icon: 'i',
      });
    }

    return items;
  }

  function trust(payload, base) {
    const quality = payload && payload.data_quality && typeof payload.data_quality === 'object'
      ? payload.data_quality
      : {};
    const scope = payload && payload.scope;
    let generatedAt;
    if (quality.generated_at) {
      const date = new Date(quality.generated_at);
      if (!Number.isNaN(date.getTime())) generatedAt = date.toLocaleString('fr-FR');
    }
    const warnings = warningCount(payload);
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
    select.setAttribute('aria-label', 'Période Commandes');
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
    dashboard.setAttribute('data-dashboard-id', 'orders');
    dashboard.setAttribute('data-dashboard-visual', 'decision-first-v1');

    const header = doc.createElement('header');
    header.className = 'kmc-dashboard-header';
    header.appendChild(text(doc, 'p', 'canonical-eyebrow', 'COMMANDES · VUE D’ENSEMBLE'));
    header.appendChild(text(doc, 'h1', 'kmc-dashboard-title', 'Commandes'));
    header.appendChild(text(
      doc,
      'p',
      'kmc-dashboard-description',
      'Suivre le cycle réel des commandes et repérer les pertes prouvées sans fabriquer de SLA, de blocage ou de litige.'
    ));
    dashboard.appendChild(header);
    dashboard.appendChild(periodControl(doc, options.period || payload.period || '30', options.onPeriodChange));

    const decisions = decisionItems(payload, base);
    if (decisions.length) {
      const host = doc.createElement('div');
      decisionUi.DecisionStrip.render(host, { items: decisions });
      dashboard.appendChild(host);
    }

    const kpis = cardSection(
      doc,
      'Cycle de commande',
      'Les cinq étapes sont les compteurs du funnel serveur, avec les pourcentages déjà produits par le backend.',
      'orders-kpis'
    );
    ui.MetricStrip.render(kpis.body, { items: lifecycleMetrics(payload, base) });
    dashboard.appendChild(kpis.section);

    const funnel = cardSection(
      doc,
      'Funnel commandes',
      'Créées → Payées → Expédiées → Disponibles relais → Retirées. Aucun taux n’est recalculé dans le navigateur.',
      'orders-funnel'
    );
    decisionUi.Funnel.render(funnel.body, { stages: lifecycleStages(payload, base) });
    dashboard.appendChild(funnel.section);

    const gap = cardSection(
      doc,
      'Signaux non encore prouvés',
      'Paiements en attente, commandes bloquées, retraits en retard, litiges et SLA restent absents tant qu’une source canonique ne les fournit pas.',
      'orders-gaps'
    );
    decisionUi.InfoList.render(gap.body, {
      items: [
        { title: 'Aucun signal synthétique ajouté', helper: 'Une absence de donnée ne devient jamais zéro ni alerte artificielle.', tone: 'neutral' },
      ],
    });
    dashboard.appendChild(gap.section);

    const footer = doc.createElement('div');
    decisionUi.TrustFooter.render(footer, trust(payload, base));
    dashboard.appendChild(footer);
    rootNode.appendChild(dashboard);
    return { element: dashboard, visual: 'decision-first-v1', view: 'orders' };
  }

  function enhance(base, decisionUi) {
    if (!base || typeof base.mount !== 'function') throw new Error('orders_decision_base_missing');
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
            dashboardView: 'orders',
          };
        });
      },
      projectDecisionItems: payload => decisionItems(payload, base),
      projectLifecycleMetrics: payload => lifecycleMetrics(payload, base),
      projectLifecycleStages: payload => lifecycleStages(payload, base),
      projectTrust: payload => trust(payload, base),
    };
    return Object.freeze(enhanced);
  }

  return Object.freeze({
    isOrdersLocation,
    funnelSteps,
    lifecycleMetrics,
    lifecycleStages,
    warningCount,
    decisionItems,
    trust,
    render,
    enhance,
  });
});
