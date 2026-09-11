/**
 * @komerce-arch
 * @role          canonical-dashboard-decision-primitives
 * @domain        admin-dashboard
 * @layer         ui-component
 * @criticality   medium
 * @inputs        presentation_only_decision_data
 * @outputs       decision_first_dashboard_dom
 * @depends       none
 * @used-by       canonical decision-first dashboards
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, decision_first_dashboard_visuals
 * @impact-areas  admin-dashboard
 * @version       2026-09
 */

'use strict';

(function initDecisionPrimitives(root, factory) {
  'use strict';

  if (typeof module === 'object' && module.exports) {
    module.exports = { createDecisionPrimitives: factory };
  }

  if (root && root.document) {
    root.KomerceDecisionUI = factory(root.document);
  }
})(typeof window !== 'undefined' ? window : null, function createDecisionPrimitives(defaultDocument) {
  'use strict';

  const TONES = new Set(['neutral', 'positive', 'warning', 'critical', 'info', 'violet']);

  function requireContainer(container, label) {
    if (!container || typeof container.replaceChildren !== 'function' || typeof container.appendChild !== 'function') {
      throw new TypeError(`${label}: container DOM invalide`);
    }
    return container;
  }

  function documentFor(container) {
    const doc = container && container.ownerDocument ? container.ownerDocument : defaultDocument;
    if (!doc || typeof doc.createElement !== 'function') throw new Error('Decision UI: document DOM indisponible');
    return doc;
  }

  function clear(container, label) {
    requireContainer(container, label);
    container.replaceChildren();
    return container;
  }

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function tone(value) {
    return TONES.has(value) ? value : 'neutral';
  }

  function link(doc, href, label, className) {
    if (!href) return null;
    const node = text(doc, 'a', className || 'kmc-decision-link', label || 'Voir');
    node.setAttribute('href', String(href));
    return node;
  }

  function optional(container, node) {
    if (node) container.appendChild(node);
  }

  const DecisionStrip = Object.freeze({
    render(container, config = {}) {
      clear(container, 'DecisionStrip');
      const doc = documentFor(container);
      const items = Array.isArray(config.items) ? config.items.slice(0, 4) : [];
      const strip = doc.createElement('section');
      strip.className = 'kmc-decision-strip';
      strip.setAttribute('data-decision-strip', '');

      items.forEach(item => {
        const card = doc.createElement('article');
        card.className = `kmc-decision-card is-${tone(item && item.tone)}`;
        if (item && item.key) card.setAttribute('data-decision-key', String(item.key));

        const heading = doc.createElement('div');
        heading.className = 'kmc-decision-card-heading';
        heading.appendChild(text(doc, 'span', 'kmc-decision-card-icon', item && item.icon ? item.icon : '•'));
        const copy = doc.createElement('div');
        copy.className = 'kmc-decision-card-copy';
        copy.appendChild(text(doc, 'strong', 'kmc-decision-card-label', item && item.label ? item.label : 'Décision'));
        if (item && item.helper) copy.appendChild(text(doc, 'span', 'kmc-decision-card-helper', item.helper));
        heading.appendChild(copy);
        card.appendChild(heading);

        const valueRow = doc.createElement('div');
        valueRow.className = 'kmc-decision-card-value-row';
        valueRow.appendChild(text(doc, 'strong', 'kmc-decision-card-value', item && item.value != null ? item.value : '—'));
        if (item && item.delta) {
          const delta = text(doc, 'span', `kmc-decision-delta is-${tone(item.deltaTone)}`, item.delta);
          valueRow.appendChild(delta);
        }
        card.appendChild(valueRow);
        optional(card, link(doc, item && item.href, item && item.actionLabel ? item.actionLabel : 'Voir le détail →', 'kmc-decision-link'));
        strip.appendChild(card);
      });

      container.appendChild(strip);
      return strip;
    },
  });

  const SummaryCards = Object.freeze({
    render(container, config = {}) {
      clear(container, 'SummaryCards');
      const doc = documentFor(container);
      const items = Array.isArray(config.items) ? config.items : [];
      const grid = doc.createElement('div');
      grid.className = 'kmc-summary-card-grid';
      grid.setAttribute('data-summary-card-grid', '');

      items.forEach(item => {
        const card = doc.createElement(item && item.href ? 'a' : 'article');
        card.className = `kmc-summary-card is-${tone(item && item.tone)}`;
        if (item && item.href) card.setAttribute('href', String(item.href));
        if (item && item.key) card.setAttribute('data-summary-key', String(item.key));

        const header = doc.createElement('div');
        header.className = 'kmc-summary-card-header';
        header.appendChild(text(doc, 'span', 'kmc-summary-card-icon', item && item.icon ? item.icon : '◫'));
        const copy = doc.createElement('div');
        copy.className = 'kmc-summary-card-copy';
        copy.appendChild(text(doc, 'strong', 'kmc-summary-card-title', item && item.title ? item.title : 'Vue'));
        if (item && item.subtitle) copy.appendChild(text(doc, 'span', 'kmc-summary-card-subtitle', item.subtitle));
        header.appendChild(copy);
        if (item && item.href) header.appendChild(text(doc, 'span', 'kmc-summary-card-arrow', '→'));
        card.appendChild(header);

        const metrics = doc.createElement('div');
        metrics.className = 'kmc-summary-card-metrics';
        (Array.isArray(item && item.metrics) ? item.metrics.slice(0, 4) : []).forEach(metric => {
          const metricNode = doc.createElement('div');
          metricNode.className = 'kmc-summary-card-metric';
          metricNode.appendChild(text(doc, 'strong', 'kmc-summary-card-metric-value', metric && metric.value != null ? metric.value : '—'));
          metricNode.appendChild(text(doc, 'span', 'kmc-summary-card-metric-label', metric && metric.label ? metric.label : 'Indicateur'));
          metrics.appendChild(metricNode);
        });
        if (metrics.children.length) card.appendChild(metrics);
        grid.appendChild(card);
      });

      container.appendChild(grid);
      return grid;
    },
  });

  const FlowStrip = Object.freeze({
    render(container, config = {}) {
      clear(container, 'FlowStrip');
      const doc = documentFor(container);
      const stages = Array.isArray(config.stages) ? config.stages : [];
      const flow = doc.createElement('div');
      flow.className = 'kmc-flow-strip';
      flow.setAttribute('data-flow-strip', '');

      stages.forEach((stage, index) => {
        if (index > 0) flow.appendChild(text(doc, 'span', 'kmc-flow-arrow', '→'));
        const node = doc.createElement(stage && stage.href ? 'a' : 'div');
        node.className = `kmc-flow-stage is-${tone(stage && stage.tone)}`;
        if (stage && stage.href) node.setAttribute('href', String(stage.href));
        node.appendChild(text(doc, 'span', 'kmc-flow-stage-index', index + 1));
        const copy = doc.createElement('div');
        copy.className = 'kmc-flow-stage-copy';
        copy.appendChild(text(doc, 'strong', 'kmc-flow-stage-label', stage && stage.label ? stage.label : 'Étape'));
        if (stage && stage.helper) copy.appendChild(text(doc, 'span', 'kmc-flow-stage-helper', stage.helper));
        node.appendChild(copy);
        flow.appendChild(node);
      });

      container.appendChild(flow);
      return flow;
    },
  });

  const ProgressCards = Object.freeze({
    render(container, config = {}) {
      clear(container, 'ProgressCards');
      const doc = documentFor(container);
      const items = Array.isArray(config.items) ? config.items : [];
      const grid = doc.createElement('div');
      grid.className = 'kmc-progress-grid';
      grid.setAttribute('data-progress-grid', '');

      items.forEach(item => {
        const card = doc.createElement('article');
        card.className = `kmc-progress-card is-${tone(item && item.tone)}`;
        card.appendChild(text(doc, 'span', 'kmc-progress-label', item && item.label ? item.label : 'Progression'));
        card.appendChild(text(doc, 'strong', 'kmc-progress-value', item && item.value != null ? item.value : '—'));
        if (item && item.helper) card.appendChild(text(doc, 'span', 'kmc-progress-helper', item.helper));
        const track = doc.createElement('div');
        track.className = 'kmc-progress-track';
        const bar = doc.createElement('span');
        bar.className = 'kmc-progress-bar';
        const percentage = Number(item && item.percent);
        const bounded = Number.isFinite(percentage) ? Math.max(0, Math.min(100, percentage)) : 0;
        bar.style = bar.style || {};
        bar.style.width = `${bounded}%`;
        track.appendChild(bar);
        card.appendChild(track);
        grid.appendChild(card);
      });

      container.appendChild(grid);
      return grid;
    },
  });

  const Funnel = Object.freeze({
    render(container, config = {}) {
      clear(container, 'Funnel');
      const doc = documentFor(container);
      const stages = Array.isArray(config.stages) ? config.stages : [];
      const flow = doc.createElement('div');
      flow.className = 'kmc-funnel';
      flow.setAttribute('data-funnel', '');

      stages.forEach((stage, index) => {
        if (index > 0) flow.appendChild(text(doc, 'span', 'kmc-funnel-arrow', '→'));
        const card = doc.createElement('article');
        card.className = `kmc-funnel-stage is-${tone(stage && stage.tone)}`;
        card.appendChild(text(doc, 'span', 'kmc-funnel-label', stage && stage.label ? stage.label : 'Étape'));
        card.appendChild(text(doc, 'strong', 'kmc-funnel-value', stage && stage.value != null ? stage.value : '—'));
        if (stage && stage.rate != null) card.appendChild(text(doc, 'span', 'kmc-funnel-rate', stage.rate));
        if (stage && stage.loss) card.appendChild(text(doc, 'span', 'kmc-funnel-loss', stage.loss));
        flow.appendChild(card);
      });

      container.appendChild(flow);
      return flow;
    },
  });

  const RankedList = Object.freeze({
    render(container, config = {}) {
      clear(container, 'RankedList');
      const doc = documentFor(container);
      const items = Array.isArray(config.items) ? config.items : [];
      const list = doc.createElement('div');
      list.className = 'kmc-ranked-list';
      list.setAttribute('data-ranked-list', '');

      items.forEach((item, index) => {
        const row = doc.createElement('article');
        row.className = `kmc-ranked-row is-${tone(item && item.tone)}`;
        row.appendChild(text(doc, 'span', 'kmc-ranked-index', index + 1));
        const copy = doc.createElement('div');
        copy.className = 'kmc-ranked-copy';
        copy.appendChild(text(doc, 'strong', 'kmc-ranked-title', item && item.title ? item.title : 'Élément'));
        if (item && item.helper) copy.appendChild(text(doc, 'span', 'kmc-ranked-helper', item.helper));
        row.appendChild(copy);
        if (item && item.value != null) row.appendChild(text(doc, 'strong', 'kmc-ranked-value', item.value));
        optional(row, link(doc, item && item.href, item && item.actionLabel ? item.actionLabel : 'Voir →', 'kmc-ranked-action'));
        list.appendChild(row);
      });

      container.appendChild(list);
      return list;
    },
  });

  const PriorityList = Object.freeze({
    render(container, config = {}) {
      clear(container, 'PriorityList');
      const doc = documentFor(container);
      const items = Array.isArray(config.items) ? config.items.slice(0, 5) : [];
      const list = doc.createElement('div');
      list.className = 'kmc-priority-list';
      list.setAttribute('data-priority-list', '');

      items.forEach((item, index) => {
        const row = doc.createElement('article');
        row.className = `kmc-priority-row is-${tone(item && item.tone)}`;
        row.appendChild(text(doc, 'span', 'kmc-priority-check', item && item.done ? '✓' : String(index + 1)));
        const copy = doc.createElement('div');
        copy.className = 'kmc-priority-copy';
        copy.appendChild(text(doc, 'strong', 'kmc-priority-title', item && item.title ? item.title : 'Action'));
        if (item && item.helper) copy.appendChild(text(doc, 'span', 'kmc-priority-helper', item.helper));
        row.appendChild(copy);
        if (item && item.priority) row.appendChild(text(doc, 'span', 'kmc-priority-badge', item.priority));
        optional(row, link(doc, item && item.href, item && item.actionLabel ? item.actionLabel : 'Ouvrir →', 'kmc-priority-action'));
        list.appendChild(row);
      });

      container.appendChild(list);
      return list;
    },
  });

  const InfoList = Object.freeze({
    render(container, config = {}) {
      clear(container, 'InfoList');
      const doc = documentFor(container);
      const items = Array.isArray(config.items) ? config.items : [];
      const list = doc.createElement('div');
      list.className = 'kmc-info-list';
      list.setAttribute('data-info-list', '');

      items.forEach((item, index) => {
        const row = doc.createElement('article');
        row.className = `kmc-info-row is-${tone(item && item.tone)}`;
        row.appendChild(text(doc, 'span', 'kmc-info-index', item && item.index != null ? item.index : index + 1));
        const copy = doc.createElement('div');
        copy.className = 'kmc-info-copy';
        copy.appendChild(text(doc, 'strong', 'kmc-info-title', item && item.title ? item.title : 'Information'));
        if (item && item.helper) copy.appendChild(text(doc, 'span', 'kmc-info-helper', item.helper));
        row.appendChild(copy);
        optional(row, link(doc, item && item.href, item && item.actionLabel ? item.actionLabel : 'Voir →', 'kmc-info-action'));
        list.appendChild(row);
      });

      container.appendChild(list);
      return list;
    },
  });

  const TrustFooter = Object.freeze({
    render(container, config = {}) {
      clear(container, 'TrustFooter');
      const doc = documentFor(container);
      const footer = doc.createElement('footer');
      footer.className = 'kmc-trust-footer';
      footer.setAttribute('data-trust-footer', '');

      const left = doc.createElement('div');
      left.className = 'kmc-trust-footer-left';
      left.appendChild(text(doc, 'span', 'kmc-trust-dot', '●'));
      left.appendChild(text(doc, 'span', 'kmc-trust-state', config.stateLabel || 'Données à jour'));
      if (config.scopeLabel) left.appendChild(text(doc, 'span', 'kmc-trust-scope', config.scopeLabel));
      footer.appendChild(left);

      const right = doc.createElement('div');
      right.className = 'kmc-trust-footer-right';
      if (config.generatedAt) right.appendChild(text(doc, 'span', 'kmc-trust-meta', `Dernière mise à jour : ${config.generatedAt}`));
      if (config.qualityLabel) right.appendChild(text(doc, 'span', 'kmc-trust-meta', config.qualityLabel));
      if (config.warningLabel) right.appendChild(text(doc, 'span', 'kmc-trust-warning', config.warningLabel));
      footer.appendChild(right);

      container.appendChild(footer);
      return footer;
    },
  });

  return Object.freeze({
    DecisionStrip,
    SummaryCards,
    FlowStrip,
    ProgressCards,
    Funnel,
    RankedList,
    PriorityList,
    InfoList,
    TrustFooter,
  });
});
