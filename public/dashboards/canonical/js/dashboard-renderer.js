/**
 * @komerce-arch
 * @role          canonical-dashboard-renderer
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        validated_dashboard_schema, resolved_presentation_data, canonical_primitives
 * @outputs       canonical_dashboard_dom
 * @depends       dashboard-schema, primitives
 * @used-by       canonical admin runtime (LOT 2C+)
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_schema_closed_types, dashboard_no_business_recompute
 * @impact-areas  admin-dashboard
 * @version       2026-08
 */

'use strict';

(function initDashboardRenderer(root, factory) {
  'use strict';

  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./dashboard-schema'));
    return;
  }

  if (root) root.KomerceDashboardRenderer = factory(root.KomerceDashboardSchema);
})(typeof window !== 'undefined' ? window : null, function dashboardRendererFactory(schemaContract) {
  'use strict';

  if (!schemaContract || typeof schemaContract.validateDashboardSchema !== 'function') {
    throw new Error('Canonical renderer: DashboardSchema indisponible');
  }

  const READY_STATE = 'ready';
  const UI_STATES = new Set(['loading', 'empty', 'error']);

  function requireDocument(doc) {
    if (!doc || typeof doc.createElement !== 'function') {
      throw new TypeError('Canonical renderer: document DOM invalide');
    }
    return doc;
  }

  function requireUi(ui) {
    const expected = ['UIState', 'FilterBar', 'Section', 'MetricStrip', 'AlertPanel', 'DataTable', 'ChartPanel'];
    if (!ui || typeof ui !== 'object') throw new TypeError('Canonical renderer: primitives indisponibles');
    expected.forEach(name => {
      if (!ui[name] || typeof ui[name] !== 'object') throw new TypeError(`Canonical renderer: primitive ${name} indisponible`);
    });
    return ui;
  }

  function requireContainer(container) {
    if (!container || typeof container.replaceChildren !== 'function' || typeof container.appendChild !== 'function') {
      throw new TypeError('Canonical renderer: container DOM invalide');
    }
    return container;
  }

  function textElement(doc, tagName, className, value) {
    const node = doc.createElement(tagName);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
  }

  function slot(doc, name) {
    const node = doc.createElement('div');
    node.className = `kmc-dashboard-zone kmc-dashboard-zone-${name}`;
    node.setAttribute('data-dashboard-zone', name);
    return node;
  }

  function resolvedData(context, source) {
    const data = context && context.data;
    if (!data || typeof data !== 'object' || !Object.prototype.hasOwnProperty.call(data, source)) {
      throw new Error(`Canonical renderer: source non résolue ${source}`);
    }
    return data[source];
  }

  function metricItems(schemaMetrics, data) {
    const values = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    return schemaMetrics.pick.map(definition => {
      const resolved = values[definition.key];
      if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
        return {
          key: definition.key,
          label: definition.label,
          value: resolved.value,
          ...(resolved.tone ? { tone: resolved.tone } : {}),
          ...(resolved.helper ? { helper: resolved.helper } : {}),
        };
      }
      return { key: definition.key, label: definition.label, value: resolved };
    });
  }

  function renderHeader(doc, dashboard, schema) {
    const header = doc.createElement('header');
    header.className = 'kmc-dashboard-header';
    header.appendChild(textElement(doc, 'p', 'canonical-eyebrow', 'KOMERCE · ADMIN'));
    header.appendChild(textElement(doc, 'h1', 'kmc-dashboard-title', schema.title));
    if (schema.description) header.appendChild(textElement(doc, 'p', 'kmc-dashboard-description', schema.description));
    dashboard.appendChild(header);
  }

  function renderFilters(doc, ui, dashboard, schema, context) {
    if (!schema.filters.length) return;
    const zone = slot(doc, 'filters');
    ui.FilterBar.render(zone, {
      fields: schema.filters,
      values: context.filters && typeof context.filters === 'object' ? context.filters : {},
      onChange: typeof context.onFilterChange === 'function' ? context.onFilterChange : function noop() {},
    });
    dashboard.appendChild(zone);
  }

  function renderMetrics(doc, ui, dashboard, schema, context) {
    if (!schema.metrics) return;
    const zone = slot(doc, 'metrics');
    ui.MetricStrip.render(zone, {
      items: metricItems(schema.metrics, resolvedData(context, schema.metrics.source)),
    });
    dashboard.appendChild(zone);
  }

  function renderAlerts(doc, ui, dashboard, schema, context) {
    if (!schema.alerts) return;
    const zone = slot(doc, 'alerts');
    const items = resolvedData(context, schema.alerts.source);
    if (items != null && !Array.isArray(items)) {
      throw new TypeError(`Canonical renderer: ${schema.alerts.source} doit résoudre un tableau d'alertes`);
    }
    ui.AlertPanel.render(zone, {
      items: items || [],
      ...(schema.alerts.title ? { title: schema.alerts.title } : {}),
      ...(schema.alerts.emptyText ? { emptyText: schema.alerts.emptyText } : {}),
    });
    dashboard.appendChild(zone);
  }

  function renderTableSection(ui, sectionSlot, section, context) {
    const rows = resolvedData(context, section.source);
    if (rows != null && !Array.isArray(rows)) {
      throw new TypeError(`Canonical renderer: ${section.source} doit résoudre un tableau de lignes`);
    }
    ui.DataTable.render(sectionSlot, {
      columns: section.columns,
      rows: rows || [],
      ...(section.emptyText ? { emptyText: section.emptyText } : {}),
    });
  }

  function renderChartSection(doc, ui, sectionSlot, section, context) {
    const data = resolvedData(context, section.source);
    const chart = ui.ChartPanel.render(sectionSlot, {});
    if (typeof context.renderChart === 'function') {
      context.renderChart({ slot: chart.slot, section, data });
      return;
    }
    chart.slot.appendChild(ui.UIState.empty('Visualisation graphique non branchée'));
  }

  function renderSections(doc, ui, dashboard, schema, context) {
    if (!schema.sections.length) return;
    const zone = slot(doc, 'sections');
    schema.sections.forEach(section => {
      const built = ui.Section.create({
        id: section.id,
        title: section.title,
        ...(section.description ? { description: section.description } : {}),
      });

      if (section.type === 'table') renderTableSection(ui, built.slot, section, context);
      else if (section.type === 'chart') renderChartSection(doc, ui, built.slot, section, context);
      else throw new Error(`Canonical renderer: type non supporté ${section.type}`);

      zone.appendChild(built.element);
    });
    dashboard.appendChild(zone);
  }

  function renderDrill(doc, ui, dashboard, schema) {
    if (!schema.drill.length) return;
    const zone = slot(doc, 'drill');
    const nav = doc.createElement('nav');
    nav.className = 'kmc-dashboard-drill';
    nav.setAttribute('aria-label', 'Approfondir');

    schema.drill.forEach(item => {
      const link = textElement(doc, 'a', 'kmc-dashboard-drill-link', item.label);
      link.setAttribute('href', item.href);
      link.setAttribute('data-drill-id', item.id);
      nav.appendChild(link);
    });

    const built = ui.Section.create({ id: 'drill', title: 'Approfondir', content: nav });
    zone.appendChild(built.element);
    dashboard.appendChild(zone);
  }

  function createRenderer(options = {}) {
    const doc = requireDocument(options.document || (typeof document !== 'undefined' ? document : null));
    const ui = requireUi(options.ui || (typeof window !== 'undefined' ? window.KomerceCanonicalUI : null));

    function render(container, rawSchema, context = {}) {
      requireContainer(container);
      const schema = schemaContract.validateDashboardSchema(rawSchema);
      const state = context.state || READY_STATE;

      container.replaceChildren();
      if (UI_STATES.has(state)) {
        const stateNode = ui.UIState.create(state, context.stateMessage);
        container.appendChild(stateNode);
        return Object.freeze({ element: stateNode, schema, state });
      }
      if (state !== READY_STATE) throw new Error(`Canonical renderer: état inconnu ${state}`);

      const dashboard = doc.createElement('article');
      dashboard.className = 'kmc-dashboard';
      dashboard.setAttribute('data-dashboard-id', schema.id);

      renderHeader(doc, dashboard, schema);
      renderFilters(doc, ui, dashboard, schema, context);
      renderMetrics(doc, ui, dashboard, schema, context);
      renderAlerts(doc, ui, dashboard, schema, context);
      renderSections(doc, ui, dashboard, schema, context);
      renderDrill(doc, ui, dashboard, schema);

      container.appendChild(dashboard);
      return Object.freeze({ element: dashboard, schema, state: READY_STATE });
    }

    return Object.freeze({ render });
  }

  return Object.freeze({ createRenderer });
});
