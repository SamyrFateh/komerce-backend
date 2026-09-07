'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));
jest.mock('../../services/pricing-engine', () => ({
  loadGlobalConfig: jest.fn(),
  recommend: jest.fn(),
}));
jest.mock('../../services/pricing-market-decision-policy', () => ({
  evaluateMarketDecision: jest.fn(),
}));
jest.mock('../../utils/currency', () => ({
  projectAmount: jest.fn(),
  roundToMinorUnit: jest.fn((value, minorUnit) => {
    const factor = Math.pow(10, Number(minorUnit) || 0);
    return Math.round(Number(value) * factor) / factor;
  }),
}));

const db = require('../../db');
const pricingEngine = require('../../services/pricing-engine');
const decisionPolicy = require('../../services/pricing-market-decision-policy');
const currency = require('../../utils/currency');
const service = require('../../services/pricing-market-price-service');

const MARKET = Object.freeze({ id: 'market-cm', code: 'CM', currency: 'XAF', minor_unit: 0 });
const PRODUCT = Object.freeze({
  id: 'product-1',
  product_ref: 'KPR-000001',
  name: 'Produit test',
  category: 'phones',
  price_kmf: 20000,
  cost_kmf: 7000,
  weight_kg: 1,
  volume_m3: 0.01,
  is_active: true,
});

