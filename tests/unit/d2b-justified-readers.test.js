'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn(), pool: {} }));

const costExpectation = require('../../services/cost-allocation/cost-expectation');
const financeCanonical = require('../../services/dashboard-finance-canonical');
const commerce = require('../../services/dashboard-commerce');
const variance = require('../../services/cost-allocation/variance');
const shadow = require('../../services/cost-allocation/real-margin-shadow');
const steering = require('../../services/cost-allocation/product-margin-steering');
const product360 = require('../../services/product-360');
const adminCosting = require('../../routes/admin-costing');

test('les lecteurs de marge sont chargés (prédicat D2b appliqué)', () => {
  for (const m of [financeCanonical, commerce, variance, shadow, steering, product360, adminCosting]) {
    expect(m).toBeDefined();
  }
});

describe('D2b — prédicat canonique de coût réel justifié', () => {
  const ce = costExpectation;
  const fs = require('fs');
  const path = require('path');

  test('justifiedRealSql = réel ET non historique ; notLegacy exclut monthly_recalc sans transformer en zéro', () => {
    expect(ce.justifiedRealSql('a')).toBe("a.is_actual = TRUE AND COALESCE(a.source, '') <> 'monthly_recalc'");
    expect(ce.notLegacyUnjustifiedSql('a')).toBe("COALESCE(a.source, '') <> 'monthly_recalc'");
    expect(ce.realCostPresentSql('o', 'e.t')).toContain(ce.justifiedRealSql('rca'));
  });

  test.each([
    'services/dashboard-finance-canonical.js',
    'services/dashboard-commerce.js',
    'services/cost-allocation/variance.js',
    'services/cost-allocation/real-margin-shadow.js',
    'services/cost-allocation/product-margin-steering.js',
    'services/product-360.js',
    'routes/admin-costing.js',
  ])('%s consomme le prédicat canonique', (rel) => {
    const src = fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
    expect(src).toMatch(/cost-expectation/);
  });

  test('les lecteurs de complétude ne comptent plus is_actual brut (legacy ne rend jamais une marge complète)', () => {
    for (const rel of ['services/dashboard-finance-canonical.js', 'services/dashboard-commerce.js']) {
      const src = fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
      expect(src).not.toMatch(/alc\.is_actual = TRUE/);
    }
  });

  test('shadow : lignes monthly_recalc exclues, signalées, jamais comptées en réel ni en zéro', () => {
    const shadow = require('../../services/cost-allocation/real-margin-shadow');
    const split = shadow._splitReal([
        { cost_type: 'hub', source: 'monthly_recalc', is_actual: true, amount: '1500' },
        { cost_type: 'freight', source: 'customs_shipment', is_actual: true, amount: '200' },
    ]);
    expect(split.legacyExcluded).toBe(1500);
    expect(split.byType.hub).toBeUndefined();
    expect(split.byType.freight.real).toBe(200);
  });
});
