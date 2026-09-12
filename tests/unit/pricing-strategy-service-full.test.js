'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/pricing-engine', () => ({ recommend: jest.fn() }));
jest.mock('../../services/catalog-product-mutation-service', () => ({ applyPrice: jest.fn() }));

const pricingEngine = require('../../services/pricing-engine');
const catalogMutation = require('../../services/catalog-product-mutation-service');
const {
  computeCDR,
  contributionAtPrice,
  estimateElasticity,
  getCompetitors,
  addCompetitor,
  softDeleteCompetitor,
  getStrategy,
  applyStrategy,
  getStrategyHistory,
  _assertExplicitStrategyType,
} = require('../../services/pricing-strategy-service');

function canonicalDoctrine(overrides = {}) {
  return {
    variable_cost_complete_kmf: 1200,
    flow_variable_cost_kmf: 1100,
    business_variable_cost_kmf: 100,
    current_price_kmf: 2000,
    contribution_kmf: 800,
    contribution_rate_pct: 40,
    minimum_safe_price_kmf: 1320,
    economic_reference_price_kmf: 1800,
    recommended_price_kmf: 1800,
    recommended_price_authority: 'ECONOMIC_REFERENCE_NOT_MARKET_DECISION',
    structure_allocation_reference_kmf: 300,
    structure_allocation_authority: 'ANALYTICAL_ONLY_NOT_SKU_DEBT',
    fully_loaded_cost_reference_kmf: 1500,
    price_decision_status: 'MARKET_OR_HUMAN_DECISION_REQUIRED',
    pricing_strategy: 'market_bounded',
    strategy_risk: null,
    ...overrides,
  };
}