function economicTruth(variableCost, cdrComplete) {
  pricingEngine.loadGlobalConfig.mockResolvedValue({ market: 'CM' });
  pricingEngine.recommend.mockResolvedValue({
    variable_cost_complete_kmf: variableCost,
    cdr_complete_kmf: cdrComplete,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  currency.projectAmount.mockImplementation(async value => Number(value));
});

test('un prix au-dessus du CDR est accepté sans consommer le gate de couverture', async () => {
  economicTruth(10000, 14000);
  const result = await service.evaluateDecision(MARKET, PRODUCT, 16000);

  expect(result).toEqual(expect.objectContaining({
    price_amount: 16000,
    currency: 'XAF',
    price_kmf: 16000,
    variable_cost_kmf: 10000,
    cdr_complete_kmf: 14000,
    pricing_zone: 'at_or_above_cdr',
  }));
  expect(decisionPolicy.evaluateMarketDecision).not.toHaveBeenCalled();
});

test('un prix sous le coût variable complet est toujours refusé', async () => {
  economicTruth(10000, 14000);
  await expect(service.evaluateDecision(MARKET, PRODUCT, 9000, { durationDays: 10 }))
    .rejects.toMatchObject({ code: 'pricing_market_price_below_variable_cost', status: 409 });
  expect(decisionPolicy.evaluateMarketDecision).not.toHaveBeenCalled();
});

test('une position sous CDR exige une durée explicite', async () => {
  economicTruth(10000, 14000);
  await expect(service.evaluateDecision(MARKET, PRODUCT, 12000))
    .rejects.toMatchObject({ code: 'pricing_market_price_under_cdr_duration_required', status: 400 });
  expect(decisionPolicy.evaluateMarketDecision).not.toHaveBeenCalled();
});

test('une position sous CDR reste fail-closed si le marché n’est pas autorisé', async () => {
  economicTruth(10000, 14000);
  decisionPolicy.evaluateMarketDecision.mockResolvedValue({
    decision_status: 'UNCOVERED',
    authorization: 'DENY_NEW_UNDER_CDR_POSITION',
    reason: 'COVERAGE_THRESHOLD_NOT_MET',
  });

  await expect(service.evaluateDecision(MARKET, PRODUCT, 12000, { durationDays: 7 }))
    .rejects.toMatchObject({
      code: 'pricing_market_price_under_cdr_not_authorized',
      status: 409,
      details: expect.objectContaining({ reason: 'COVERAGE_THRESHOLD_NOT_MET' }),
    });
});

test('une position contributive sous CDR conserve la preuve de couverture et son expiration', async () => {
  economicTruth(10000, 14000);
  decisionPolicy.evaluateMarketDecision.mockResolvedValue({
    decision_status: 'COVERED',
    authorization: 'ALLOW_NEW_UNDER_CDR_POSITION',
    reason: 'COVERAGE_THRESHOLD_MET',
    evaluated_at: '2026-09-07T10:00:00.000Z',
    policy: { version: 'CM-V1' },
    canonical_period: {
      from: '2026-08-08T10:00:00.000Z',
      to: '2026-09-07T10:00:00.000Z',
    },
    coverage: { coverage_ratio: 1.08 },
  });

  const result = await service.evaluateDecision(MARKET, PRODUCT, 12000, { durationDays: 7 });
  expect(result).toEqual(expect.objectContaining({
    pricing_zone: 'under_cdr_contributive',
    decision_policy_version: 'CM-V1',
    coverage_status: 'COVERED',
    coverage_authorization: 'ALLOW_NEW_UNDER_CDR_POSITION',
    coverage_ratio: 1.08,
    decision_duration_days: 7,
    effective_until: '2026-09-14T10:00:00.000Z',
  }));
});

test('une nouvelle décision révoque l’ancienne puis insère un nouvel overlay sans UPDATE products', async () => {
  db.query.mockResolvedValueOnce({ rows: [PRODUCT] });
  economicTruth(10000, 14000);

  const queries = [];
  const client = {
    query: jest.fn(async (sql) => {
      queries.push(String(sql));
      if (/SELECT \* FROM product_market_price_decisions/.test(sql)) {
        return { rows: [{
          id: 'old-decision', price_amount: 15000, currency: 'XAF', price_kmf: 15000,
          variable_cost_kmf: 10000, cdr_complete_kmf: 14000,
          pricing_zone: 'at_or_above_cdr', rationale: 'Ancien prix', decided_at: '2026-09-01T00:00:00Z',
        }] };
      }
      if (/INSERT INTO product_market_price_decisions/.test(sql)) {
        return { rows: [{
          id: 'new-decision', price_amount: 16000, currency: 'XAF', price_kmf: 16000,
          variable_cost_kmf: 10000, cdr_complete_kmf: 14000,
          pricing_zone: 'at_or_above_cdr', rationale: 'Prix terrain', decided_at: '2026-09-07T10:00:00Z',
        }] };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  db.getClient.mockResolvedValue(client);

  const result = await service.decidePrice({
    market: MARKET,
    productRef: PRODUCT.product_ref,
    priceAmount: 16000,
    rationale: 'Prix terrain',
    actorId: 'manager-1',
  });

  expect(result.unchanged).toBe(false);
  expect(queries.some(sql => /UPDATE product_market_price_decisions/.test(sql))).toBe(true);
  expect(queries.some(sql => /INSERT INTO product_market_price_decisions/.test(sql))).toBe(true);
  expect(queries.some(sql => /UPDATE\s+products/i.test(sql))).toBe(false);
  expect(queries.some(sql => /DELETE\s+FROM\s+product_market_price_decisions/i.test(sql))).toBe(false);
  expect(client.release).toHaveBeenCalled();
});

test('reset révoque l’overlay et revient à l’héritage global sans DELETE', async () => {
  const calls = [];
  db.query.mockImplementation(async sql => {
    calls.push(String(sql));
    if (/SELECT id, product_ref/.test(sql)) return { rows: [PRODUCT] };
    if (/UPDATE product_market_price_decisions/.test(sql)) return { rows: [{ id: 'decision-1' }] };
    return { rows: [] };
  });

  const result = await service.resetPrice({
    market: MARKET,
    productRef: PRODUCT.product_ref,
    actorId: 'manager-1',
  });

  expect(result).toEqual(expect.objectContaining({ inherited_global: true, global_price_kmf: 20000 }));
  expect(calls.some(sql => /UPDATE product_market_price_decisions/.test(sql))).toBe(true);
  expect(calls.some(sql => /DELETE\s+FROM\s+product_market_price_decisions/i.test(sql))).toBe(false);
});

test('la liste projette les décisions actives sans transformer le produit en entité marché', async () => {
  const q = {
    query: jest.fn(async () => ({ rows: [
      {
        product_ref: 'KPR-1', name: 'A', category: 'phones', global_price_kmf: 20000,
        price_amount: 25000, currency: 'XAF', price_kmf: 16000,
        variable_cost_kmf: 10000, cdr_complete_kmf: 14000,
        pricing_zone: 'at_or_above_cdr', rationale: 'Terrain', decided_at: '2026-09-07T10:00:00Z',
      },
      { product_ref: 'KPR-2', name: 'B', category: 'home', global_price_kmf: 15000, price_amount: null },
    ] })),
  };

  const rows = await service.listEffectivePrices(MARKET, q);
  expect(rows[0].market_price.amount).toBe(25000);
  expect(rows[1]).toEqual(expect.objectContaining({ inherited_global: true, market_price: null }));
  const sql = q.query.mock.calls[0][0];
  expect(sql).toContain('FROM products p');
  expect(sql).toContain('LEFT JOIN product_market_price_decisions');
  expect(sql).not.toMatch(/p\.market_id/i);
});
