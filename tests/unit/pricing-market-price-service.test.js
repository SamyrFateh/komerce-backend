'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/pricing-engine', () => ({
  loadGlobalConfig: jest.fn(async () => ({ marker: 'market-config' })),
  computeCDR: jest.fn(() => ({
    variable_cost_estimated_kmf: 1000,
    cost_complete_estimated_kmf: 1800,
  })),
}));
jest.mock('../../services/pricing-market-decision-policy', () => ({
  evaluateMarketDecision: jest.fn(),
}));
jest.mock('../../utils/currency', () => ({
  getMarketCurrency: jest.fn(async () => ({ currency: 'XAF', minor_unit: 0 })),
  projectAmount: jest.fn(async (amount, from, to) => {
    if (from === to) return Number(amount);
    if (from === 'XAF' && to === 'KMF') return Number(amount) * 0.75;
    if (from === 'KMF' && to === 'XAF') return Number(amount) / 0.75;
    return Number(amount);
  }),
  roundToMinorUnit: jest.fn((amount, minor) => {
    const factor = 10 ** Number(minor || 0);
    return Math.round(Number(amount) * factor) / factor;
  }),
}));

const db = require('../../db');
const pricingEngine = require('../../services/pricing-engine');
const policy = require('../../services/pricing-market-decision-policy');
const service = require('../../services/pricing-market-price-service');

const market = { id: 'market-cm', code: 'CM' };
const productRow = {
  id: 'product-1', product_ref: 'KPR-001', name: 'Produit test', category: 'phones',
  price_kmf: 2200, cost_kmf: 700, weight_kg: 0.5, volume_m3: 0.004, is_active: true,
};

function insertedEvent(overrides = {}) {
  return {
    decision_type: 'SET', local_price: 3000, local_currency: 'XAF',
    price_kmf_snapshot: 2250, variable_cost_kmf_snapshot: 1000,
    cdr_kmf_snapshot: 1800, strategy_position: 'COVERED', valid_until: null,
    rationale: 'Décision locale documentée pour le test.', decision_snapshot: {},
    recorded_at: '2026-09-07T12:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  pricingEngine.computeCDR.mockReturnValue({
    variable_cost_estimated_kmf: 1000,
    cost_complete_estimated_kmf: 1800,
  });
  db.query.mockImplementation(async sql => {
    if (String(sql).includes('FROM products')) return { rows: [productRow] };
    if (String(sql).includes('INSERT INTO product_market_price_decision_events')) return { rows: [insertedEvent()] };
    if (String(sql).includes('FROM product_market_price_decision_events')) return { rows: [] };
    return { rows: [] };
  });
});

test('un prix au-dessus du CDR est enregistré sans demander une exception de couverture', async () => {
  const result = await service.setMarketProductPrice(
    market,
    'KPR-001',
    { price: 3000, rationale: 'Prix local couvrant durablement le CDR complet.' },
    'manager-1',
    { now: new Date('2026-09-07T12:00:00Z') }
  );

  expect(result.decision.strategy_position).toBe('COVERED');
  expect(policy.evaluateMarketDecision).not.toHaveBeenCalled();
  expect(pricingEngine.loadGlobalConfig).toHaveBeenCalledWith({ marketId: 'market-cm' });
  const insert = db.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO product_market_price_decision_events'));
  expect(insert[1][4]).toBe(2250); // 3 000 XAF projetés vers la base économique KMF.
  expect(insert[1][7]).toBe('COVERED');
});