function makeDb(routes = []) {
  return {
    query: jest.fn(async (sql, params) => {
      for (const [needle, response] of routes) {
        if (sql.includes(needle)) {
          return typeof response === 'function' ? response(params, sql) : response;
        }
      }
      throw new Error('Unmocked SQL: ' + sql.slice(0, 120));
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  pricingEngine.recommend.mockResolvedValue(canonicalDoctrine());
  catalogMutation.applyPrice.mockResolvedValue({ id: 'p1', price_kmf: 2100 });
});

test('computeCDR est désormais un alias de compatibilité vers le moteur canonique, sans N1/N2/N3', async () => {
  const result = await computeCDR({}, {
    category: 'phones', cost_kmf: 900, weight_kg: 1, price_kmf: 2000,
  });

  expect(pricingEngine.recommend).toHaveBeenCalledWith(expect.objectContaining({
    category: 'phones',
    cost_kmf: 900,
    current_price_kmf: 2000,
    pricing_strategy: 'market_bounded',
  }));
  expect(result).toMatchObject({
    variable_cost_complete_kmf: 1200,
    current_contribution_kmf: 800,
    structure_allocation_reference_kmf: 300,
    structure_allocation_authority: 'ANALYTICAL_ONLY_NOT_SKU_DEBT',
    price_decision_status: 'MARKET_OR_HUMAN_DECISION_REQUIRED',
  });
  expect(result).not.toHaveProperty('n1');
  expect(result).not.toHaveProperty('n2');
  expect(result).not.toHaveProperty('n3');
  expect(result).not.toHaveProperty('prix_mecanique_kmf');
});

test('contributionAtPrice calcule la contribution uniquement contre le coût variable', () => {
  expect(contributionAtPrice(1200, 2000)).toEqual({
    contribution_kmf: 800,
    contribution_rate_pct: 40,
  });
  expect(contributionAtPrice(1200, 0)).toEqual({ contribution_kmf: null, contribution_rate_pct: null });
});

test('getStrategy ne propose plus de stratégie mécanique et marque la concurrence globale comme informative', async () => {
  const db = makeDb([
    ['SELECT * FROM products WHERE id', { rows: [{ id: 'p1', category: 'phones', name: 'Phone', cost_kmf: 900, weight_kg: 1, price_kmf: 2000 }] }],
    ['FROM competitor_prices', { rows: [
      { competitor_name: 'A', price_kmf: 1900, observed_at: '2026-09-01', source: 'manual' },
      { competitor_name: 'B', price_kmf: 2100, observed_at: '2026-09-02', source: 'manual' },
    ] }],
    ['FROM price_history', { rows: [] }],
    ['FROM pricing_strategies', { rows: [{ strategy_type: 'legacy_manual', is_active: true }] }],
  ]);

  const result = await getStrategy(db, { product_id: 'p1' });

  expect(result.price_decision_required).toBe(true);
  expect(result.competitor_reference_authority).toBe('GLOBAL_INFORMATIONAL_ONLY_NOT_LOCAL_MARKET_CORRIDOR');
  expect(result.options).not.toHaveProperty('mechanical');
  expect(result.options.competitor_aligned).toMatchObject({
    decision_required: true,
    market_authority: 'NONE_GLOBAL_REFERENCE_ONLY',
    contribution_kmf: expect.any(Number),
  });
  expect(result.cdr).toBe(result.economics);
  expect(result.cdr).not.toHaveProperty('cout_total_kmf');
});

test('getStrategy ne publie pas une référence acquisition sous le plancher variable sécurisé', async () => {
  pricingEngine.recommend.mockResolvedValueOnce(canonicalDoctrine({ minimum_safe_price_kmf: 1950 }));
  const db = makeDb([
    ['SELECT * FROM products WHERE id', { rows: [{ id: 'p1', category: 'phones', name: 'Phone', cost_kmf: 900, weight_kg: 1, price_kmf: 2000 }] }],
    ['FROM competitor_prices', { rows: [{ competitor_name: 'A', price_kmf: 2000, observed_at: '2026-09-01', source: 'manual' }] }],
    ['FROM price_history', { rows: [] }],
    ['FROM pricing_strategies', { rows: [] }],
  ]);

  const result = await getStrategy(db, { product_id: 'p1' });
  expect(result.options).not.toHaveProperty('acquisition_reference');
});

test('les types de stratégie automatiques historiques sont refusés', () => {
  expect(() => _assertExplicitStrategyType('mechanical')).toThrow(/mécanique/i);
  expect(() => _assertExplicitStrategyType('recommended')).toThrow(/mécanique/i);
  expect(_assertExplicitStrategyType('manual_market_decision')).toBe('manual_market_decision');
});

test('applyStrategy refuse un prix produit sous le coût variable complet', async () => {
  pricingEngine.recommend.mockResolvedValueOnce(canonicalDoctrine({ variable_cost_complete_kmf: 1500 }));
  const client = makeDb([
    ['BEGIN', { rows: [] }],
    ['SELECT * FROM products WHERE id', { rows: [{ id: 'p1', category: 'phones', cost_kmf: 900, weight_kg: 1, price_kmf: 2000 }] }],
    ['ROLLBACK', { rows: [] }],
  ]);
  client.release = jest.fn();
  const pool = { getClient: jest.fn().mockResolvedValue(client) };

  await expect(applyStrategy(pool, {
    product_id: 'p1', strategy_type: 'manual_market_decision', final_price_kmf: 1400,
  }, 'u1')).rejects.toMatchObject({ code: 'price_below_variable_cost' });
  expect(catalogMutation.applyPrice).not.toHaveBeenCalled();
  expect(client.release).toHaveBeenCalled();
});

test('applyStrategy applique uniquement une décision humaine explicite et journalise le prix', async () => {
  const queries = [];
  const client = {
    query: jest.fn(async (sql, params) => {
      queries.push(sql);
      if (sql.includes('SELECT * FROM products WHERE id')) {
        return { rows: [{ id: 'p1', category: 'phones', cost_kmf: 900, weight_kg: 1, price_kmf: 2000 }] };
      }
      if (sql.includes('SELECT strategy_type FROM pricing_strategies')) return { rows: [{ strategy_type: 'manual_old' }] };
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  const pool = { getClient: jest.fn().mockResolvedValue(client) };

  const result = await applyStrategy(pool, {
    product_id: 'p1',
    strategy_type: 'manual_market_decision',
    final_price_kmf: 2100,
    reason: 'preuve marché validée',
  }, 'u1');

  expect(catalogMutation.applyPrice).toHaveBeenCalledWith(client, 'p1', 2100);
  expect(result).toMatchObject({
    ok: true,
    strategy_type: 'manual_market_decision',
    final_price_kmf: 2100,
    price_decision_status: 'EXPLICIT_HUMAN_DECISION_APPLIED',
  });
  expect(queries.some(sql => sql.includes('INSERT INTO pricing_strategies'))).toBe(true);
  expect(queries.some(sql => sql.includes('INSERT INTO pricing_strategy_history'))).toBe(true);
  expect(queries.some(sql => sql.includes('INSERT INTO price_history'))).toBe(true);
  expect(queries).toContain('COMMIT');
  expect(client.release).toHaveBeenCalled();
});

test('estimateElasticity conserve le calcul historique sur faits observés', async () => {
  const db = makeDb([
    ['FROM price_history', { rows: [
      { old_price_kmf: 100, new_price_kmf: 110, applied_at: '2026-01-01' },
      { old_price_kmf: 90, new_price_kmf: 100, applied_at: '2025-12-01' },
    ] }],
    ["BETWEEN $2::timestamptz - INTERVAL '30 days'", { rows: [{ nb: 100 }] }],
    ["BETWEEN $2::timestamptz AND $2::timestamptz + INTERVAL '30 days'", { rows: [{ nb: 80 }] }],
  ]);
  const result = await estimateElasticity(db, 'p1');
  expect(result).toMatchObject({ value: -2, interpretation: 'forte', sample_size: 180, is_significant: true });
});

test('CRUD concurrence et historique restent explicites et auditables', async () => {
  const db = makeDb([
    ['SELECT id, competitor_ref', { rows: [{ id: 'c1', competitor_ref: 'ref1', competitor_name: 'A', price_kmf: 2000 }] }],
    ['INSERT INTO competitor_prices', { rows: [{ id: 'c2', competitor_ref: 'ref2', competitor_name: 'B', price_kmf: 2200 }] }],
    ['UPDATE competitor_prices SET is_active', { rows: [] }],
    ['SELECT h.*, u.full_name', { rows: [{ new_strategy_type: 'manual_market_decision' }] }],
  ]);

  expect((await getCompetitors(db, { product_id: 'p1' })).count).toBe(1);
  expect((await addCompetitor(db, { product_id: 'p1', competitor_name: 'B', price_kmf: 2200 })).competitor_ref).toBe('ref2');
  await expect(softDeleteCompetitor(db, 'c1')).resolves.toEqual({ ok: true });
  await expect(getStrategyHistory(db, { product_id: 'p1' })).resolves.toMatchObject({ count: 1 });
});
