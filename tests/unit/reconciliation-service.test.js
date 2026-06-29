'use strict';

const { makeClient, expectTransactionCommitted } = require('../integration/test-harness/mock-db');

jest.mock('../../db', () => ({ connect: jest.fn(), query: jest.fn() }));

jest.mock('../../utils/parcels', () => ({
  computeOrderStatus: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const pool = require('../../db');
const { computeOrderStatus } = require('../../utils/parcels');
const {
  reconcileOrder,
  reconcileParcel,
  reconcileAll,
  getReconciliationStats,
} = require('../../services/reconciliation-service');

function makeOrder(overrides = {}) {
  return { id: 'order-001', reference: 'CMD-001', status: 'shipped', payment_status: 'paid', ...overrides };
}

function makeParcel(overrides = {}) {
  return { id: 'parcel-001', order_id: 'order-001', reference: 'COLIS-001', status: 'shipped', created_at: new Date().toISOString(), ...overrides };
}

function makeOrderItem(overrides = {}) {
  return { id: 'oi-001', order_id: 'order-001', product_id: 'product-001', qty_ordered: 1, quantity: 1, ...overrides };
}

function makeParcelItem(overrides = {}) {
  return {
    id: 'pi-001', parcel_id: 'parcel-001', order_item_id: 'oi-001', qty_allocated: 1,
    qty_packed: 1, qty_shipped: 1, qty_received: 0, qty_collected: 0,
    ...overrides,
  };
}

describe('reconciliation-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    computeOrderStatus.mockReset();
  });

  describe('reconcileOrder', () => {
    it('retourne ok=true quand allocations, scans et statut commande sont coherents', async () => {
      const now = new Date().toISOString();
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [makeOrderItem()] },
        { rows: [makeParcel({ created_at: now })] },
        { rows: [makeParcelItem()] },
        { rows: [{ event_type: 'shipped', created_at: now }] },
        { rows: [{ last_at: now }] },
      ]);
      pool.connect.mockResolvedValue(client);
      computeOrderStatus.mockReturnValue('shipped');

      const result = await reconcileOrder('order-001');

      expect(result).toEqual(expect.objectContaining({
        ok: true,
        order_id: 'order-001',
        order_ref: 'CMD-001',
        total_checks: 6,
        issues_found: 0,
        issues: [],
      }));
      expect(computeOrderStatus).toHaveBeenCalledWith([expect.objectContaining({ id: 'parcel-001' })]);
      expectTransactionCommitted(client);
    });

    it('cree un incident si une allocation depasse la quantite commandee', async () => {
      const now = new Date().toISOString();
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [makeOrderItem({ qty_ordered: 1, quantity: 1 })] },
        { rows: [makeParcel({ created_at: now })] },
        { rows: [makeParcelItem({ qty_allocated: 2, qty_packed: 1, qty_shipped: 1 })] },
        { rows: [] },
        { rows: [{ id: 'incident-001' }] },
        { rows: [{ event_type: 'shipped', created_at: now }] },
        { rows: [{ last_at: now }] },
      ]);
      pool.connect.mockResolvedValue(client);
      computeOrderStatus.mockReturnValue('shipped');

      const result = await reconcileOrder('order-001');

      expect(result.ok).toBe(false);
      expect(result.issues_found).toBe(1);
      expect(result.issues[0]).toEqual(expect.objectContaining({ type: 'over_allocation', severity: 'high' }));
      expect(client.calls.some(c => String(c.sql).includes('INSERT INTO incidents'))).toBe(true);
      expectTransactionCommitted(client);
    });
  });

  describe('reconcileParcel', () => {
    it('retourne une erreur claire si le colis est introuvable', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(reconcileParcel('parcel-missing')).resolves.toEqual({ ok: false, error: 'Colis introuvable' });
    });

    it('delegue a reconcileOrder quand le colis appartient a une commande', async () => {
      const now = new Date().toISOString();
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'parcel-001', order_id: 'order-001' }] });
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [makeOrderItem()] },
        { rows: [makeParcel({ created_at: now })] },
        { rows: [makeParcelItem()] },
        { rows: [{ event_type: 'shipped', created_at: now }] },
        { rows: [{ last_at: now }] },
      ]);
      pool.connect.mockResolvedValue(client);
      computeOrderStatus.mockReturnValue('shipped');

      const result = await reconcileParcel('parcel-001');

      expect(result.ok).toBe(true);
      expect(result.order_id).toBe('order-001');
      expectTransactionCommitted(client);
    });
  });

  describe('reconcileAll', () => {
    it('traite toutes les commandes eligibles en batch', async () => {
      const now = new Date().toISOString();
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'order-001' }, { id: 'order-002' }] });
      computeOrderStatus.mockReturnValue('shipped');

      const client1 = makeClient([
        { rows: [makeOrder({ id: 'order-001', reference: 'CMD-001' })] },
        { rows: [makeOrderItem({ order_id: 'order-001' })] },
        { rows: [makeParcel({ order_id: 'order-001', created_at: now })] },
        { rows: [makeParcelItem()] },
        { rows: [{ event_type: 'shipped', created_at: now }] },
        { rows: [{ last_at: now }] },
      ]);
      const client2 = makeClient([
        { rows: [makeOrder({ id: 'order-002', reference: 'CMD-002' })] },
        { rows: [makeOrderItem({ id: 'oi-002', order_id: 'order-002' })] },
        { rows: [makeParcel({ id: 'parcel-002', order_id: 'order-002', created_at: now })] },
        { rows: [makeParcelItem({ id: 'pi-002', parcel_id: 'parcel-002', order_item_id: 'oi-002' })] },
        { rows: [{ event_type: 'shipped', created_at: now }] },
        { rows: [{ last_at: now }] },
      ]);
      pool.connect.mockResolvedValueOnce(client1).mockResolvedValueOnce(client2);

      const result = await reconcileAll({ limit: 2 });

      expect(result.total).toBe(2);
      expect(result.ok).toBe(2);
      expect(result.issues).toBe(0);
      expect(result.errors).toBe(0);
      expect(result.details).toHaveLength(2);
    });
  });

  describe('getReconciliationStats', () => {
    it('retourne les compteurs avec stale_parcels', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ open_incidents: '2', critical_incidents: '1', high_incidents: '0' }] })
        .mockResolvedValueOnce({ rows: [{ stale_parcels: '3' }] });

      const result = await getReconciliationStats();

      expect(result).toEqual(expect.objectContaining({
        open_incidents: '2',
        critical_incidents: '1',
        high_incidents: '0',
        stale_parcels: '3',
      }));
      expect(pool.query).toHaveBeenCalledTimes(2);
    });
  });
});
