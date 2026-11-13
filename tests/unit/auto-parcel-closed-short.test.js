'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({ query: jest.fn(), withTransaction: jest.fn() }));
jest.mock('../../utils/logger', () => ({ child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }));
jest.mock('../../utils/reference', () => ({ generateParcelRef: jest.fn().mockResolvedValue('KOM-P-2026-000001') }));

const { distributeOrder } = require('../../services/auto-parcel');

function clientFor(item) {
  const inserted = [];
  const query = jest.fn(async (sql, params) => {
    if (/FOR UPDATE/.test(sql)) return { rows: [] };
    if (/FROM orders o/.test(sql)) return { rows: [{ id: 'o1', reference: 'CMD-1', status: 'preparation', relais_id: 'r1', relais_island: 'Anjouan' }] };
    if (/SELECT 1 AS assigned/.test(sql)) return { rows: [] };
    if (/SELECT oi.id, oi.quantity/.test(sql)) return { rows: [item] };
    if (/FROM parcels p/.test(sql)) return { rows: [] };
    if (/INSERT INTO parcels/.test(sql)) return { rows: [{ id: 'p1', reference: 'KOM-P-2026-000001' }] };
    if (/INSERT INTO parcel_items/.test(sql)) { inserted.push(params); return { rows: [], rowCount: 1 }; }
    return { rows: [] };
  });
  return { query, inserted };
}

describe('H1 / HB-02 — répartition du reçu après rupture définitive', () => {
  const base = { id: 'oi1', quantity: 10, product_id: 'pr1', fulfillment_source: 'IMPORT' };

  test('ligne soldée : le colis part avec la quantité reçue', async () => {
    const c = clientFor({ ...base, received: 6, closed_short: true });
    const res = await distributeOrder('o1', c);
    expect(res.items_assigned).toBe(1);
    expect(c.inserted[0]).toEqual(['p1', 'oi1', 6, 'pr1']);
  });

  test('sans rupture soldée : reçu partiel = article non prêt, aucun colis', async () => {
    const c = clientFor({ ...base, received: 6, closed_short: false });
    const res = await distributeOrder('o1', c);
    expect(res.nothing_eligible).toBe(true);
    expect(c.inserted).toHaveLength(0);
  });

  test('rupture totale (rien reçu) : aucun colis', async () => {
    const c = clientFor({ ...base, received: 0, closed_short: true });
    expect((await distributeOrder('o1', c)).nothing_eligible).toBe(true);
  });
});
