'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));

const db = require('../../db');
const {
  recordRiskCostEvent,
  recordRiskWatermark,
  computePeriodRiskTruth,
  _validateMoney,
  _aggregateRiskRows,
} = require('../../services/pricing-risk-period');

const MARKET_ID = '11111111-1111-1111-1111-111111111111';
const ORDER_ID = '22222222-2222-2222-2222-222222222222';
const PROVISION_ID = '33333333-3333-3333-3333-333333333333';
const ACTOR_ID = '44444444-4444-4444-4444-444444444444';
const FROM = '2026-09-01T00:00:00.000Z';
const TO = '2026-10-01T00:00:00.000Z';

function mockClient() {
  const client = { query: jest.fn(), release: jest.fn() };
  db.getClient.mockResolvedValue(client);
  return client;
}

function riskInput(overrides = {}) {
  return {
    market_id: MARKET_ID,
    order_id: ORDER_ID,
    risk_provision_id: PROVISION_ID,
    event_kind: 'ACCRUAL',
    economic_at: '2026-09-10T12:00:00.000Z',
    amount_original: 5000,
    currency: 'KMF',
    fx_rate_to_kmf: 1,
    fx_source: 'native KMF',
    amount_kmf: 5000,
    source_kind: 'DISPUTE',
    evidence_ref: 'dispute://case-1',
    ...overrides,
  };
}

function riskRow(overrides = {}) {
  return {
    id: 'risk-event-1',
    market_id: MARKET_ID,
    order_id: ORDER_ID,
    risk_provision_id: PROVISION_ID,
    risk_key_snapshot: 'returns',
    risk_label_snapshot: 'Retours produits defectueux',
    event_kind: 'ACCRUAL',
    adjusts_event_id: null,
    economic_at: '2026-09-10T12:00:00.000Z',
    amount_kmf: '5000',
    source_kind: 'DISPUTE',
    evidence_ref: 'dispute://case-1',
    recorded_at: '2026-10-02T10:00:00.000Z',
    ...overrides,
  };
}

function watermarkRow(overrides = {}) {
  return {
    id: 'watermark-1',
    market_id: MARKET_ID,
    closed_through: TO,
    review_version: 'risk-close-v1',
    source: 'monthly-risk-review',
    evidence_ref: 'risk-review://cm/2026-09',
    notes: null,
    recorded_by: ACTOR_ID,
    recorded_at: '2026-10-03T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('pricing-risk-period — validation', () => {
  test('KMF exige FX=1 et conversion cohérente', () => {
    expect(() => _validateMoney({
      amount_original: 100,
      currency: 'KMF',
      fx_rate_to_kmf: 2,
      amount_kmf: 200,
    })).toThrow('KMF events require');
  });

  test('agrège les corrections sans inventer de catégorie fermée', () => {
    const result = _aggregateRiskRows([
      riskRow({ risk_key_snapshot: 'returns', amount_kmf: '5000' }),
      riskRow({ id: 'adj-1', event_kind: 'ADJUSTMENT', adjusts_event_id: 'risk-event-1', amount_kmf: '-1000' }),
      riskRow({ id: 'r2', risk_key_snapshot: 'new_future_risk', amount_kmf: '2500' }),
    ]);
    expect(result.net_risk_cost_kmf).toBe(6500);
    expect(result.by_risk_key_kmf.returns).toBe(4000);
    expect(result.by_risk_key_kmf.new_future_risk).toBe(2500);
  });
});

