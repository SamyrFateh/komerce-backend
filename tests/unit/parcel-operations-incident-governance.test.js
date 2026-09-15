'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../../services/notification-service', () => ({ notifyText: jest.fn(), notifyParcelScan: jest.fn() }));
jest.mock('../../utils/rules', () => ({ getRule: jest.fn(), getRuleNumber: jest.fn() }));
jest.mock('../../utils/reference', () => ({ generateParcelRef: jest.fn() }));
jest.mock('../../services/refund-service', () => ({ processRefundWithFallback: jest.fn() }));
jest.mock('../../services/parcel-service', () => ({ PARCEL_SMS: {} }));
jest.mock('../../services/order-status-machine', () => ({ transitionOrderStatus: jest.fn(), appendOrderHistoryNote: jest.fn() }));
jest.mock('../../services/order-item-availability-service', () => ({ updateOrderItemAvailabilityDetails: jest.fn(), setOrderItemAvailabilityStatus: jest.fn() }));
jest.mock('../../services/product-admin-service', () => ({ adjustStock: jest.fn() }));
jest.mock('../../services/parcel-guards', () => ({
  validateParcelCreate: jest.fn(), validateSplitItems: jest.fn(), checkParcelCancellable: jest.fn(), validateParcelTransition: jest.fn(),
}));
jest.mock('../../services/parcel-transition-guard', () => ({ assertParcelTransitionAllowed: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
  forModule: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));

const { assertParcelTransitionAllowed } = require('../../services/parcel-transition-guard');
const { validateParcelTransition } = require('../../services/parcel-guards');
const { transitionParcelStatus } = require('../../services/parcel-operations');

describe('transitionParcelStatus — F2 incident authority', () => {
  beforeEach(() => jest.clearAllMocks());

  test('incident guard blocks shipped even with skipValidation=true', async () => {
    const client = { query: jest.fn() };
    assertParcelTransitionAllowed.mockRejectedValueOnce(
      Object.assign(new Error('blocked'), { code: 'OPEN_HUB_RELEVANT_INCIDENT' })
    );
    await expect(transitionParcelStatus(client, 'p1', 'shipped', { skipValidation: true }))
      .rejects.toMatchObject({ code: 'OPEN_HUB_RELEVANT_INCIDENT' });
    expect(assertParcelTransitionAllowed).toHaveBeenCalledWith('p1', 'shipped', client);
    expect(client.query).not.toHaveBeenCalled();
  });

  test('skipValidation bypasses state-machine only, not incident authority', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
    assertParcelTransitionAllowed.mockResolvedValueOnce({ allowed: true });
    await expect(transitionParcelStatus(client, 'p2', 'shipped', { skipValidation: true }))
      .resolves.toEqual({ ok: true });
    expect(assertParcelTransitionAllowed).toHaveBeenCalledWith('p2', 'shipped', client);
    expect(validateParcelTransition).not.toHaveBeenCalled();
    expect(client.query.mock.calls[0][0]).toContain('UPDATE parcels SET');
  });

  test('normal transition still applies state-machine after incident policy', async () => {
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ status: 'draft' }] })
      .mockResolvedValueOnce({ rowCount: 1 }) };
    assertParcelTransitionAllowed.mockResolvedValueOnce({ allowed: true });
    validateParcelTransition.mockReturnValueOnce({ ok: true });
    await expect(transitionParcelStatus(client, 'p3', 'preparation')).resolves.toEqual({ ok: true });
    expect(assertParcelTransitionAllowed).toHaveBeenCalledWith('p3', 'preparation', client);
    expect(validateParcelTransition).toHaveBeenCalledWith('draft', 'preparation');
  });
});