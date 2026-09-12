'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');
const projection = require('../../public/dashboards/canonical/js/market-catalog-decision');

const ROOT = path.join(__dirname, '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

describe('Catalogue pays decision-first', () => {
  const payload = {
    summary: {
      catalog_products: 10,
      exposed_products: 4,
      hidden_products: 6,
      undecided_products: 3,
      explicit_hidden_products: 3,
      exposed_needs_review: 1,
      exposure_pct: 40,
    },
    exposure: [
      { product_id: 'p1', product_ref: 'KPR-1', product_name: 'Publié propre', commercial_exposure: 'ENABLED', decision_recorded: true, needs_review: false },
      { product_id: 'p2', product_ref: 'KPR-2', product_name: 'Visible à relire', commercial_exposure: 'ENABLED', decision_recorded: true, needs_review: true },
      { product_id: 'p3', product_ref: 'KPR-3', product_name: 'Sans décision', commercial_exposure: 'DISABLED', decision_recorded: false, needs_review: false },
    ],
  };

  test('projette les vraies décisions pays sans transformer tous les produits masqués en problème', () => {
    expect(projection.decisionItems(payload)).toEqual([
      expect.objectContaining({ key: 'undecided', label: 'Sans décision pays', tone: 'warning', value: '3' }),
      expect.objectContaining({ key: 'exposed-review', label: 'Exposés à relire', tone: 'warning', value: '1' }),
    ]);
  });

  test('les KPI viennent du résumé serveur', () => {
    const metrics = projection.metricItems(payload);
    expect(metrics.map(item => item.key)).toEqual(['catalog', 'enabled', 'hidden', 'coverage', 'decided']);
    expect(metrics.find(item => item.key === 'catalog').value).toBe('10');
    expect(metrics.find(item => item.key === 'enabled').value).toBe('4');
    expect(metrics.find(item => item.key === 'coverage').value).toBe('40 %');
    expect(metrics.find(item => item.key === 'decided').value).toBe('7');
  });

  test('distingue absence de décision, masquage explicite et exposition', () => {
    expect(projection.exposureStatus({ commercial_exposure: 'DISABLED', decision_recorded: false })).toEqual({
      label: 'Sans décision · masqué', tone: 'warning',
    });
    expect(projection.exposureStatus({ commercial_exposure: 'DISABLED', decision_recorded: true })).toEqual({
      label: 'Masqué', tone: 'neutral',
    });
    expect(projection.exposureStatus({ commercial_exposure: 'ENABLED', decision_recorded: true, needs_review: false })).toEqual({
      label: 'Exposé', tone: 'positive',
    });
  });

  test('la file prioritaire ne contient que les références réellement à décider ou à relire', () => {
    const rows = projection.priorityRows(payload);
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.title)).toEqual(['Visible à relire', 'Sans décision']);
    expect(rows.map(row => row.priority)).toEqual(['À relire', 'À décider']);
  });

  test('la page charge les primitives partagées et ne recalcule plus le résumé à partir du tableau', () => {
    const html = read('public/dashboards/canonical/market-catalog.html');
    const source = read('public/dashboards/canonical/js/market-catalog.js');
    expect(html).toContain('/dashboards/canonical/js/primitives.js?v=1204');
    expect(html).toContain('/dashboards/canonical/js/decision-primitives.js?v=1601');
    expect(html).toContain('/dashboards/canonical/js/market-catalog-decision.js?v=1612');
    expect(source).toContain('payload.summary');
    expect(source).not.toMatch(/rows\.filter\([^\n]+commercial_exposure/);
    expect(source).toContain('Garder masqué');
    expect(source).not.toMatch(/\bmarket_id\b/);
  });
});
