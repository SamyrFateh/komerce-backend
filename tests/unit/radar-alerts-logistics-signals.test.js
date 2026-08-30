'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — services/radar-alerts/logistics-signals.js
 * (extraction I-BACK-2, voir radar-alerts-payment-signals.test.js)
 */

const { checkBlockedParcels, checkStaleDeliveries } =
  require('../../services/radar-alerts/logistics-signals');

describe('checkBlockedParcels', () => {
  it('retourne null si aucun colis bloqué', async () => {
    const db = { query: jest.fn(async () => ({ rows: [{ cnt: 0 }] })) };
    expect(await checkBlockedParcels(db, 56)).toBeNull();
  });

  it('retourne une alerte critical avec le compte', async () => {
    const db = { query: jest.fn(async () => ({ rows: [{ cnt: 2 }] })) };
    const alert = await checkBlockedParcels(db, 56);
    expect(alert).toMatchObject({ level: 'critical', code: 'PARCELS_BLOCKED', count: 2 });
  });
});

describe('checkStaleDeliveries', () => {
  const getDetail = (parcels) => {
    const statuses = parcels.map(p => p.status);
    if (statuses.includes('collected') && statuses.includes('available')) return 'partial_collected';
    if (statuses.includes('available') && statuses.includes('shipped')) return 'partial_available';
    if (statuses.includes('draft')) return 'awaiting_stock';
    return null;
  };

  it('retourne un tableau vide si aucune commande partielle ancienne', async () => {
    const db = { query: jest.fn(async () => ({ rows: [] })) };
    const alerts = await checkStaleDeliveries(db, { getDetail, backorderMaxD: 45 });
    expect(alerts).toEqual([]);
  });

  it('produit jusqu\'à 3 alertes distinctes selon les détails calculés', async () => {
    const oldDate = new Date(Date.now() - 50 * 86400000).toISOString();
    const db = {
      query: jest.fn(async () => ({
        rows: [
          { id: 'o1', created_at: oldDate, parcel_statuses: ['collected', 'available'] },
          { id: 'o2', created_at: oldDate, parcel_statuses: ['available', 'shipped'] },
          { id: 'o3', created_at: oldDate, parcel_statuses: ['draft'] },
        ],
      })),
    };
    const alerts = await checkStaleDeliveries(db, { getDetail, backorderMaxD: 45 });
    const codes = alerts.map(a => a.code);
    expect(codes).toEqual(
      expect.arrayContaining(['PARTIAL_COLLECTED_STALE', 'PARTIAL_AVAILABLE_STALE', 'AWAITING_STOCK_EXPIRED'])
    );
  });

  it('n\'inclut pas AWAITING_STOCK_EXPIRED si le délai n\'est pas dépassé', async () => {
    const recentDate = new Date(Date.now() - 10 * 86400000).toISOString();
    const db = {
      query: jest.fn(async () => ({
        rows: [{ id: 'o1', created_at: recentDate, parcel_statuses: ['draft'] }],
      })),
    };
    const alerts = await checkStaleDeliveries(db, { getDetail, backorderMaxD: 45 });
    expect(alerts.find(a => a.code === 'AWAITING_STOCK_EXPIRED')).toBeUndefined();
  });
});
