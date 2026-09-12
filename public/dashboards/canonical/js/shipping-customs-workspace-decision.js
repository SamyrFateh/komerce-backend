/**
 * @komerce-arch
 * @role          canonical-shipping-customs-workspace-decision-view
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_shipping_customs_summary, decision_primitives
 * @outputs       decision_first_shipping_customs_overview
 * @depends       shipping-customs-workspace, decision-primitives, primitives
 * @used-by       canonical admin Expéditions & Douane workspace runtime
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_acts_dashboard_observes, dashboard_no_business_recompute, decision_first_dashboard_visuals
 * @impact-areas  admin-dashboard, logistics, customs
 * @version       2026-09
 */
'use strict';

(function initShippingCustomsDecision(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.KomerceCanonicalShippingCustomsWorkspace && root.KomerceDecisionUI) {
    root.KomerceCanonicalShippingCustomsWorkspace = api.enhance(
      root.KomerceCanonicalShippingCustomsWorkspace,
      root.KomerceDecisionUI
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : null, function createShippingCustomsDecision() {
  'use strict';

  const DECISION_COPY = Object.freeze({
    'transit-ready': Object.freeze({
      label: 'Colis à mettre en transit',
      helper: 'Colis expédiés en attente de confirmation du transit',
      icon: '⇢',
    }),
    'customs-candidates': Object.freeze({
      label: 'Colis à rattacher douane',
      helper: 'Colis expédiés ou en transit sans expédition douane active',
      icon: '↔',
    }),
    'customs-pending': Object.freeze({
      label: 'Douane à déclarer',
      helper: 'Expéditions douane actives encore au statut pending',
      icon: '§',
    }),
  });

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function indexMetrics(items) {
    const index = Object.create(null);
    (Array.isArray(items) ? items : []).forEach(item => {
      if (item && item.key) index[item.key] = item;
    });
    return index;
  }

  function decisionItems(items) {
    return (Array.isArray(items) ? items : [])
      .filter(item => item && item.tone === 'warning' && DECISION_COPY[item.key])
      .map(item => ({
        key: item.key,
        label: DECISION_COPY[item.key].label,
        helper: DECISION_COPY[item.key].helper,
        value: item.value == null ? '—' : item.value,
        tone: 'warning',
        icon: DECISION_COPY[item.key].icon,
      }));
  }

  function metric(index, key, label) {
    const item = index[key] || {};
    return {
      label,
      value: item.value == null ? '—' : item.value,
    };
  }

  function cardTone(index, keys) {
    return keys.some(key => index[key] && index[key].tone === 'warning') ? 'warning' : 'neutral';
  }

  function summaryCards(items) {
    const index = indexMetrics(items);
    return [
      {
        key: 'transit',
        title: 'Transit international',
        subtitle: 'Expédition → transit confirmé',
        icon: 'T',
        tone: cardTone(index, ['transit-ready']),
        metrics: [
          metric(index, 'transit-ready', 'À mettre en transit'),
          metric(index, 'transit-active', 'En transit'),
        ],
      },
      {
        key: 'customs',
        title: 'Douane',
        subtitle: 'Rattachement → déclaration',
        icon: 'D',
        tone: cardTone(index, ['customs-candidates', 'customs-pending']),
        metrics: [
          metric(index, 'customs-candidates', 'À rattacher'),
          metric(index, 'customs-pending', 'À déclarer'),
          metric(index, 'customs-declared', 'Déclarées'),
        ],
      },
    ];
  }

  function renderMetricOverview(container, items, decisionUi, doc) {
    if (!container || typeof container.replaceChildren !== 'function') {
      throw new TypeError('shipping_customs_decision_container_invalid');
    }
    if (!decisionUi || !decisionUi.DecisionStrip || !decisionUi.SummaryCards) {
      throw new Error('shipping_customs_decision_primitives_missing');
    }
    const documentRef = doc || container.ownerDocument;
    if (!documentRef || typeof documentRef.createElement !== 'function') {
      throw new Error('shipping_customs_decision_document_missing');
    }

    container.replaceChildren();
    container.className = 'kmc-workspace-metrics kmc-workspace-decision-overview';
    container.setAttribute('data-workspace-visual', 'decision-first-v1');
    container.setAttribute('data-workspace-kind', 'shipping-customs');

    const heading = documentRef.createElement('div');
    heading.className = 'kmc-workspace-decision-heading';
    heading.appendChild(text(documentRef, 'h2', 'kmc-decision-dashboard-section-title', 'Flux à traiter'));
    heading.appendChild(text(
      documentRef,
      'p',
      'kmc-decision-dashboard-section-copy',
      'Lecture des états transit et douane fournis par le serveur, sans délai cible, score de blocage ni conformité documentaire inventés.'
    ));
    container.appendChild(heading);

    const decisions = decisionItems(items);
    if (decisions.length) {
      const host = documentRef.createElement('div');
      decisionUi.DecisionStrip.render(host, { items: decisions });
      container.appendChild(host);
    }

    const summaryHost = documentRef.createElement('div');
    decisionUi.SummaryCards.render(summaryHost, { items: summaryCards(items) });
    container.appendChild(summaryHost);
    return container;
  }

  function decorateUi(ui, decisionUi, doc) {
    if (!ui || !ui.MetricStrip || typeof ui.MetricStrip.render !== 'function') return ui;
    if (!decisionUi || !decisionUi.DecisionStrip || !decisionUi.SummaryCards) return ui;

    return Object.freeze({
      ...ui,
      MetricStrip: Object.freeze({
        ...ui.MetricStrip,
        render(container, config = {}) {
          return renderMetricOverview(container, config.items, decisionUi, doc);
        },
      }),
    });
  }

  function enhance(base, decisionUi) {
    if (!base || typeof base.mount !== 'function' || typeof base.metricItems !== 'function') {
      throw new Error('shipping_customs_decision_base_missing');
    }
    const baseMount = base.mount;
    const enhanced = {
      ...base,
      mount(options) {
        return Promise.resolve(baseMount({
          ...options,
          ui: decorateUi(options && options.ui, decisionUi, options && options.document),
        })).then(result => result);
      },
      projectDecisionItems(summary) {
        return decisionItems(base.metricItems(summary));
      },
      projectSummaryCards(summary) {
        return summaryCards(base.metricItems(summary));
      },
    };
    return Object.freeze(enhanced);
  }

  return Object.freeze({
    DECISION_COPY,
    indexMetrics,
    decisionItems,
    summaryCards,
    renderMetricOverview,
    decorateUi,
    enhance,
  });
});
