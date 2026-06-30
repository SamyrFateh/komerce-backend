'use strict';

jest.mock('../../db', () => ({ query: jest.fn() }));

jest.mock('../../utils/logger', () => ({
  forModule: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('../../services/notification-service', () => ({
  notifyLoyaltyEarned: jest.fn(),
}));

const db = require('../../db');
const notificationService = require('../../services/notification-service');
const {
  handleOrderConfirmed,
  getUserLoyaltyStatus,
  getFinanceConfig,
  invalidateConfigCache,
} = require('../../services/loyalty-service');

describe('loyalty-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateConfigCache();
    notificationService.notifyLoyaltyEarned.mockResolvedValue(undefined);
  });

  it('met en cache la configuration finance puis relit apres invalidation', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 1, loyalty_active: true, loyalty_threshold_kmf: 10000, loyalty_trigger_count: 3 }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, loyalty_active: false, loyalty_threshold_kmf: 20000, loyalty_trigger_count: 4 }] });

    const first = await getFinanceConfig();
    const cached = await getFinanceConfig();
    invalidateConfigCache();
    const refreshed = await getFinanceConfig();

    expect(first.loyalty_active).toBe(true);
    expect(cached).toBe(first);
    expect(refreshed.loyalty_active).toBe(false);
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it('ignore une commande sous le seuil minimum', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ loyalty_active: true, loyalty_threshold_kmf: 10000, loyalty_trigger_count: 3 }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'order-001', reference: 'CMD-001', user_id: 'user-001', total_kmf: '9000',
        full_name: 'Client Test', phone: '000000', big_basket_count: 0, big_basket_last_notified_count: 0,
      }] });

    const result = await handleOrderConfirmed({ orderId: 'order-001' });

    expect(result).toEqual({ skipped: true, reason: 'below_threshold', total_kmf: 9000 });
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(notificationService.notifyLoyaltyEarned).not.toHaveBeenCalled();
  });

  it('incremente le compteur sans notifier hors palier', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ loyalty_active: true, loyalty_threshold_kmf: 10000, loyalty_trigger_count: 3 }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'order-002', reference: 'CMD-002', user_id: 'user-001', total_kmf: '15000',
        full_name: 'Client Test', phone: '000000', big_basket_count: 1, big_basket_last_notified_count: 0,
      }] })
      .mockResolvedValueOnce({ rows: [{ big_basket_count: 2, big_basket_last_notified_count: 0, full_name: 'Client Test', phone: '000000' }] });

    const result = await handleOrderConfirmed({ orderId: 'order-002' });

    expect(result).toEqual({ skipped: false, incremented: true, notified: false, count: 2 });
    expect(notificationService.notifyLoyaltyEarned).not.toHaveBeenCalled();
  });

  it('cree une reward pending et notifie au palier atteint', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ loyalty_active: true, loyalty_threshold_kmf: 10000, loyalty_trigger_count: 3 }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'order-003', reference: 'CMD-003', user_id: 'user-001', total_kmf: '22000',
        full_name: 'Client Test', phone: '000000', big_basket_count: 2, big_basket_last_notified_count: 0,
      }] })
      .mockResolvedValueOnce({ rows: [{ big_basket_count: 3, big_basket_last_notified_count: 0, full_name: 'Client Test', phone: '000000' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await handleOrderConfirmed({ orderId: 'order-003' });

    expect(result).toEqual({ skipped: false, incremented: true, notified: true, count: 3, tier: 1 });
    expect(db.query.mock.calls[3][0]).toContain('INSERT INTO loyalty_rewards');
    expect(db.query.mock.calls[4][0]).toContain('UPDATE users SET big_basket_last_notified_count');
    expect(notificationService.notifyLoyaltyEarned).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-001', orderRef: 'CMD-003', basketCount: 3,
    }));
  });

  it('calcule le prochain palier utilisateur et expose la reward pending', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ loyalty_active: true, loyalty_threshold_kmf: 10000, loyalty_trigger_count: 3 }] })
      .mockResolvedValueOnce({ rows: [{ big_basket_count: 2, big_basket_last_notified_count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'reward-001', basket_count_at_trigger: '3', created_at: '2026-06-29T00:00:00Z' }] });

    const result = await getUserLoyaltyStatus('user-001');

    expect(result.remaining_to_next_tier).toBe(1);
    expect(result.pending_reward).toEqual({ id: 'reward-001', at_count: 3, created_at: '2026-06-29T00:00:00Z' });
    expect(result.status).toBe('reward_pending');
  });
});
