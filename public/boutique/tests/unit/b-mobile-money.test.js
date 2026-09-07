'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../js/b-utils.js', () => ({
  apiGet: jest.fn(),
  apiPost: jest.fn(),
}));

const { apiGet, apiPost } = require('../../js/b-utils.js');
const mobileMoney = require('../../js/b-mobile-money.js');

beforeEach(() => jest.clearAllMocks());

describe('Mobile Money boutique client', () => {
  test('availability est résolue par relais et jamais par preview market', async () => {
    apiGet.mockResolvedValueOnce({ available: true, provider: 'orange_money', label: 'Orange Money' });

    const result = await mobileMoney.getMobileMoneyAvailabilityForRelay('relay-cm');

    expect(apiGet).toHaveBeenCalledWith(
      '/api/payments/mobile-money/availability?relais_id=relay-cm',
      expect.objectContaining({ retries: 0 })
    );
    expect(result.available).toBe(true);
  });

  test('initiation n envoie le MSISDN que lorsqu il est fourni', async () => {
    apiPost.mockResolvedValueOnce({ transaction: { id: 'tx-1', status: 'pending' } });
    await mobileMoney.initiateMobileMoneyPayment('K-CM-001');
    expect(apiPost).toHaveBeenCalledWith(
      '/api/payments/mobile-money/initiate',
      { order_reference: 'K-CM-001' },
      expect.objectContaining({ retries: 0 })
    );

    apiPost.mockResolvedValueOnce({ transaction: { id: 'tx-2', status: 'pending' } });
    await mobileMoney.initiateMobileMoneyPayment('K-CG-001', '+242 06 123 45 67');
    expect(apiPost).toHaveBeenLastCalledWith(
      '/api/payments/mobile-money/initiate',
      { order_reference: 'K-CG-001', msisdn: '+242 06 123 45 67' },
      expect.objectContaining({ retries: 0 })
    );
  });

  test('polling s arrête immédiatement sur succeeded', async () => {
    apiPost.mockResolvedValueOnce({ transaction: { id: 'tx-1', status: 'succeeded' } });
    const sleep = jest.fn();

    const result = await mobileMoney.waitForMobileMoneyPayment('tx-1', { sleep, maxAttempts: 5 });

    expect(result).toEqual({ transaction: { id: 'tx-1', status: 'succeeded' }, timed_out: false });
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test('polling est borné et retourne pending sans inventer un succès', async () => {
    apiPost.mockResolvedValue({ transaction: { id: 'tx-1', status: 'pending' } });
    const sleep = jest.fn(() => Promise.resolve());

    const result = await mobileMoney.waitForMobileMoneyPayment('tx-1', {
      sleep,
      maxAttempts: 3,
      intervalMs: 1,
    });

    expect(result.timed_out).toBe(true);
    expect(result.transaction.status).toBe('pending');
    expect(apiPost).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  test.each(['succeeded', 'failed', 'expired'])('%s est final', (status) => {
    expect(mobileMoney.isMobileMoneyFinalStatus(status)).toBe(true);
  });
});
