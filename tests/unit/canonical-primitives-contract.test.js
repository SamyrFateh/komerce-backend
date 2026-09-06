'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const { createPrimitives } = require('../../public/dashboards/canonical/js/primitives');

function fakeDocument() {
  const doc = {
    createElement(tagName) {
      const node = {
        tagName: String(tagName).toUpperCase(),
        ownerDocument: doc,
        className: '',
        textContent: '',
        attributes: {},
        children: [],
        setAttribute(name, value) { this.attributes[name] = String(value); },
        appendChild(child) { this.children.push(child); return child; },
        replaceChildren(...children) { this.children = children; },
        addEventListener() {},
      };
      return node;
    },
  };
  return doc;
}

describe('Canonical UI primitives contract', () => {
  test('KpiStrip et MetricStrip désignent le même primitive de présentation', () => {
    const ui = createPrimitives(null);

    expect(ui.KpiStrip).toBeDefined();
    expect(ui.MetricStrip).toBeDefined();
    expect(ui.KpiStrip).toBe(ui.MetricStrip);
  });

  test('KpiStrip.create(items) retourne un élément métrique directement montable', () => {
    const ui = createPrimitives(fakeDocument());

    const built = ui.KpiStrip.create([
      { key: 'products', label: 'Produits suivis', value: '12', tone: 'neutral' },
    ]);

    expect(built).toBeDefined();
    expect(built.element).toBeDefined();
    expect(built.element.className).toBe('kmc-metric-strip');
    expect(built.element.attributes['data-metric-strip']).toBe('');
    expect(built.element.children).toHaveLength(1);
    expect(built.element.children[0].attributes['data-metric-key']).toBe('products');
  });
});
