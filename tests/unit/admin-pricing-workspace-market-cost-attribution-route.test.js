'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
let mockRole = 'admin';
let mockCentralPricing = true;

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = { id: 'admin-7', role: mockRole }; next(); },
  requireRole: roles => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ code: 'role_forbidden' }),
}));

jest.mock('../../middleware/require-market-scope', () => ({
  attachAuthorizedMarkets: (req, res, next) => { req.authorizedMarkets = new Set(); next(); },
  requireMarketScope: () => (req, res, next) => next(),
  resolveMarketScopeRole: jest.fn(async () => 'manager'),
  requireMarketScopeRole: () => () => (req, res, next) => next(),
}));

jest.mock('../../middleware/require-pricing-global-authority', () => ({
  hasPricingGlobalAuthority: jest.fn(async () => mockCentralPricing),
  requirePricingGlobalAuthority: (req, res, next) => mockCentralPricing ? next() : res.status(403).json({ code: 'pricing_global_access_denied' }),
}));

jest.mock('../../services/market-delegation-service', () => ({
  resolveAuthorization: jest.fn(),
  audit: jest.fn(async () => {}),
}));

jest.mock('../../db', () => ({ query: jest.fn() }));

jest.mock('../../services/pricing-workspace', () => ({
  PricingWorkspaceError: class PricingWorkspaceError extends Error {},
  buildWorkspace: jest.fn(),
}));
jest.mock('../../services/pricing-market-decision-policy', () => ({
  evaluateMarketDecision: jest.fn(),
  isValidCalendarMonth: jest.fn(() => true),
  listMarketDecisionPolicyHistory: jest.fn(),
  recordMarketDecisionPolicy: jest.fn(),
}));
jest.mock('../../services/pricing-market-corridor', () => ({
  buildMarketCorridor: jest.fn(),
  recordMarketObservation: jest.fn(),
  deactivateMarketObservation: jest.fn(),
}));
jest.mock('../../services/market-commercial-price-service', () => ({
  listMarketPriceDrafts: jest.fn(),
  setMarketPriceDraft: jest.fn(),
  resetMarketPriceDraft: jest.fn(),
}));
jest.mock('../../services/market-local-price-activation-service', () => ({
  previewLocalPriceActivation: jest.fn(),
  activateLocalPrice: jest.fn(),
}));
jest.mock('../../services/pricing-period-structure', () => ({
  SCOPE_KINDS: { GROUP: 'GROUP', MARKET_DIRECT: 'MARKET_DIRECT' },
  listStructureCostEvents: jest.fn(),
  recordStructureCostEvent: jest.fn(),
}));

jest.mock('../../services/market-cost-attribution-service', () => {
  class MarketCostAttributionError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  return {
    OUTCOMES: {
      ATTRIBUTED: 'ATTRIBUTED',
      NOOP_ACTIVE_ATTRIBUTION: 'NOOP_ACTIVE_ATTRIBUTION',
      NOOP_UNCHANGED: 'NOOP_UNCHANGED',
      NOT_DECISIONAL: 'NOT_DECISIONAL',
      REVERSED: 'REVERSED',
      NOTHING_TO_REVERSE: 'NOTHING_TO_REVERSE',
      CORRECTED: 'CORRECTED',
    },
    MarketCostAttributionError,
    attributeGroupEvent: jest.fn(),
    reverseAttributions: jest.fn(),
    correctGroupEventAttribution: jest.fn(),
    listEventAttributions: jest.fn(),
  };
});

const attribution = require('../../services/market-cost-attribution-service');
const express = require('express');
const request = require('supertest');
const router = require('../../routes/admin-pricing-workspace');

const BASE = '/api/admin/workspaces/pricing/structure-events';
const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const URL_BASE = `${BASE}/${EVENT_ID}/attributions`;
const POLICIES = [{ charge_id: '33333333-3333-4333-8333-333333333333', version: 'policy-v1' }];

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/admin/workspaces/pricing', router);
  a.use((err, req, res, next) => res.status(500).json({ error: 'unhandled', message: err.message })); // eslint-disable-line no-unused-vars
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'admin';
  mockCentralPricing = true;
});

