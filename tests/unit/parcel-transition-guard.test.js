'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db', () => ({ query: jest.fn() }));
const pool = require('../../db');
const { assertParcelTransitionAllowed } = require('../../services/parcel-transition-guard');

describe('parcel-transition-guard', () => {
  beforeEach(() => jest.clearAllMocks());

  test('active Logistics incident blocks shipped', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ incident_type: 'weight_mismatch', origin_domain: 'LOGISTICS', details: {} }],
    });
    await expect(assertParcelTransitionAllowed('p1', 'shipped'))
      .rejects.toMatchObject({ code: 'OPEN_HUB_RELEVANT_INCIDENT' });
  });

  test('Payments incident on same parcel/order does not block', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ incident_type: 'payment_issue', origin_domain: 'PAYMENTS', details: {} }],
    });
    await expect(assertParcelTransitionAllowed('p2', 'shipped')).resolves.toEqual({ allowed: true });
  });

  test('order-level Logistics reconciliation incident blocks parcel shipped', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ incident_type: 'reconciliation_error', origin_domain: 'LOGISTICS', details: { type: 'over_allocation' } }],
    });
    await expect(assertParcelTransitionAllowed('p3', 'shipped'))
      .rejects.toMatchObject({ code: 'OPEN_HUB_RELEVANT_INCIDENT' });
  });

  test('Orders reconciliation incident does not block Hub by shared key', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ incident_type: 'reconciliation_error', origin_domain: 'ORDERS', details: { type: 'order_status_drift' } }],
    });
    await expect(assertParcelTransitionAllowed('p4', 'shipped')).resolves.toEqual({ allowed: true });
  });

  test('explicit transaction executor is preserved', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await expect(assertParcelTransitionAllowed('p5', 'shipped', client)).resolves.toEqual({ allowed: true });
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(pool.query).not.toHaveBeenCalled();
  });
});