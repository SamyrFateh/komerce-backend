'use strict';

/**
 * tests/unit/check-sku-coverage.test.js
 * Lot 5 — scripts/check-sku-coverage.js
 *
 * Couvre uniquement computeSummary() (fonction pure, agrégation des résultats
 * d'audit produit par produit) — le reste du script (fetchAuditResults, run)
 * fait des I/O DB réelles et n'est pas mocké ici, cf. convention du repo
 * (scripts/ hors périmètre gate:touched-tests).
 */

jest.mock('../../db', () => ({ query: jest.fn(), pool: { end: jest.fn() } }));
jest.mock('../../services/product-admin-service', () => ({
  auditProductSkuReadiness: jest.fn(),
}));

const { computeSummary } = require('../../scripts/check-sku-coverage');

function makeResult(overrides = {}) {
  return {
    product_id:   'p-001',
    product_name: 'Produit',
    has_variants: false,
    already_sku:  false,
    ready:        false,
    reasons:      [],
    ...overrides,
  };
}

describe('computeSummary', () => {
  test('couverture 100% quand tous les produits sont déjà en SKU', () => {
    const results = [
      makeResult({ product_id: 'p1', already_sku: true }),
      makeResult({ product_id: 'p2', already_sku: true }),
    ];
    const summary = computeSummary(results);
    expect(summary.total_active_products).toBe(2);
    expect(summary.already_sku).toBe(2);
    expect(summary.not_ready).toBe(0);
    expect(summary.coverage_pct).toBe(100);
    expect(summary.fallback_removable).toBe(true);
  });

  test('un produit "prêt mais pas basculé" compte comme couvert', () => {
    const results = [
      makeResult({ product_id: 'p1', already_sku: false, ready: true }),
    ];
    const summary = computeSummary(results);
    expect(summary.ready_not_switched).toBe(1);
    expect(summary.not_ready).toBe(0);
    expect(summary.coverage_pct).toBe(100);
    expect(summary.fallback_removable).toBe(true);
  });

  test('un produit non prêt casse la couverture et liste ses raisons', () => {
    const results = [
      makeResult({ product_id: 'p1', already_sku: true }),
      makeResult({
        product_id: 'p2', already_sku: false, ready: false,
        reasons: ['Aucun SKU actif déclaré pour ce produit à variantes'],
      }),
    ];
    const summary = computeSummary(results);
    expect(summary.total_active_products).toBe(2);
    expect(summary.not_ready).toBe(1);
    expect(summary.not_ready_products).toHaveLength(1);
    expect(summary.not_ready_products[0].reasons).toContain(
      'Aucun SKU actif déclaré pour ce produit à variantes'
    );
    expect(summary.coverage_pct).toBe(50);
    expect(summary.fallback_removable).toBe(false);
  });

  test('aucun produit actif → 100% par convention (rien à bloquer)', () => {
    const summary = computeSummary([]);
    expect(summary.total_active_products).toBe(0);
    expect(summary.coverage_pct).toBe(100);
    expect(summary.fallback_removable).toBe(true);
  });

  test('coverage_pct arrondi à 1 décimale', () => {
    // 1 couvert sur 3 → 33.333...% → 33.3
    const results = [
      makeResult({ product_id: 'p1', already_sku: true }),
      makeResult({ product_id: 'p2', already_sku: false, ready: false }),
      makeResult({ product_id: 'p3', already_sku: false, ready: false }),
    ];
    const summary = computeSummary(results);
    expect(summary.coverage_pct).toBe(33.3);
  });
});
