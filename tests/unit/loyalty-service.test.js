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
  getLoyaltyDiscount,
  recalculateLoyalty,
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

  it('getFinanceConfig retourne null si la table finance_config n\'existe pas encore (42P01)', async () => {
    const err = new Error('relation "finance_config" does not exist');
    err.code = '42P01';
    db.query.mockRejectedValueOnce(err);

    const result = await getFinanceConfig();

    expect(result).toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('getFinanceConfig propage les erreurs autres que 42P01', async () => {
    const err = new Error('connection timeout');
    db.query.mockRejectedValueOnce(err);

    await expect(getFinanceConfig()).rejects.toThrow('connection timeout');
  });

  it('handleOrderConfirmed : loyalty désactivée → skipped loyalty_disabled', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ loyalty_active: false, loyalty_threshold_kmf: 10000, loyalty_trigger_count: 3 }] });

    const result = await handleOrderConfirmed({ orderId: 'order-004' });

    expect(result).toEqual({ skipped: true, reason: 'loyalty_disabled' });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('handleOrderConfirmed : pas de config finance (table absente) → skipped loyalty_disabled', async () => {
    const err = new Error('relation does not exist');
    err.code = '42P01';
    db.query.mockRejectedValueOnce(err);

    const result = await handleOrderConfirmed({ orderId: 'order-004b' });

    expect(result).toEqual({ skipped: true, reason: 'loyalty_disabled' });
  });

  it('handleOrderConfirmed : commande introuvable → skipped order_not_found', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ loyalty_active: true, loyalty_threshold_kmf: 10000, loyalty_trigger_count: 3 }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await handleOrderConfirmed({ orderId: 'order-005' });

    expect(result).toEqual({ skipped: true, reason: 'order_not_found' });
  });

  it('handleOrderConfirmed : commande guest (pas de user_id) → skipped guest_order', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ loyalty_active: true, loyalty_threshold_kmf: 10000, loyalty_trigger_count: 3 }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'order-006', reference: 'CMD-006', user_id: null, total_kmf: '22000',
      }] });

    const result = await handleOrderConfirmed({ orderId: 'order-006' });

    expect(result).toEqual({ skipped: true, reason: 'guest_order' });
  });

  it('handleOrderConfirmed : la notification WhatsApp échoue → catch géré silencieusement', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ loyalty_active: true, loyalty_threshold_kmf: 10000, loyalty_trigger_count: 3 }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'order-007', reference: 'CMD-007', user_id: 'user-001', total_kmf: '22000',
        full_name: 'Client Test', phone: '000000', big_basket_count: 2, big_basket_last_notified_count: 0,
      }] })
      .mockResolvedValueOnce({ rows: [{ big_basket_count: 3, big_basket_last_notified_count: 0, full_name: 'Client Test', phone: '000000' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    notificationService.notifyLoyaltyEarned.mockRejectedValueOnce(new Error('whatsapp down'));

    const result = await handleOrderConfirmed({ orderId: 'order-007' });
    await new Promise(setImmediate);

    expect(result.notified).toBe(true);
  });

  it('handleOrderConfirmed : erreur DB inattendue → skipped error', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ loyalty_active: true, loyalty_threshold_kmf: 10000, loyalty_trigger_count: 3 }] })
      .mockRejectedValueOnce(new Error('db down'));

    const result = await handleOrderConfirmed({ orderId: 'order-008' });

    expect(result).toEqual({ skipped: true, reason: 'error', error: 'db down' });
  });

  it('getUserLoyaltyStatus : userId absent → null', async () => {
    const result = await getUserLoyaltyStatus(null);
    expect(result).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('getUserLoyaltyStatus : loyalty désactivée → { active: false }', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ loyalty_active: false }] });

    const result = await getUserLoyaltyStatus('user-002');

    expect(result).toEqual({ active: false });
  });

  it('getUserLoyaltyStatus : utilisateur introuvable → null', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ loyalty_active: true, loyalty_threshold_kmf: 10000, loyalty_trigger_count: 3 }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getUserLoyaltyStatus('user-003');

    expect(result).toBeNull();
  });

  it('getUserLoyaltyStatus : aucun panier, pas de reward → status inactive', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ loyalty_active: true, loyalty_threshold_kmf: 10000, loyalty_trigger_count: 3 }] })
      .mockResolvedValueOnce({ rows: [{ big_basket_count: 0, big_basket_last_notified_count: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getUserLoyaltyStatus('user-004');

    expect(result.pending_reward).toBeNull();
    expect(result.status).toBe('inactive');
  });

  it('getUserLoyaltyStatus : paniers en cours, loin du palier → status active', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ loyalty_active: true, loyalty_threshold_kmf: 10000, loyalty_trigger_count: 3 }] })
      .mockResolvedValueOnce({ rows: [{ big_basket_count: 1, big_basket_last_notified_count: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getUserLoyaltyStatus('user-005');

    expect(result.remaining_to_next_tier).toBe(2);
    expect(result.status).toBe('active');
  });

  // O7.3 (provider loyalty) : migré depuis tests/unit/loyalty-route.test.js —
  // les fonctions vivent désormais ici (routes/loyalty.js n'est plus qu'une
  // route HTTP). Signature (db, userId) préservée à l'identique : les
  // appelants passent parfois un client de transaction, jamais db mocké
  // module-level de ce fichier de test. Voir docs/O7_3_BOUNDARY_ANALYSIS.md.
  describe('getLoyaltyDiscount', () => {
    it('retourne 0/null si aucune ligne trouvée', async () => {
      const fakeDb = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      const result = await getLoyaltyDiscount(fakeDb, 'user-1');
      expect(result).toEqual({ discountPct: 0, discountLabel: null });
    });

    it('retourne le palier et la remise', async () => {
      const fakeDb = {
        query: jest.fn().mockResolvedValue({
          rows: [{ discount_pct: '7.5', tier_label: 'Gold' }],
        }),
      };
      const result = await getLoyaltyDiscount(fakeDb, 'user-1');
      expect(result).toEqual({ discountPct: 7.5, discountLabel: 'Gold' });
    });

    it("ne bloque pas la commande en cas d'erreur DB (remise = 0)", async () => {
      const fakeDb = { query: jest.fn().mockRejectedValue(new Error('db down')) };
      const result = await getLoyaltyDiscount(fakeDb, 'user-1');
      expect(result).toEqual({ discountPct: 0, discountLabel: null });
    });
  });

  describe('recalculateLoyalty', () => {
    it('appelle la fonction SQL recalculate_loyalty', async () => {
      const fakeDb = { query: jest.fn().mockResolvedValue({}) };
      await recalculateLoyalty(fakeDb, 'user-1');
      expect(fakeDb.query).toHaveBeenCalledWith('SELECT recalculate_loyalty($1)', ['user-1']);
    });

    it('avale les erreurs sans les propager (fire-and-forget)', async () => {
      const fakeDb = { query: jest.fn().mockRejectedValue(new Error('db down')) };
      await expect(recalculateLoyalty(fakeDb, 'user-1')).resolves.toBeUndefined();
    });
  });
});
