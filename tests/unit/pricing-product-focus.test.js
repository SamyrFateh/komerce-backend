'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

describe('Pricing focused product action surface', () => {
  beforeEach(() => {
    jest.resetModules();
    globalThis.location = { search: '', href: 'https://komerce.test/admin/workspaces/pricing' };
  });

  afterEach(() => {
    delete globalThis.location;
    delete globalThis.KomercePricingProductFocus;
  });

  test('la recommandation n est applicable que si elle vient du moteur et connait le cout achat', () => {
    const focus = require('../../public/dashboards/canonical/js/pricing-product-focus');

    expect(focus.canApplyRecommendation({
      source_of_truth: 'pricing-engine',
      recommended_price_kmf: 12000,
      data_quality: { sources: { purchase_price: 'supplier' } },
    })).toBe(true);

    expect(focus.canApplyRecommendation({
      source_of_truth: 'pricing-engine',
      recommended_price_kmf: 12000,
      data_quality: { sources: { purchase_price: 'missing' } },
    })).toBe(false);

    expect(focus.canApplyRecommendation({
      source_of_truth: 'browser',
      recommended_price_kmf: 12000,
      data_quality: { sources: { purchase_price: 'supplier' } },
    })).toBe(false);
  });

  test('le body applique exactement le prix et le plancher produits par le moteur', () => {
    const focus = require('../../public/dashboards/canonical/js/pricing-product-focus');
    expect(focus.applyBody({
      recommended_price_kmf: 12345,
      minimum_safe_price_kmf: 11000,
    })).toEqual({
      price_kmf: 12345,
      survival_price_kmf: 11000,
      source: 'canonical_pricing_workspace',
    });
  });

  test('product_ref explicite prime et le retour reste limite a admin', () => {
    globalThis.location.search = '?product_ref=KPR-OLD&return_to=%2Fadmin%2Fworkspaces%2Fcatalog%3Fproduct_ref%3DKPR-131959';
    const focus = require('../../public/dashboards/canonical/js/pricing-product-focus');

    expect(focus.requestedProductRef({ requestedProductRef: 'KPR-131959' })).toBe('KPR-131959');
    expect(focus.requestedReturnTo('KPR-131959')).toBe('/admin/workspaces/catalog?product_ref=KPR-131959');

    globalThis.location.search = '?return_to=https%3A%2F%2Fevil.example%2F';
    expect(focus.requestedReturnTo('KPR-131959')).toBe('/admin/workspaces/catalog?product_ref=KPR-131959');
  });

  test('la couche cible reutilise les APIs Pricing sans ajouter de calcul metier', () => {
    const source = read('public/dashboards/canonical/js/pricing-product-focus.js');
    expect(source).toContain("`${endpoint}/simulate`");
    expect(source).toContain("/apply-price");
    expect(source).toContain("workspace.jsonRequest");
    expect(source).toContain("result.source_of_truth === 'pricing-engine'");
    expect(source).not.toContain('minimum_safe_price_kmf =');
    expect(source).not.toContain('recommended_price_kmf =');
  });

  test('runtime charge la couche action apres la vue decisionnelle read-only', () => {
    const index = read('public/dashboards/canonical/index.html');
    const decisionSource = read('public/dashboards/canonical/js/pricing-workspace-decision.js');
    const decisionIndex = index.indexOf('/dashboards/canonical/js/pricing-workspace-decision.js?v=261009-2');
    const focusIndex = index.indexOf('/dashboards/canonical/js/pricing-product-focus.js?v=261010-6');

    expect(decisionIndex).toBeGreaterThanOrEqual(0);
    expect(focusIndex).toBeGreaterThan(decisionIndex);
    expect(decisionSource).not.toMatch(/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/);
  });
});
