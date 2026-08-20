/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createPrimitives } = require('../../public/dashboards/canonical/js/primitives');
const schemaContract = require('../../public/dashboards/canonical/js/dashboard-schema');
const { createRenderer } = require('../../public/dashboards/canonical/js/dashboard-renderer');

const ROOT = path.join(__dirname, '..', '..');
const SCHEMA_SOURCE = path.join(ROOT, 'public', 'dashboards', 'canonical', 'js', 'dashboard-schema.js');
const RENDERER_SOURCE = path.join(ROOT, 'public', 'dashboards', 'canonical', 'js', 'dashboard-renderer.js');

function fakeDocument() {
  const doc = {
    createElement(tagName) {
      const node = {
        ownerDocument: doc,
        tagName: String(tagName).toUpperCase(),
        children: [],
        attributes: {},
        listeners: {},
        className: '',
        textContent: '',
        value: '',
        name: '',
        type: '',
        placeholder: '',
        appendChild(child) {
          this.children.push(child);
          return child;
        },
        append(...children) {
          children.forEach(child => this.appendChild(child));
        },
        replaceChildren(...children) {
          this.children = [];
          children.forEach(child => this.appendChild(child));
        },
        setAttribute(name, value) {
          this.attributes[name] = String(value);
        },
        addEventListener(name, handler) {
          this.listeners[name] = handler;
        },
      };
      return node;
    },
  };
  return doc;
}

function canonicalSchema() {
  return {
    id: 'test-dashboard',
    title: 'Dashboard test',
    description: 'Contrat 2B',
    filters: [
      { key: 'country', label: 'Pays', options: [{ value: 'KM', label: 'Comores' }, { value: 'CG', label: 'Congo' }] },
    ],
    metrics: {
      source: 'test.summary',
      pick: [
        { key: 'revenue', label: 'CA' },
        { key: 'orders', label: 'Commandes' },
      ],
    },
    alerts: {
      source: 'test.signals',
      title: 'À surveiller',
    },
    sections: [
      {
        id: 'trajectory',
        title: 'Trajectoire',
        type: 'chart',
        source: 'test.trajectory',
      },
      {
        id: 'gaps',
        title: 'Écarts',
        type: 'table',
        source: 'test.gaps',
        columns: [
          { key: 'label', label: 'Libellé' },
          { key: 'value', label: 'Valeur', align: 'right' },
        ],
      },
    ],
    drill: [
      { id: 'commerce', label: 'Commerce', href: '/admin-next?dashboard=commerce' },
    ],
  };
}

function resolvedData() {
  return {
    'test.summary': {
      revenue: { value: '1 250 000 KMF', tone: 'positive', helper: '+8 %' },
      orders: { value: '42' },
    },
    'test.signals': [
      { level: 'warning', title: 'Retard', message: '2 commandes à surveiller' },
    ],
    'test.trajectory': [{ x: 'S1', y: 10 }, { x: 'S2', y: 12 }],
    'test.gaps': [{ label: 'Marge', value: '-2 pts' }],
  };
}

function childByZone(dashboard, zone) {
  return dashboard.children.find(child => child.attributes['data-dashboard-zone'] === zone);
}

