'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/check-sku-coverage.test.js
 * Lot 5 + rattrapage PDC-8 — scripts/check-sku-coverage.js
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../../services/product-admin-service', () => ({
  auditProductSkuReadiness: jest.fn(),
}));

const {
  DEFAULT_BACKFILL_LIMIT,
  computeSummary,
  parseBackfillArgs,
  inspectBackfillCandidate,
} = require('../../scripts/check-sku-coverage');

function makeResult(overrides = {}) {
  return {
    product_id: 'p-001',
    product_name: 'Produit',
    has_variants: false,
    already_sku: false,
    ready: false,
    reasons: [],
    ...overrides,
  };
}

function makeBackfillRow(contractOverrides = {}, rowOverrides = {}) {
  return {
    candidate_id: 'cand-1',
    product_id: 'prod-1',
    product_name: 'Robe imprimée',
    is_active: true,
    inventory_model: 'LEGACY_VARIANTS',
    normalized_source_contract: {
      schema_version: '2',
      product_name: 'Robe imprimée',
      supplier_name: 'Supplier X',
      currency: 'AED',
      media: [
        { supplier_media_id: 'IMG-1', url: 'https://x/img1.jpg', role: 'PRODUCT' },
      ],
      option_axes: [
        { key: 'couleur', display_name: 'Couleur', values: ['Rouge'] },
      ],
      sellable_units: [
        {
          supplier_sku: 'SKU-1',
          option_values: { couleur: 'Rouge' },
          stock_available: 10,
          media_refs: ['IMG-1'],
        },
      ],
      ...contractOverrides,
    },
    ...rowOverrides,
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
    const results = [
      makeResult({ product_id: 'p1', already_sku: true }),
      makeResult({ product_id: 'p2', already_sku: false, ready: false }),
      makeResult({ product_id: 'p3', already_sku: false, ready: false }),
    ];
    const summary = computeSummary(results);
    expect(summary.coverage_pct).toBe(33.3);
  });
});

describe('backfill PDC-8 — garde-fous CLI', () => {
  test('dry-run, actifs uniquement et aucune bascule SKU par défaut', () => {
    expect(parseBackfillArgs(['--backfill'])).toEqual({
      apply: false,
      switchReady: false,
      includeInactive: false,
      productId: null,
      limit: DEFAULT_BACKFILL_LIMIT,
    });
  });

  test('la bascule inventory_model exige --apply', () => {
    expect(() => parseBackfillArgs(['--backfill', '--switch-ready']))
      .toThrow(/--switch-ready exige --apply/);
  });

  test('parse ciblage produit, inactifs et limite bornée', () => {
    expect(parseBackfillArgs([
      '--backfill', '--apply', '--switch-ready', '--include-inactive',
      '--product-id=prod-42', '--limit', '25',
    ])).toEqual({
      apply: true,
      switchReady: true,
      includeInactive: true,
      productId: 'prod-42',
      limit: 25,
    });
  });

  test('refuse une limite non bornée', () => {
    expect(() => parseBackfillArgs(['--backfill', '--limit', '9999']))
      .toThrow(/entre 1 et 500/);
  });
});

describe('backfill PDC-8 — éligibilité contrat', () => {
  test('reconnaît un contrat V2 riche et mesure les unités en stock', () => {
    expect(inspectBackfillCandidate(makeBackfillRow())).toMatchObject({
      candidate_id: 'cand-1',
      product_id: 'prod-1',
      eligible: true,
      axes: 1,
      sellable_units: 1,
      source_units_with_positive_stock: 1,
    });
  });

  test('refuse un contrat non V2', () => {
    const result = inspectBackfillCandidate(makeBackfillRow({ schema_version: '1' }));
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/schema_version/);
  });

  test('refuse un contrat sans unité vendable', () => {
    const result = inspectBackfillCandidate(makeBackfillRow({ sellable_units: [] }));
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/sellable_units absent ou vide/);
  });

  test('refuse une structure riche incohérente avant toute écriture', () => {
    const result = inspectBackfillCandidate(makeBackfillRow({
      sellable_units: [
        {
          supplier_sku: 'SKU-1',
          option_values: { couleur: 'Rouge' },
          stock_available: 10,
          media_refs: ['IMG-INCONNU'],
        },
      ],
    }));
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/média inconnu/);
  });
});
