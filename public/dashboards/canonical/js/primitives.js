/**
 * @komerce-arch
 * @role          canonical-dashboard-primitives
 * @domain        admin-dashboard
 * @layer         ui-component
 * @criticality   medium
 * @inputs        presentation_data, ui_state, filter_values
 * @outputs       canonical_dashboard_dom
 * @depends       none
 * @used-by       canonical DashboardSchema renderer (LOT 2B+)
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      canonical_admin_no_legacy_imports, dashboard_no_business_recompute
 * @impact-areas  admin-dashboard
 * @version       2026-08
 */

'use strict';

(function initCanonicalPrimitives(root, factory) {
  'use strict';

  if (typeof module === 'object' && module.exports) {
    module.exports = { createPrimitives: factory };
  }

  if (root && root.document) {
    root.KomerceCanonicalUI = factory(root.document);
  }
})(typeof window !== 'undefined' ? window : null, function createPrimitives(defaultDocument) {
  'use strict';

  const STATE_KINDS = new Set(['loading', 'empty', 'error']);
  const TONES = new Set(['neutral', 'positive', 'warning', 'critical']);
  const ALERT_LEVELS = new Set(['info', 'warning', 'critical']);

  function requireContainer(container, label) {
    if (!container || typeof container.replaceChildren !== 'function' || typeof container.appendChild !== 'function') {
      throw new TypeError(`${label}: container DOM invalide`);
    }
    return container;
  }

  function documentFor(container) {
    const doc = container && container.ownerDocument ? container.ownerDocument : defaultDocument;
    if (!doc || typeof doc.createElement !== 'function') {
      throw new Error('Canonical UI: document DOM indisponible');
    }
    return doc;
  }

  function clear(container, label) {
    requireContainer(container, label);
    container.replaceChildren();
    return container;
  }

  function textElement(doc, tag, className, value) {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    if (value != null) element.textContent = String(value);
    return element;
  }

  function appendContent(target, content) {
    if (content == null) return;
    if (typeof content === 'function') {
      content(target);
      return;
    }
    if (content && typeof content === 'object' && typeof target.appendChild === 'function') {
      target.appendChild(content);
      return;
    }
    target.appendChild(textElement(documentFor(target), 'span', '', content));
  }

  function normalizeTone(value) {
    return TONES.has(value) ? value : 'neutral';
  }

  const UIState = Object.freeze({
    create(kind, message) {
      if (!STATE_KINDS.has(kind)) throw new Error(`UIState: état inconnu ${kind}`);
      const doc = defaultDocument;
      if (!doc) throw new Error('UIState: document DOM indisponible');

      const node = doc.createElement('div');
      node.className = `kmc-ui-state is-${kind}`;
      node.setAttribute('data-ui-state', kind);
      node.setAttribute('role', kind === 'error' ? 'alert' : 'status');

      if (kind === 'loading') {
        const spinner = doc.createElement('span');
        spinner.className = 'kmc-spinner';
        spinner.setAttribute('aria-hidden', 'true');
        node.appendChild(spinner);
      }

      const label = textElement(doc, 'span', 'kmc-ui-state-label', message || {
        loading: 'Chargement…',
        empty: 'Aucune donnée',
        error: 'Impossible de charger les données',
      }[kind]);
      node.appendChild(label);
      return node;
    },

    render(container, kind, message) {
      clear(container, 'UIState');
      const doc = documentFor(container);
      const local = createPrimitives(doc).UIState.create(kind, message);
      container.appendChild(local);
      return local;
    },

    loading(message) { return this.create('loading', message); },
    empty(message) { return this.create('empty', message); },
    error(message) { return this.create('error', message); },
  });

  const Section = Object.freeze({
    create(options = {}) {
      if (!defaultDocument) throw new Error('Section: document DOM indisponible');
      const doc = defaultDocument;
      const section = doc.createElement('section');
      section.className = 'kmc-section';
      if (options.id) section.setAttribute('data-section-id', String(options.id));

      if (options.title || options.description) {
        const header = doc.createElement('header');
        header.className = 'kmc-section-header';
        if (options.title) header.appendChild(textElement(doc, 'h2', 'kmc-section-title', options.title));
        if (options.description) header.appendChild(textElement(doc, 'p', 'kmc-section-description', options.description));
        section.appendChild(header);
      }

      const body = doc.createElement('div');
      body.className = 'kmc-section-body';
      body.setAttribute('data-section-slot', '');
      appendContent(body, options.content);
      section.appendChild(body);
      return { element: section, slot: body };
    },

    render(container, options = {}) {
      clear(container, 'Section');
      const doc = documentFor(container);
      const built = createPrimitives(doc).Section.create(options);
      container.appendChild(built.element);
      return built;
    },
  });

  const FilterBar = Object.freeze({
    render(container, config = {}) {
      clear(container, 'FilterBar');
      const doc = documentFor(container);
      const fields = Array.isArray(config.fields) ? config.fields : [];
      const values = config.values && typeof config.values === 'object' ? config.values : {};
      const onChange = typeof config.onChange === 'function' ? config.onChange : function noop() {};

      const form = doc.createElement('div');
      form.className = 'kmc-filter-bar';
      form.setAttribute('data-dashboard-filter-bar', '');

      fields.forEach(field => {
        if (!field || !field.key) throw new Error('FilterBar: chaque filtre requiert une clé');
        const wrapper = doc.createElement('label');
        wrapper.className = 'kmc-filter-field';
        wrapper.setAttribute('data-filter-key', String(field.key));
        wrapper.appendChild(textElement(doc, 'span', 'kmc-filter-label', field.label || field.key));

        let control;
        if (Array.isArray(field.options)) {
          control = doc.createElement('select');
          field.options.forEach(option => {
            const normalized = typeof option === 'object' ? option : { value: option, label: option };
            const optionNode = doc.createElement('option');
            optionNode.value = normalized.value == null ? '' : String(normalized.value);
            optionNode.textContent = normalized.label == null ? optionNode.value : String(normalized.label);
            control.appendChild(optionNode);
          });
        } else {
          control = doc.createElement('input');
          control.type = field.type || 'text';
          if (field.placeholder) control.placeholder = String(field.placeholder);
        }

        control.name = String(field.key);
        control.className = 'kmc-filter-control';
        control.value = values[field.key] == null ? '' : String(values[field.key]);
        control.setAttribute('aria-label', String(field.label || field.key));
        control.addEventListener('change', event => onChange(field.key, event.target.value));
        wrapper.appendChild(control);
        form.appendChild(wrapper);
      });

      container.appendChild(form);
      return form;
    },
  });

  const MetricStrip = Object.freeze({
    render(container, config = {}) {
      clear(container, 'MetricStrip');
      const doc = documentFor(container);
      const items = Array.isArray(config.items) ? config.items : [];
      const strip = doc.createElement('div');
      strip.className = 'kmc-metric-strip';
      strip.setAttribute('data-metric-strip', '');

      items.forEach(item => {
        const card = doc.createElement('article');
        card.className = `kmc-metric-card is-${normalizeTone(item && item.tone)}`;
        if (item && item.key) card.setAttribute('data-metric-key', String(item.key));
        card.appendChild(textElement(doc, 'span', 'kmc-metric-label', item && item.label ? item.label : 'Métrique'));
        card.appendChild(textElement(doc, 'strong', 'kmc-metric-value', item && item.value != null ? item.value : '—'));
        if (item && item.helper) card.appendChild(textElement(doc, 'span', 'kmc-metric-helper', item.helper));
        strip.appendChild(card);
      });

      container.appendChild(strip);
      return strip;
    },
  });

  const AlertPanel = Object.freeze({
    render(container, config = {}) {
      clear(container, 'AlertPanel');
      const doc = documentFor(container);
      const items = Array.isArray(config.items) ? config.items : [];
      const panel = doc.createElement('section');
      panel.className = 'kmc-alert-panel';
      panel.setAttribute('data-alert-panel', '');

      if (config.title) panel.appendChild(textElement(doc, 'h2', 'kmc-alert-panel-title', config.title));

      if (!items.length) {
        panel.appendChild(createPrimitives(doc).UIState.empty(config.emptyText || 'Aucun signal à traiter'));
      } else {
        const list = doc.createElement('div');
        list.className = 'kmc-alert-list';
        items.forEach(item => {
          const level = ALERT_LEVELS.has(item && item.level) ? item.level : 'info';
          const row = doc.createElement('article');
          row.className = `kmc-alert is-${level}`;
          row.setAttribute('data-alert-level', level);

          const copy = doc.createElement('div');
          copy.className = 'kmc-alert-copy';
          copy.appendChild(textElement(doc, 'strong', 'kmc-alert-title', item && (item.title || item.label) ? (item.title || item.label) : 'Signal'));
          if (item && item.message) copy.appendChild(textElement(doc, 'span', 'kmc-alert-message', item.message));
          row.appendChild(copy);

          if (item && item.href) {
            const action = textElement(doc, 'a', 'kmc-alert-action', item.actionLabel || 'Voir');
            action.setAttribute('href', String(item.href));
            row.appendChild(action);
          }
          list.appendChild(row);
        });
        panel.appendChild(list);
      }

      container.appendChild(panel);
      return panel;
    },
  });

  const DataTable = Object.freeze({
    render(container, config = {}) {
      clear(container, 'DataTable');
      const doc = documentFor(container);
      const columns = Array.isArray(config.columns) ? config.columns : [];
      const rows = Array.isArray(config.rows) ? config.rows : [];

      if (!rows.length) {
        const state = createPrimitives(doc).UIState.empty(config.emptyText || 'Aucune donnée');
        container.appendChild(state);
        return state;
      }

      const wrapper = doc.createElement('div');
      wrapper.className = 'kmc-table-wrap';
      const table = doc.createElement('table');
      table.className = 'kmc-data-table';

      const thead = doc.createElement('thead');
      const headRow = doc.createElement('tr');
      columns.forEach(column => {
        const th = textElement(doc, 'th', column && column.align ? `is-${column.align}` : '', column && column.label ? column.label : column.key);
        th.setAttribute('scope', 'col');
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = doc.createElement('tbody');
      rows.forEach(row => {
        const tr = doc.createElement('tr');
        columns.forEach(column => {
          const td = doc.createElement('td');
          if (column && column.align) td.className = `is-${column.align}`;
          const raw = row && column ? row[column.key] : undefined;
          const shown = column && typeof column.format === 'function' ? column.format(raw, row) : raw;
          td.textContent = shown == null || shown === '' ? '—' : String(shown);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrapper.appendChild(table);
      container.appendChild(wrapper);
      return table;
    },
  });

  const ChartPanel = Object.freeze({
    render(container, config = {}) {
      clear(container, 'ChartPanel');
      const doc = documentFor(container);
      const panel = doc.createElement('section');
      panel.className = 'kmc-chart-panel';
      panel.setAttribute('data-chart-panel', '');

      if (config.title || config.description) {
        const header = doc.createElement('header');
        header.className = 'kmc-chart-header';
        if (config.title) header.appendChild(textElement(doc, 'h2', 'kmc-chart-title', config.title));
        if (config.description) header.appendChild(textElement(doc, 'p', 'kmc-chart-description', config.description));
        panel.appendChild(header);
      }

      const slot = doc.createElement('div');
      slot.className = 'kmc-chart-slot';
      slot.setAttribute('data-chart-slot', '');
      appendContent(slot, config.content);
      panel.appendChild(slot);
      container.appendChild(panel);
      return { element: panel, slot };
    },
  });

  return Object.freeze({
    UIState,
    FilterBar,
    Section,
    // Alias contractuel : les workspaces historiques parlent en KPI tandis que
    // le renderer DashboardSchema parle en métriques. Les deux noms désignent
    // strictement le même primitive de présentation, sans logique métier.
    KpiStrip: MetricStrip,
    MetricStrip,
    AlertPanel,
    DataTable,
    ChartPanel,
  });
});
