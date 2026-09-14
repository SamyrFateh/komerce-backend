/**
 * @komerce-arch
 * @role          canonical-sourcing-workspace-decision-view
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_sourcing_summary, canonical_sourcing_health, decision_primitives
 * @outputs       decision_first_sourcing_overview, sourcing_health_overview
 * @depends       sourcing-workspace, decision-primitives, primitives
 * @used-by       canonical admin Sourcing workspace runtime
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_acts_dashboard_observes, dashboard_no_business_recompute, decision_first_dashboard_visuals, global_sourcing_not_market_scoped, browser_never_recomputes_health_truth
 * @impact-areas  admin-dashboard, sourcing, catalog, purchasing
 * @version       2026-09
 */
'use strict';

(function initSourcingDecision(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.KomerceCanonicalSourcingWorkspace && root.KomerceDecisionUI) {
    root.KomerceCanonicalSourcingWorkspace = api.enhance(
      root.KomerceCanonicalSourcingWorkspace,
      root.KomerceDecisionUI
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : null, function createSourcingDecision() {
  'use strict';

  const DECISION_COPY = Object.freeze({
    scanned: Object.freeze({
      label: 'Candidats scannés à arbitrer',
      helper: 'Le scan est terminé ; promotion, watchlist ou rejet restent des décisions explicites',
      icon: '◇',
    }),
    watchlist: Object.freeze({
      label: 'Candidats en watchlist',
      helper: 'Candidats conservés en observation dans le pipeline sourcing',
      icon: '◎',
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
        key: 'pipeline',
        title: 'Pipeline candidats',
        subtitle: 'Qualifier avant entrée catalogue',
        icon: 'S',
        tone: cardTone(index, ['scanned', 'watchlist']),
        metrics: [
          metric(index, 'candidates', 'Candidats'),
          metric(index, 'scanned', 'Scannés'),
          metric(index, 'watchlist', 'Watchlist'),
        ],
      },
      {
        key: 'catalog',
        title: 'Passage catalogue',
        subtitle: 'Promotion explicite des candidats retenus',
        icon: 'C',
        tone: 'neutral',
        metrics: [
          metric(index, 'promoted', 'Promus catalogue'),
        ],
      },
      {
        key: 'suppliers',
        title: 'Réseau fournisseurs',
        subtitle: 'Partenaires sourcing enregistrés',
        icon: 'F',
        tone: 'neutral',
        metrics: [
          metric(index, 'suppliers', 'Fournisseurs sourcing'),
        ],
      },
    ];
  }

  function renderMetricOverview(container, items, decisionUi, doc) {
    if (!container || typeof container.replaceChildren !== 'function') {
      throw new TypeError('sourcing_decision_container_invalid');
    }
    if (!decisionUi || !decisionUi.DecisionStrip || !decisionUi.SummaryCards) {
      throw new Error('sourcing_decision_primitives_missing');
    }
    const documentRef = doc || container.ownerDocument;
    if (!documentRef || typeof documentRef.createElement !== 'function') {
      throw new Error('sourcing_decision_document_missing');
    }

    container.replaceChildren();
    container.className = 'kmc-workspace-metrics kmc-workspace-decision-overview';
    container.setAttribute('data-workspace-visual', 'decision-first-v1');
    container.setAttribute('data-workspace-kind', 'sourcing');

    const heading = documentRef.createElement('div');
    heading.className = 'kmc-workspace-decision-heading';
    heading.appendChild(text(documentRef, 'h2', 'kmc-decision-dashboard-section-title', 'À arbitrer'));
    heading.appendChild(text(
      documentRef,
      'p',
      'kmc-decision-dashboard-section-copy',
      'Lecture du pipeline global sourcing. Aucun besoin urgent, rupture, retard fournisseur ou seuil de stock n’est déduit côté navigateur.'
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

  function healthTone(status) {
    if (status === 'BROKEN') return 'critical';
    if (status === 'ATTENTION') return 'warning';
    if (status === 'HEALTHY') return 'positive';
    return 'neutral';
  }

  function healthMetrics(health) {
    const state = health && health.state ? health.state : {};
    return [
      { key: 'health', label: 'Santé globale', value: state.global || 'INDISPONIBLE', tone: healthTone(state.global) },
      { key: 'integrity', label: 'Intégrité', value: state.integrity || '—', tone: healthTone(state.integrity) },
      { key: 'performance', label: 'Performance', value: state.performance || '—', tone: healthTone(state.performance) },
      { key: 'blockers', label: 'Blocages', value: String(state.blockers == null ? '—' : state.blockers), tone: Number(state.blockers || 0) > 0 ? 'critical' : 'positive' },
      { key: 'trend', label: 'Tendance', value: state.trend?.status || 'UNKNOWN', tone: 'neutral' },
    ];
  }

  function appendRows(doc, tbody, rows) {
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      row.forEach(value => {
        const td = doc.createElement('td');
        td.textContent = value == null || value === '' ? '—' : String(value);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  function table(doc, headings, rows) {
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    const node = doc.createElement('table');
    node.className = 'kmc-workspace-table';
    const thead = doc.createElement('thead');
    const head = doc.createElement('tr');
    headings.forEach(label => head.appendChild(text(doc, 'th', '', label)));
    thead.appendChild(head);
    node.appendChild(thead);
    const tbody = doc.createElement('tbody');
    appendRows(doc, tbody, rows);
    node.appendChild(tbody);
    wrap.appendChild(node);
    return wrap;
  }

  function renderHealth(rootNode, ui, doc, health) {
    if (!rootNode || !doc) return null;
    const previous = rootNode.querySelector && rootNode.querySelector('[data-sourcing-health]');
    if (previous && previous.parentNode) previous.parentNode.removeChild(previous);

    const section = doc.createElement('section');
    section.className = 'kmc-workspace-section';
    section.setAttribute('data-sourcing-health', 'v1');
    section.appendChild(text(doc, 'h2', 'kmc-decision-dashboard-section-title', 'Santé & autorité Sourcing'));
    section.appendChild(text(
      doc,
      'p',
      'kmc-decision-dashboard-section-copy',
      'ÉTAT → AGRÉGATS → EXCEPTIONS → DRILL-DOWN → RAW. Rouge signifie invariant rompu ou risque de mélange.'
    ));

    if (!health) {
      section.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Santé Sourcing indisponible. Aucun état n’est déduit côté navigateur.'));
    } else {
      if (ui && ui.MetricStrip && typeof ui.MetricStrip.render === 'function') {
        const metricsHost = doc.createElement('div');
        metricsHost.className = 'kmc-workspace-metrics';
        ui.MetricStrip.render(metricsHost, { items: healthMetrics(health) });
        section.appendChild(metricsHost);
      }

      if (health.state?.trend?.label) {
        section.appendChild(text(doc, 'p', 'kmc-decision-dashboard-section-copy', health.state.trend.label));
      }

      section.appendChild(table(doc, ['Agrégat', 'Valeur'], Object.entries(health.aggregates || {})));

      const exceptions = Array.isArray(health.exceptions) ? health.exceptions : [];
      if (exceptions.length) {
        section.appendChild(table(doc, ['Sévérité', 'Code', 'Lecture'], exceptions.map(item => [item.severity, item.code, item.label])));
      } else {
        section.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucune exception remontée par le backend.'));
      }

      const authority = health.authority || {};
      section.appendChild(table(doc, ['Autorité', 'État final'], [
        ['Product', authority.product_authority],
        ['Offer', authority.offer_authority],
        ['Unit', authority.unit_authority],
        ['Purchasing identity', authority.purchasing_identity_authority],
        ['Selection', authority.selection_authority],
        ['Supplier side effect', authority.supplier_order_side_effect],
        ['Hub routing', authority.hub_routing_authority],
      ]));

      const retirementRows = [];
      Object.entries(authority.retirement_matrix || {}).forEach(([disposition, items]) => {
        (Array.isArray(items) ? items : []).forEach(item => retirementRows.push([disposition, item.component, item.reason]));
      });
      section.appendChild(table(doc, ['Disposition', 'Composant', 'Raison'], retirementRows));

      const raw = doc.createElement('details');
      raw.appendChild(text(doc, 'summary', '', 'Audit brut'));
      raw.appendChild(text(doc, 'pre', 'kmc-workspace-empty', JSON.stringify(health.raw || {}, null, 2)));
      section.appendChild(raw);
    }

    const reference = rootNode.children && rootNode.children.length > 1 ? rootNode.children[1] : null;
    if (reference && typeof rootNode.insertBefore === 'function') rootNode.insertBefore(section, reference);
    else rootNode.appendChild(section);
    return section;
  }

  function enhance(base, decisionUi) {
    if (!base || typeof base.mount !== 'function' || typeof base.metricItems !== 'function') {
      throw new Error('sourcing_decision_base_missing');
    }
    const baseMount = base.mount;
    return Object.freeze({
      ...base,
      mount(options) {
        return Promise.resolve(baseMount({
          ...options,
          ui: decorateUi(options && options.ui, decisionUi, options && options.document),
        })).then(result => {
          renderHealth(options && options.root, options && options.ui, options && options.document, result && result.health);
          return result;
        });
      },
      projectDecisionItems(summary) {
        return decisionItems(base.metricItems(summary));
      },
      projectSummaryCards(summary) {
        return summaryCards(base.metricItems(summary));
      },
      projectHealthMetrics(health) {
        return healthMetrics(health);
      },
    });
  }

  return Object.freeze({
    DECISION_COPY,
    indexMetrics,
    decisionItems,
    summaryCards,
    renderMetricOverview,
    decorateUi,
    healthMetrics,
    renderHealth,
    enhance,
  });
});