test('un prix égal ou inférieur au coût variable complet est toujours refusé', async () => {
  await expect(service.setMarketProductPrice(
    market,
    'KPR-001',
    { price: 1300, rationale: 'Tentative volontairement destructrice pour le test.' },
    'manager-1'
  )).rejects.toMatchObject({
    status: 409,
    code: 'pricing_market_price_below_variable_cost',
  });

  expect(db.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO product_market_price_decision_events'))).toBe(false);
});

test('une position sous CDR est refusée si le gate serveur ne l’autorise pas', async () => {
  policy.evaluateMarketDecision.mockResolvedValueOnce({
    decision_status: 'UNCOVERED',
    authorization: 'DENY_NEW_UNDER_CDR_POSITION',
    reason: 'COVERAGE_THRESHOLD_NOT_MET',
  });

  await expect(service.setMarketProductPrice(
    market,
    'KPR-001',
    {
      price: 2000,
      rationale: 'Test de prix contributif sous CDR sans couverture suffisante.',
      valid_until: '2026-09-10T12:00:00Z',
    },
    'manager-1',
    { now: new Date('2026-09-07T12:00:00Z') }
  )).rejects.toMatchObject({
    status: 409,
    code: 'pricing_market_under_cdr_not_authorized',
  });
});

test('une position sous CDR exige une durée explicite même si le marché est couvert', async () => {
  await expect(service.setMarketProductPrice(
    market,
    'KPR-001',
    { price: 2000, rationale: 'Test de prix contributif temporaire sans date de fin.' },
    'manager-1',
    { now: new Date('2026-09-07T12:00:00Z') }
  )).rejects.toMatchObject({ code: 'pricing_market_under_cdr_valid_until_required' });

  expect(policy.evaluateMarketDecision).not.toHaveBeenCalled();
});

test('une position sous CDR autorisée stocke un snapshot compact du gate', async () => {
  policy.evaluateMarketDecision.mockResolvedValueOnce({
    market_id: 'market-cm',
    decision_status: 'COVERED',
    authorization: 'ALLOW_NEW_UNDER_CDR_POSITION',
    reason: 'COVERAGE_THRESHOLD_MET',
    policy: { version: 'CM-V1', coverage_threshold: 1.1, effective_to: '2026-09-30T00:00:00Z' },
    coverage: { coverage_ratio: 1.24, mature_order_ids: ['private-order-id'] },
    canonical_period: { from: '2026-08-08T12:00:00Z', to: '2026-09-07T12:00:00Z' },
    evaluated_at: '2026-09-07T12:00:00Z',
  });
  db.query.mockImplementation(async sql => {
    if (String(sql).includes('FROM products')) return { rows: [productRow] };
    if (String(sql).includes('INSERT INTO product_market_price_decision_events')) {
      return { rows: [insertedEvent({
        local_price: 2000, price_kmf_snapshot: 1500, strategy_position: 'UNDER_CDR',
        valid_until: '2026-09-10T12:00:00Z',
      })] };
    }
    return { rows: [] };
  });

  const result = await service.setMarketProductPrice(
    market,
    'KPR-001',
    {
      price: 2000,
      rationale: 'Position contributive temporaire autorisée par le gate marché.',
      valid_until: '2026-09-10T12:00:00Z',
    },
    'manager-1',
    { now: new Date('2026-09-07T12:00:00Z') }
  );

  expect(result.decision.strategy_position).toBe('UNDER_CDR');
  const insert = db.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO product_market_price_decision_events'));
  const snapshot = JSON.parse(insert[1][10]);
  expect(snapshot).toEqual(expect.objectContaining({
    decision_status: 'COVERED', authorization: 'ALLOW_NEW_UNDER_CDR_POSITION', policy_version: 'CM-V1', coverage_ratio: 1.24,
  }));
  expect(JSON.stringify(snapshot)).not.toContain('private-order-id');
  expect(JSON.stringify(snapshot)).not.toContain('market-cm');
});

test('RESET est append-only et ne supprime jamais l’historique', async () => {
  let latestRead = false;
  db.query.mockImplementation(async sql => {
    const text = String(sql);
    if (text.includes('FROM products')) return { rows: [productRow] };
    if (text.includes('FROM product_market_price_decision_events')) {
      latestRead = true;
      return { rows: [insertedEvent()] };
    }
    if (text.includes('INSERT INTO product_market_price_decision_events')) {
      return { rows: [insertedEvent({
        decision_type: 'RESET', local_price: null, local_currency: null,
        price_kmf_snapshot: null, variable_cost_kmf_snapshot: null, cdr_kmf_snapshot: null,
        strategy_position: null, rationale: 'Retour explicite au prix global du catalogue.',
      })] };
    }
    return { rows: [] };
  });

  const result = await service.resetMarketProductPrice(
    market,
    'KPR-001',
    { rationale: 'Retour explicite au prix global du catalogue.' },
    'manager-1'
  );

  expect(latestRead).toBe(true);
  expect(result.changed).toBe(true);
  expect(result.effective_source).toBe('global_inherited');
  const sql = db.query.mock.calls.map(([text]) => String(text)).join('\n');
  expect(sql).not.toMatch(/DELETE\s+FROM\s+product_market_price_decision_events/i);
  expect(sql).not.toMatch(/UPDATE\s+product_market_price_decision_events/i);
});

test('la devise et la projection KMF ne peuvent jamais venir du navigateur', async () => {
  await expect(service.setMarketProductPrice(
    market,
    'KPR-001',
    { price: 3000, currency: 'EUR', rationale: 'Tentative de forcer une devise depuis le client.' },
    'manager-1'
  )).rejects.toMatchObject({ code: 'pricing_market_price_authority_forbidden' });
});
