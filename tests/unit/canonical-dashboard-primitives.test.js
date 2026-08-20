/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createPrimitives } = require('../../public/dashboards/canonical/js/primitives');

const ROOT = path.join(__dirname, '..', '..');
const SOURCE = path.join(ROOT, 'public', 'dashboards', 'canonical', 'js', 'primitives.js');

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

function container(doc) {
  return doc.createElement('div');
}

describe('LOT 2A-CANON — primitives dashboard', () => {
  test('expose exactement la liste V1 fermée', () => {
    const ui = createPrimitives(fakeDocument());
    expect(Object.keys(ui)).toEqual([
      'UIState',
      'FilterBar',
      'Section',
      'MetricStrip',
      'AlertPanel',
      'DataTable',
      'ChartPanel',
    ]);
    expect(Object.isFrozen(ui)).toBe(true);
  });

  test('reste purement présentation : zéro API, zéro legacy, zéro innerHTML', () => {
    const source = fs.readFileSync(SOURCE, 'utf8');
    expect(source).not.toMatch(/\/api\//);
    expect(source).not.toMatch(/dashboards\/admin(?:-legacy)?\//);
    expect(source).not.toMatch(/\.innerHTML\b/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });

  test('UIState rend les trois états canoniques', () => {
    const doc = fakeDocument();
    const { UIState } = createPrimitives(doc);

    const loading = UIState.loading();
    const empty = UIState.empty('Rien ici');
    const error = UIState.error('Erreur test');

    expect(loading.attributes['data-ui-state']).toBe('loading');
    expect(loading.children[0].className).toBe('kmc-spinner');
    expect(empty.attributes['data-ui-state']).toBe('empty');
    expect(empty.children[0].textContent).toBe('Rien ici');
    expect(error.attributes.role).toBe('alert');
  });

  test('FilterBar délègue la valeur sans créer de store parallèle', () => {
    const doc = fakeDocument();
    const { FilterBar } = createPrimitives(doc);
    const host = container(doc);
    const onChange = jest.fn();

    FilterBar.render(host, {
      fields: [{ key: 'country', label: 'Pays', options: ['KM', 'CG'] }],
      values: { country: 'KM' },
      onChange,
    });

    const form = host.children[0];
    const select = form.children[0].children[1];
    expect(select.value).toBe('KM');
    select.listeners.change({ target: { value: 'CG' } });
    expect(onChange).toHaveBeenCalledWith('country', 'CG');
  });

  test('MetricStrip affiche des valeurs fournies sans les recalculer', () => {
    const doc = fakeDocument();
    const { MetricStrip } = createPrimitives(doc);
    const host = container(doc);

    MetricStrip.render(host, {
      items: [{ key: 'revenue', label: 'CA', value: '1 250 000 KMF', tone: 'positive' }],
    });

    const card = host.children[0].children[0];
    expect(card.attributes['data-metric-key']).toBe('revenue');
    expect(card.children[1].textContent).toBe('1 250 000 KMF');
    expect(card.className).toContain('is-positive');
  });

  test('DataTable autorise seulement un formatage de présentation', () => {
    const doc = fakeDocument();
    const { DataTable } = createPrimitives(doc);
    const host = container(doc);

    DataTable.render(host, {
      columns: [
        { key: 'label', label: 'Libellé' },
        { key: 'amount', label: 'Montant', align: 'right', format: value => `${value} KMF` },
      ],
      rows: [{ label: 'Commande', amount: 5000 }],
    });

    const table = host.children[0].children[0];
    const bodyRow = table.children[1].children[0];
    expect(bodyRow.children[0].textContent).toBe('Commande');
    expect(bodyRow.children[1].textContent).toBe('5000 KMF');
  });

  test('ChartPanel expose un slot et ne choisit aucun moteur graphique', () => {
    const doc = fakeDocument();
    const { ChartPanel } = createPrimitives(doc);
    const host = container(doc);

    const built = ChartPanel.render(host, { title: 'Trajectoire' });
    expect(built.slot.attributes['data-chart-slot']).toBe('');
    expect(host.children[0].attributes['data-chart-panel']).toBe('');
  });
});
