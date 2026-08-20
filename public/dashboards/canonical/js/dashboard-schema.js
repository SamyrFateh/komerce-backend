/**
 * @komerce-arch
 * @role          canonical-dashboard-schema
 * @domain        admin-dashboard
 * @layer         ui-contract
 * @criticality   medium
 * @inputs        dashboard_schema
 * @outputs       validated_dashboard_schema
 * @depends       none
 * @used-by       canonical dashboard renderer
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_schema_closed_types, dashboard_no_business_recompute
 * @impact-areas  admin-dashboard
 * @version       2026-08
 */

'use strict';

(function initDashboardSchema(root, factory) {
  'use strict';

  const contract = factory();
  if (typeof module === 'object' && module.exports) module.exports = contract;
  if (root) root.KomerceDashboardSchema = contract;
})(typeof window !== 'undefined' ? window : null, function dashboardSchemaFactory() {
  'use strict';

  const SECTION_TYPES = Object.freeze(['chart', 'table']);
  const ALIGNMENTS = Object.freeze(['left', 'center', 'right']);
  const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
  const SOURCE_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
  const ROOT_KEYS = new Set(['id', 'title', 'description', 'filters', 'metrics', 'alerts', 'sections', 'drill']);
  const FILTER_KEYS = new Set(['key', 'label', 'type', 'placeholder', 'options']);
  const METRICS_KEYS = new Set(['source', 'pick']);
  const METRIC_PICK_KEYS = new Set(['key', 'label']);
  const ALERT_KEYS = new Set(['source', 'title', 'emptyText']);
  const SECTION_KEYS = new Set(['id', 'title', 'description', 'type', 'source', 'columns', 'emptyText']);
  const COLUMN_KEYS = new Set(['key', 'label', 'align']);
  const DRILL_KEYS = new Set(['id', 'label', 'href']);

  class DashboardSchemaError extends Error {
    constructor(message, path) {
      super(`${path}: ${message}`);
      this.name = 'DashboardSchemaError';
      this.path = path;
    }
  }

  function fail(path, message) {
    throw new DashboardSchemaError(message, path);
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function objectAt(value, path) {
    if (!isPlainObject(value)) fail(path, 'objet attendu');
    return value;
  }

  function onlyKeys(value, allowed, path) {
    Object.keys(value).forEach(key => {
      if (!allowed.has(key)) fail(`${path}.${key}`, 'champ non supporté');
    });
  }

  function requiredString(value, path) {
    if (typeof value !== 'string' || !value.trim()) fail(path, 'chaîne non vide requise');
    return value.trim();
  }

  function optionalString(value, path) {
    if (value == null) return undefined;
    return requiredString(value, path);
  }

  function id(value, path) {
    const normalized = requiredString(value, path);
    if (!ID_PATTERN.test(normalized)) fail(path, 'identifiant invalide');
    return normalized;
  }

  function source(value, path) {
    const normalized = requiredString(value, path);
    if (!SOURCE_PATTERN.test(normalized)) fail(path, 'source canonique attendue au format domaine.nom');
    return normalized;
  }

  function assertNoFunctions(value, path) {
    if (typeof value === 'function') fail(path, 'fonction interdite dans DashboardSchema');
    if (Array.isArray(value)) {
      value.forEach((item, index) => assertNoFunctions(item, `${path}[${index}]`));
      return;
    }
    if (isPlainObject(value)) {
      Object.entries(value).forEach(([key, item]) => assertNoFunctions(item, `${path}.${key}`));
    }
  }

  function normalizeOption(option, path) {
    if (typeof option === 'string' || typeof option === 'number' || typeof option === 'boolean') {
      return Object.freeze({ value: String(option), label: String(option) });
    }
    const item = objectAt(option, path);
    onlyKeys(item, new Set(['value', 'label']), path);
    if (!Object.prototype.hasOwnProperty.call(item, 'value')) fail(`${path}.value`, 'valeur requise');
    const value = String(item.value);
    const label = optionalString(item.label, `${path}.label`) || value;
    return Object.freeze({ value, label });
  }

  function normalizeFilter(filter, index) {
    const path = `dashboard.filters[${index}]`;
    const item = objectAt(filter, path);
    onlyKeys(item, FILTER_KEYS, path);
    const key = id(item.key, `${path}.key`);
    const label = optionalString(item.label, `${path}.label`) || key;
    const type = optionalString(item.type, `${path}.type`) || 'text';
    const placeholder = optionalString(item.placeholder, `${path}.placeholder`);
    const options = item.options == null
      ? undefined
      : (() => {
          if (!Array.isArray(item.options)) fail(`${path}.options`, 'tableau attendu');
          return Object.freeze(item.options.map((option, optionIndex) => normalizeOption(option, `${path}.options[${optionIndex}]`)));
        })();

    return Object.freeze({ key, label, type, ...(placeholder ? { placeholder } : {}), ...(options ? { options } : {}) });
  }

  function normalizeMetricPick(item, index) {
    const path = `dashboard.metrics.pick[${index}]`;
    const pick = objectAt(item, path);
    onlyKeys(pick, METRIC_PICK_KEYS, path);
    const key = id(pick.key, `${path}.key`);
    const label = optionalString(pick.label, `${path}.label`) || key;
    return Object.freeze({ key, label });
  }

  function normalizeMetrics(metrics) {
    if (metrics == null) return undefined;
    const path = 'dashboard.metrics';
    const item = objectAt(metrics, path);
    onlyKeys(item, METRICS_KEYS, path);
    const resolvedSource = source(item.source, `${path}.source`);
    if (!Array.isArray(item.pick) || !item.pick.length) fail(`${path}.pick`, 'au moins une métrique requise');
    const pick = Object.freeze(item.pick.map(normalizeMetricPick));
    return Object.freeze({ source: resolvedSource, pick });
  }

  function normalizeAlerts(alerts) {
    if (alerts == null) return undefined;
    const path = 'dashboard.alerts';
    const item = objectAt(alerts, path);
    onlyKeys(item, ALERT_KEYS, path);
    return Object.freeze({
      source: source(item.source, `${path}.source`),
      ...(item.title ? { title: requiredString(item.title, `${path}.title`) } : {}),
      ...(item.emptyText ? { emptyText: requiredString(item.emptyText, `${path}.emptyText`) } : {}),
    });
  }

  function normalizeColumn(column, sectionIndex, columnIndex) {
    const path = `dashboard.sections[${sectionIndex}].columns[${columnIndex}]`;
    const item = objectAt(column, path);
    onlyKeys(item, COLUMN_KEYS, path);
    const align = item.align == null ? undefined : requiredString(item.align, `${path}.align`);
    if (align && !ALIGNMENTS.includes(align)) fail(`${path}.align`, 'alignement non supporté');
    return Object.freeze({
      key: id(item.key, `${path}.key`),
      label: optionalString(item.label, `${path}.label`) || item.key,
      ...(align ? { align } : {}),
    });
  }

  function normalizeSection(section, index) {
    const path = `dashboard.sections[${index}]`;
    const item = objectAt(section, path);
    onlyKeys(item, SECTION_KEYS, path);
    const type = requiredString(item.type, `${path}.type`);
    if (!SECTION_TYPES.includes(type)) fail(`${path}.type`, `type fermé attendu: ${SECTION_TYPES.join(', ')}`);

    const normalized = {
      id: id(item.id, `${path}.id`),
      title: requiredString(item.title, `${path}.title`),
      type,
      source: source(item.source, `${path}.source`),
    };

    const description = optionalString(item.description, `${path}.description`);
    const emptyText = optionalString(item.emptyText, `${path}.emptyText`);
    if (description) normalized.description = description;
    if (emptyText) normalized.emptyText = emptyText;

    if (type === 'table') {
      if (!Array.isArray(item.columns) || !item.columns.length) fail(`${path}.columns`, 'colonnes requises pour une table');
      normalized.columns = Object.freeze(item.columns.map((column, columnIndex) => normalizeColumn(column, index, columnIndex)));
    } else if (item.columns != null) {
      fail(`${path}.columns`, 'colonnes interdites pour un chart');
    }

    return Object.freeze(normalized);
  }

  function normalizeDrill(item, index) {
    const path = `dashboard.drill[${index}]`;
    const drill = objectAt(item, path);
    onlyKeys(drill, DRILL_KEYS, path);
    return Object.freeze({
      id: id(drill.id, `${path}.id`),
      label: requiredString(drill.label, `${path}.label`),
      href: requiredString(drill.href, `${path}.href`),
    });
  }

  function unique(items, getKey, path) {
    const seen = new Set();
    items.forEach((item, index) => {
      const key = getKey(item);
      if (seen.has(key)) fail(`${path}[${index}]`, `doublon ${key}`);
      seen.add(key);
    });
  }

  function validateDashboardSchema(rawSchema) {
    const schema = objectAt(rawSchema, 'dashboard');
    assertNoFunctions(schema, 'dashboard');
    onlyKeys(schema, ROOT_KEYS, 'dashboard');

    const filters = schema.filters == null ? [] : (() => {
      if (!Array.isArray(schema.filters)) fail('dashboard.filters', 'tableau attendu');
      return schema.filters.map(normalizeFilter);
    })();
    const sections = schema.sections == null ? [] : (() => {
      if (!Array.isArray(schema.sections)) fail('dashboard.sections', 'tableau attendu');
      return schema.sections.map(normalizeSection);
    })();
    const drill = schema.drill == null ? [] : (() => {
      if (!Array.isArray(schema.drill)) fail('dashboard.drill', 'tableau attendu');
      return schema.drill.map(normalizeDrill);
    })();

    unique(filters, item => item.key, 'dashboard.filters');
    unique(sections, item => item.id, 'dashboard.sections');
    unique(drill, item => item.id, 'dashboard.drill');

    const normalized = {
      id: id(schema.id, 'dashboard.id'),
      title: optionalString(schema.title, 'dashboard.title') || schema.id,
      ...(schema.description ? { description: requiredString(schema.description, 'dashboard.description') } : {}),
      filters: Object.freeze(filters),
      ...(schema.metrics != null ? { metrics: normalizeMetrics(schema.metrics) } : {}),
      ...(schema.alerts != null ? { alerts: normalizeAlerts(schema.alerts) } : {}),
      sections: Object.freeze(sections),
      drill: Object.freeze(drill),
    };

    return Object.freeze(normalized);
  }

  return Object.freeze({
    SECTION_TYPES,
    DashboardSchemaError,
    validateDashboardSchema,
  });
});