describe('autorité des routes d’attribution', () => {
  const calls = [
    ['GET', URL_BASE],
    ['POST', URL_BASE],
    ['POST', `${URL_BASE}/reverse`],
    ['POST', `${URL_BASE}/correct`],
  ];

  test.each(calls)('%s %s : refuse un market_operator', async (method, url) => {
    mockRole = 'market_operator';
    const res = await request(app())[method.toLowerCase()](url).send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('role_forbidden');
  });

  test.each(calls)('%s %s : refuse un admin sans autorité pricing globale', async (method, url) => {
    mockCentralPricing = false;
    const res = await request(app())[method.toLowerCase()](url).send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('pricing_global_access_denied');
    expect(attribution.attributeGroupEvent).not.toHaveBeenCalled();
    expect(attribution.reverseAttributions).not.toHaveBeenCalled();
    expect(attribution.correctGroupEventAttribution).not.toHaveBeenCalled();
    expect(attribution.listEventAttributions).not.toHaveBeenCalled();
  });

  test('refuse une dimension marché dans le corps (autorité navigateur interdite)', async () => {
    const res = await request(app()).post(URL_BASE).send({ policies: POLICIES, market_id: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('pricing_internal_authority_forbidden');
    expect(attribution.attributeGroupEvent).not.toHaveBeenCalled();
  });

  test('accepte eligible_market_ids dans une politique (clé non interdite)', async () => {
    attribution.attributeGroupEvent.mockResolvedValue({ outcome: 'ATTRIBUTED', event_id: EVENT_ID, written: [{ id: 'r1' }] });
    const policies = [{ ...POLICIES[0], eligible_market_ids: ['44444444-4444-4444-8444-444444444444'] }];
    const res = await request(app()).post(URL_BASE).send({ policies });
    expect(res.status).toBe(201);
  });
});

describe('GET /structure-events/:eventId/attributions', () => {
  test('retourne le journal du fait, sans cache', async () => {
    const payload = { event_id: EVENT_ID, conserved: true, attributions: [] };
    attribution.listEventAttributions.mockResolvedValue(payload);

    const res = await request(app()).get(URL_BASE);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(payload);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(attribution.listEventAttributions).toHaveBeenCalledWith({ eventId: EVENT_ID });
  });
});

describe('POST /structure-events/:eventId/attributions', () => {
  test('attribue : acteur de la session, fait du chemin, politiques du corps', async () => {
    attribution.attributeGroupEvent.mockResolvedValue({
      outcome: 'ATTRIBUTED', event_id: EVENT_ID, written: [{ id: 'row-1' }],
    });

    const res = await request(app())
      .post(URL_BASE)
      .send({ policies: POLICIES, actorId: 'attacker', eventId: 'other' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, action: 'attribute_group_structure_event' });
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(attribution.attributeGroupEvent).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      actorId: 'admin-7',
      policies: POLICIES,
    });
  });

  test('noop sur attribution active : 200', async () => {
    attribution.attributeGroupEvent.mockResolvedValue({
      outcome: 'NOOP_ACTIVE_ATTRIBUTION', event_id: EVENT_ID, active_count: 2, written: [],
    });
    const res = await request(app()).post(URL_BASE).send({ policies: POLICIES });
    expect(res.status).toBe(200);
    expect(res.body.result.outcome).toBe('NOOP_ACTIVE_ATTRIBUTION');
  });

  test('non décisionnel : 422 avec la raison, ok=false', async () => {
    attribution.attributeGroupEvent.mockResolvedValue({
      outcome: 'NOT_DECISIONAL', event_id: EVENT_ID, reason: 'NOT_DECISIONAL_POLICY_MISSING', written: [],
    });
    const res = await request(app()).post(URL_BASE).send({ policies: POLICIES });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      ok: false,
      code: 'market_cost_attribution_not_decisional',
      result: { reason: 'NOT_DECISIONAL_POLICY_MISSING' },
    });
  });

  test('corps absent : politiques undefined transmises au service', async () => {
    attribution.attributeGroupEvent.mockResolvedValue({ outcome: 'NOOP_ACTIVE_ATTRIBUTION', written: [] });
    await request(app()).post(URL_BASE);
    expect(attribution.attributeGroupEvent).toHaveBeenCalledWith({
      eventId: EVENT_ID, actorId: 'admin-7', policies: undefined,
    });
  });
});

describe('POST /structure-events/:eventId/attributions/reverse', () => {
  test('annule avec un motif : 201', async () => {
    attribution.reverseAttributions.mockResolvedValue({
      outcome: 'REVERSED', event_id: EVENT_ID, written: [{ id: 'rev-1' }],
    });
    const res = await request(app()).post(`${URL_BASE}/reverse`).send({ reason: 'politique corrigée' });
    expect(res.status).toBe(201);
    expect(res.body.action).toBe('reverse_group_structure_event_attributions');
    expect(attribution.reverseAttributions).toHaveBeenCalledWith({
      eventId: EVENT_ID, actorId: 'admin-7', reason: 'politique corrigée',
    });
  });

  test('rien à annuler : 200', async () => {
    attribution.reverseAttributions.mockResolvedValue({ outcome: 'NOTHING_TO_REVERSE', written: [] });
    const res = await request(app()).post(`${URL_BASE}/reverse`).send({ reason: 'erreur de saisie' });
    expect(res.status).toBe(200);
  });

  test('corps absent : motif undefined transmis au service', async () => {
    attribution.reverseAttributions.mockResolvedValue({ outcome: 'NOTHING_TO_REVERSE', written: [] });
    await request(app()).post(`${URL_BASE}/reverse`);
    expect(attribution.reverseAttributions).toHaveBeenCalledWith({
      eventId: EVENT_ID, actorId: 'admin-7', reason: undefined,
    });
  });
});