describe('pricing-risk-period — écritures append-only', () => {
  test('résout le market_id depuis la commande et snapshotte la provision', async () => {
    const client = mockClient();
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: ORDER_ID, market_id: MARKET_ID, reference: 'CMD-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: PROVISION_ID, key: 'returns', label: 'Retours' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'event-new' }] })
      .mockResolvedValueOnce({}); // COMMIT

    const result = await recordRiskCostEvent(riskInput(), ACTOR_ID);
    expect(result.id).toBe('event-new');
    const params = client.query.mock.calls[3][1];
    expect(params[0]).toBe(MARKET_ID);
    expect(params[1]).toBe(ORDER_ID);
    expect(params[2]).toBe(PROVISION_ID);
    expect(params[3]).toBe('returns');
    expect(params[4]).toBe('Retours');
    expect(client.release).toHaveBeenCalled();
  });

  test('refuse un market_id client contradictoire avec la commande', async () => {
    const client = mockClient();
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: ORDER_ID, market_id: MARKET_ID, reference: 'CMD-1' }] })
      .mockResolvedValueOnce({}); // rollback

    await expect(recordRiskCostEvent(riskInput({
      market_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    }), ACTOR_ID)).rejects.toThrow('does not match order market_id');
  });

  test('une correction garde market, risque et date économique du fait original', async () => {
    const client = mockClient();
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{
        id: 'original',
        market_id: MARKET_ID,
        order_id: ORDER_ID,
        risk_provision_id: PROVISION_ID,
        risk_key_snapshot: 'returns',
        risk_label_snapshot: 'Retours historiques',
        event_kind: 'ACCRUAL',
        economic_at: '2026-09-04T00:00:00.000Z',
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 'adjustment' }] })
      .mockResolvedValueOnce({});

    await recordRiskCostEvent(riskInput({
      event_kind: 'ADJUSTMENT',
      adjusts_event_id: 'original',
      amount_original: -500,
      amount_kmf: -500,
      economic_at: '2027-01-01T00:00:00Z', // doit être ignoré pour une correction
    }), ACTOR_ID);

    const params = client.query.mock.calls[2][1];
    expect(params[0]).toBe(MARKET_ID);
    expect(params[3]).toBe('returns');
    expect(params[4]).toBe('Retours historiques');
    expect(params[7]).toBe('2026-09-04T00:00:00.000Z');
  });

  test('watermark ne peut pas reculer', async () => {
    const client = mockClient();
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: MARKET_ID }] })
      .mockResolvedValueOnce({ rows: [{ id: 'wm-old', closed_through: '2026-10-01T00:00:00Z' }] })
      .mockResolvedValueOnce({});

    await expect(recordRiskWatermark({
      market_id: MARKET_ID,
      closed_through: '2026-09-15T00:00:00Z',
      review_version: 'v2',
      source: 'monthly-review',
      evidence_ref: 'review://2',
    }, ACTOR_ID)).rejects.toThrow('cannot move backwards');
  });
});

describe('pricing-risk-period — vérité de fenêtre', () => {
  test('sans watermark, absence de faits ne devient jamais zéro', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await computePeriodRiskTruth({ marketId: MARKET_ID, from: FROM, to: TO });
    expect(result.status).toBe('NOT_DECISIONAL_RISK_PERIOD_OPEN');
    expect(result.actual_risk_cost_kmf).toBeNull();
  });

  test('watermark frais + zéro événement certifie explicitement un coût risque de zéro', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [watermarkRow()] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await computePeriodRiskTruth({ marketId: MARKET_ID, from: FROM, to: TO });
    expect(result.status).toBe('RISK_PERIOD_TRUTH_AVAILABLE');
    expect(result.actual_risk_cost_kmf).toBe(0);
    expect(result.evidence_event_count).toBe(0);
  });

  test('un événement backdaté enregistré après la revue rend la certification stale', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [watermarkRow({ recorded_at: '2026-10-03T00:00:00Z' })] })
      .mockResolvedValueOnce({ rows: [riskRow({ recorded_at: '2026-10-04T00:00:00Z' })] });

    const result = await computePeriodRiskTruth({ marketId: MARKET_ID, from: FROM, to: TO });
    expect(result.status).toBe('NOT_DECISIONAL_RISK_WATERMARK_STALE');
    expect(result.actual_risk_cost_kmf).toBeNull();
    expect(result.late_event_count).toBe(1);
  });

  test('une nouvelle certification après les faits rend le total décisionnel', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [watermarkRow({ recorded_at: '2026-10-05T00:00:00Z' })] })
      .mockResolvedValueOnce({ rows: [riskRow({ recorded_at: '2026-10-04T00:00:00Z' })] });

    const result = await computePeriodRiskTruth({ marketId: MARKET_ID, from: FROM, to: TO });
    expect(result.status).toBe('RISK_PERIOD_TRUTH_AVAILABLE');
    expect(result.actual_risk_cost_kmf).toBe(5000);
    expect(result.by_risk_key_kmf.returns).toBe(5000);
  });

  test('un total net négatif reste non décisionnel', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [watermarkRow()] })
      .mockResolvedValueOnce({ rows: [riskRow({ amount_kmf: '-1000', event_kind: 'REVERSAL' })] });

    const result = await computePeriodRiskTruth({ marketId: MARKET_ID, from: FROM, to: TO });
    expect(result.status).toBe('NOT_DECISIONAL_NEGATIVE_RISK_TOTAL');
    expect(result.actual_risk_cost_kmf).toBeNull();
  });
});