describe('LOT 2B-CANON — DashboardSchema', () => {
  test('fige le contrat minimal et les types de sections', () => {
    expect(schemaContract.SECTION_TYPES).toEqual(['chart', 'table']);
    expect(Object.isFrozen(schemaContract.SECTION_TYPES)).toBe(true);

    const schema = schemaContract.validateDashboardSchema(canonicalSchema());
    expect(schema.id).toBe('test-dashboard');
    expect(schema.metrics.source).toBe('test.summary');
    expect(schema.sections.map(section => section.type)).toEqual(['chart', 'table']);
    expect(Object.isFrozen(schema)).toBe(true);
    expect(Object.isFrozen(schema.sections)).toBe(true);
  });

  test('refuse tout type de bloc non canonique', () => {
    const schema = canonicalSchema();
    schema.sections[0].type = 'ranking';
    expect(() => schemaContract.validateDashboardSchema(schema)).toThrow(/type fermé attendu: chart, table/);
  });

  test('rend source obligatoire pour metrics, alerts, chart et table', () => {
    const candidates = [
      schema => { delete schema.metrics.source; },
      schema => { delete schema.alerts.source; },
      schema => { delete schema.sections[0].source; },
      schema => { delete schema.sections[1].source; },
    ];

    candidates.forEach(mutate => {
      const schema = canonicalSchema();
      mutate(schema);
      expect(() => schemaContract.validateDashboardSchema(schema)).toThrow(/source/);
    });
  });

  test('interdit les fonctions et les champs hors contrat', () => {
    const withFunction = canonicalSchema();
    withFunction.sections[1].columns[0].format = value => value;
    expect(() => schemaContract.validateDashboardSchema(withFunction)).toThrow(/fonction interdite/);

    const withUnknown = canonicalSchema();
    withUnknown.sections[0].ranking = true;
    expect(() => schemaContract.validateDashboardSchema(withUnknown)).toThrow(/champ non supporté/);
  });

  test('reste sans API, sans legacy et sans logique exécutable embarquée', () => {
    const source = fs.readFileSync(SCHEMA_SOURCE, 'utf8');
    expect(source).not.toMatch(/\/api\//);
    expect(source).not.toMatch(/dashboards\/admin(?:-legacy)?\//);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\.innerHTML\b/);
  });
});

describe('LOT 2B-CANON — renderer minimal', () => {
  test('rend les cinq zones dans l’ordre canonique sans fetcher', () => {
    const doc = fakeDocument();
    const ui = createPrimitives(doc);
    const renderer = createRenderer({ document: doc, ui });
    const host = doc.createElement('main');
    const onFilterChange = jest.fn();
    const renderChart = jest.fn(({ slot, data }) => {
      const marker = doc.createElement('span');
      marker.textContent = `points:${data.length}`;
      slot.appendChild(marker);
    });

    const result = renderer.render(host, canonicalSchema(), {
      data: resolvedData(),
      filters: { country: 'KM' },
      onFilterChange,
      renderChart,
    });

    expect(result.state).toBe('ready');
    expect(result.element.attributes['data-dashboard-id']).toBe('test-dashboard');
    expect(result.element.children.filter(child => child.attributes['data-dashboard-zone']).map(child => child.attributes['data-dashboard-zone']))
      .toEqual(['filters', 'metrics', 'alerts', 'sections', 'drill']);
    expect(renderChart).toHaveBeenCalledTimes(1);
    expect(renderChart.mock.calls[0][0].section.id).toBe('trajectory');
    expect(renderChart.mock.calls[0][0].data).toEqual(resolvedData()['test.trajectory']);
  });

  test('projette seulement les métriques pickées sans recalcul métier', () => {
    const doc = fakeDocument();
    const renderer = createRenderer({ document: doc, ui: createPrimitives(doc) });
    const host = doc.createElement('main');
    const data = resolvedData();
    data['test.summary'].unused = { value: 'NE DOIT PAS SORTIR' };

    renderer.render(host, canonicalSchema(), { data });

    const dashboard = host.children[0];
    const metricZone = childByZone(dashboard, 'metrics');
    const strip = metricZone.children[0];
    expect(strip.children).toHaveLength(2);
    expect(strip.children[0].children[0].textContent).toBe('CA');
    expect(strip.children[0].children[1].textContent).toBe('1 250 000 KMF');
    expect(strip.children[1].children[1].textContent).toBe('42');
  });

  test('exige que chaque source ait été résolue avant le rendu', () => {
    const doc = fakeDocument();
    const renderer = createRenderer({ document: doc, ui: createPrimitives(doc) });
    const host = doc.createElement('main');
    const data = resolvedData();
    delete data['test.gaps'];

    expect(() => renderer.render(host, canonicalSchema(), { data })).toThrow(/source non résolue test\.gaps/);
  });

  test('délègue loading, empty et error à UIState', () => {
    const doc = fakeDocument();
    const renderer = createRenderer({ document: doc, ui: createPrimitives(doc) });
    const host = doc.createElement('main');

    ['loading', 'empty', 'error'].forEach(state => {
      const result = renderer.render(host, canonicalSchema(), { state, stateMessage: state });
      expect(result.state).toBe(state);
      expect(host.children[0].attributes['data-ui-state']).toBe(state);
    });
  });

  test('ne contient ni API, ni legacy, ni innerHTML, ni moteur graphique', () => {
    const source = fs.readFileSync(RENDERER_SOURCE, 'utf8');
    expect(source).not.toMatch(/\/api\//);
    expect(source).not.toMatch(/dashboards\/admin(?:-legacy)?\//);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\.innerHTML\b/);
    expect(source).not.toMatch(/\bChart\s*\(/);
  });
});