describe('POST /structure-events/:eventId/attributions/correct', () => {
  test('corrige avec politiques et motif : 201', async () => {
    attribution.correctGroupEventAttribution.mockResolvedValue({
      outcome: 'CORRECTED', event_id: EVENT_ID, written: [{ id: 'a' }, { id: 'b' }],
    });
    const res = await request(app())
      .post(`${URL_BASE}/correct`)
      .send({ policies: POLICIES, reason: 'nouvelle politique' });
    expect(res.status).toBe(201);
    expect(res.body.action).toBe('correct_group_structure_event_attribution');
    expect(attribution.correctGroupEventAttribution).toHaveBeenCalledWith({
      eventId: EVENT_ID, actorId: 'admin-7', policies: POLICIES, reason: 'nouvelle politique',
    });
  });

  test('répartition identique : 200', async () => {
    attribution.correctGroupEventAttribution.mockResolvedValue({ outcome: 'NOOP_UNCHANGED', written: [] });
    const res = await request(app()).post(`${URL_BASE}/correct`).send({ policies: POLICIES, reason: 'recalcul' });
    expect(res.status).toBe(200);
  });

  test('non décisionnel : 422', async () => {
    attribution.correctGroupEventAttribution.mockResolvedValue({ outcome: 'NOT_DECISIONAL', reason: 'X', written: [] });
    const res = await request(app()).post(`${URL_BASE}/correct`).send({ policies: POLICIES, reason: 'recalcul' });
    expect(res.status).toBe(422);
  });

  test('corps absent : transmis tel quel au service', async () => {
    attribution.correctGroupEventAttribution.mockResolvedValue({ outcome: 'NOOP_UNCHANGED', written: [] });
    await request(app()).post(`${URL_BASE}/correct`);
    expect(attribution.correctGroupEventAttribution).toHaveBeenCalledWith({
      eventId: EVENT_ID, actorId: 'admin-7', policies: undefined, reason: undefined,
    });
  });
});

describe('mapping des erreurs', () => {
  const { MarketCostAttributionError } = attribution;

  test.each([
    ['INVALID_INPUT', 400, 'market_cost_attribution_invalid'],
    ['EVENT_NOT_FOUND', 404, 'structure_event_not_found'],
    ['EVENT_NOT_GROUP', 422, 'market_cost_attribution_event_not_attributable'],
    ['EVENT_NOT_ACCRUAL', 422, 'market_cost_attribution_event_not_attributable'],
    ['EVENT_ALREADY_ADJUSTED', 409, 'market_cost_attribution_event_adjusted'],
    ['NO_ACTIVE_ATTRIBUTION', 409, 'market_cost_attribution_none_active'],
    ['CONSERVATION_FAILURE', 422, 'market_cost_attribution_conservation_failure'],
  ])('%s → %i %s', async (code, status, apiCode) => {
    attribution.attributeGroupEvent.mockRejectedValue(new MarketCostAttributionError(code, 'boom'));
    const res = await request(app()).post(URL_BASE).send({ policies: POLICIES });
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error: 'boom', code: apiCode });
  });

  test('erreur de validation de politique : 400', async () => {
    attribution.attributeGroupEvent.mockRejectedValue(new Error('allocation policy must be an object'));
    const res = await request(app()).post(URL_BASE).send({ policies: [1] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('structure_event_invalid');
  });

  test('lecture : fait introuvable → 404', async () => {
    attribution.listEventAttributions.mockRejectedValue(new MarketCostAttributionError('EVENT_NOT_FOUND', 'nope'));
    const res = await request(app()).get(URL_BASE);
    expect(res.status).toBe(404);
  });

  test('code de service inconnu ou erreur inattendue : transmis au handler global', async () => {
    attribution.attributeGroupEvent.mockRejectedValue(new MarketCostAttributionError('UNKNOWN', 'x'));
    const unknown = await request(app()).post(URL_BASE).send({ policies: POLICIES });
    expect(unknown.status).toBe(500);

    attribution.reverseAttributions.mockRejectedValue(new Error('db down'));
    const unexpected = await request(app()).post(`${URL_BASE}/reverse`).send({ reason: 'abc' });
    expect(unexpected.status).toBe(500);
    expect(unexpected.body.message).toBe('db down');
  });
});
