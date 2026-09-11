/**
 * @komerce-arch
 * @role          canonical-operations-workspace-decision-view
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_operations_workspace_summary, decision_primitives
 * @outputs       decision_first_operations_workspace_overview
 * @depends       operations-workspace, decision-primitives, primitives
 * @used-by       canonical admin Hub / Relais workspace runtime
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_acts_dashboard_observes, dashboard_no_business_recompute, decision_first_dashboard_visuals
 * @impact-areas  admin-dashboard, logistics, inventory, orders, payments
 * @version       2026-09
 */
'use strict';

(function initOperationsWorkspaceDecision(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.KomerceCanonicalOperationsWorkspace && root.KomerceDecisionUI) {
    root.KomerceCanonicalOperationsWorkspace = api.enhance(
      root.KomerceCanonicalOperationsWorkspace,
      root.KomerceDecisionUI
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : null, function createOperationsWorkspaceDecision() {
  'use strict';

  const DECISION_COPY = Object.freeze({
    'hub-order': Object.freeze({
      label: 'Commandes à lancer',
      helper: 'Commandes confirmées à envoyer au sourcing',
      icon: '↗',
    }),
    distribution: Object.freeze({
      label: 'Commandes à répartir',
      helper: 'Commandes non affectées à répartir dans les colis',
      icon: '⇄',
    }),
    ship: Object.freeze({
      label: 'Colis à expédier',
      helper: 'Colis en préparation prêts pour l’expédition',
      icon: '⇢',
    }),
    cash: Object.freeze({
      label: 'Cash à encaisser',
      helper: 'Paiements cash relais en attente de confirmation',
      icon: '¤',
    }),
    receive: Object.freeze({
      label: 'Colis à réceptionner',
      helper: 'Colis expédiés ou en transit à réceptionner au relais',
      icon: '↓',
    }),
    collect: Object.freeze({
      label: 'Colis à remettre',
      helper: 'Colis disponibles à remettre au client',
      icon: '✓',
    }),
    inventory: Object.freeze({
      label: 'Inventaire à affecter',
      helper: 'Articles inventaire à affecter à un colis ouvert',
      icon: '▦',
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
      .filter(item => item && item.tone === 'warning')
      .map(item => {
        const copy = DECISION_COPY[item.key] || {
          label: item.label || item.key || 'À traiter',
          helper: 'File opérationnelle fournie par le serveur',
          icon: '•',
        };
        return {
          key: item.key,
          label: copy.label,
          helper: copy.helper,
          value: item.value == null ? '—' : item.value,
          tone: 'warning',
          icon: copy.icon,
        };
      })
      .slice(0, 4);
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
        key: 'hub',
        title: 'Hub',
        subtitle: 'Commander · répartir · expédier',
        icon: 'H',
        tone: cardTone(index, ['hub-order', 'distribution', 'ship']),
        metrics: [
          metric(index, 'hub-order', 'À commander'),
          metric(index, 'distribution', 'À répartir'),
          metric(index, 'ship', 'À expédier'),
        ],
      },
      {
        key: 'relay',
        title: 'Relais',
        subtitle: 'Encaisser · réceptionner · remettre',
        icon: 'R',
        tone: cardTone(index, ['cash', 'receive', 'collect']),
        metrics: [
          metric(index, 'cash', 'Cash à encaisser'),
          metric(index, 'receive', 'À réceptionner'),
          metric(index, 'collect', 'À remettre'),
        ],
      },
      {
        key: 'inventory',
        title: 'Inventaire',
        subtitle: 'Affecter les articles aux colis ouverts',
        icon: 'I',
        tone: cardTone(index, ['inventory']),
        metrics: [
          metric(index, 'inventory', 'À affecter'),
        ],
      },
    ];
  }

  function renderMetricOverview(container, items, decisionUi, doc) {
    if (!container || typeof container.replaceChildren !== 'function') {
      throw new TypeError('operations_workspace_decision_container_invalid');
    }
    if (!decisionUi || !decisionUi.DecisionStrip || !decisionUi.SummaryCards) {
      throw new Error('operations_workspace_decision_primitives_missing');
    }
    const documentRef = doc || container.ownerDocument;
    if (!documentRef || typeof documentRef.createElement !== 'function') {
      throw new Error('operations_workspace_decision_document_missing');
    }

    container.replaceChildren();
    container.className = 'kmc-workspace-metrics kmc-workspace-decision-overview';
    container.setAttribute('data-workspace-visual', 'decision-first-v1');

    const heading = documentRef.createElement('div');
    heading.className = 'kmc-workspace-decision-heading';
    heading.appendChild(text(documentRef, 'h2', 'kmc-decision-dashboard-section-title', 'À traiter maintenant'));
    heading.appendChild(text(
      documentRef,
      'p',
      'kmc-decision-dashboard-section-copy',
      'Lecture directe des files serveur de ce marché, sans score ni priorité inventés côté navigateur.'
    ));
    container.appendChild(heading);

    const decisions = decisionItems(items);
    if (decisions.length) {
      const decisionHost = documentRef.createElement('div');
      decisionUi.DecisionStrip.render(decisionHost, { items: decisions });
      container.appendChild(decisionHost);
    }

    const summaryHost = documentRef.createElement('div');
    decisionUi.SummaryCards.render(summaryHost, { items: summaryCards(items) });
    container.appendChild(summaryHost);
    return container;
  }

  function decorateUi(ui, decisionUi, doc) {
    if (!ui || !ui.MetricStrip || typeof ui.MetricStrip.render !== 'function') return ui;
    if (!decisionUi || !decisionUi.DecisionStrip || !decisionUi.SummaryCards) return ui;

    const decoratedMetricStrip = Object.freeze({
      ...ui.MetricStrip,
      render(container, config = {}) {
        return renderMetricOverview(container, config.items, decisionUi, doc);
      },
    });

    return Object.freeze({
      ...ui,
      MetricStrip: decoratedMetricStrip,
    });
  }

  function enhance(base, decisionUi) {
    if (!base || typeof base.mount !== 'function') {
      throw new Error('operations_workspace_decision_base_missing');
    }
    const baseMount = base.mount;
    const enhanced = {
      ...base,
      mount(options) {
        return Promise.resolve(baseMount({
          ...options,
          ui: decorateUi(options && options.ui, decisionUi, options && options.document),
        })).then(result => Object.freeze({
          ...result,
          decisionFirst: true,
        }));
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
