'use strict';
jest.mock('../../db', () => ({ query: jest.fn() }));
const db = require('../../db');
const { listRct1Orders, buildRct1Orders, projectCanonicalRct1 } = require('../../services/dashboard-rct1-orders');

beforeEach(() => db.query.mockReset());

test('list RCT1 is read-only, parameterized and never includes real orders', async () => {
  db.query.mockResolvedValue({ rows: [
    { reference: 'RCT1-E1', status: 'collected', market_code: 'KM', total_kmf: 15065 },
    { reference: 'RCT1-CM1', status: 'cancelled', market_code: 'CM', total_kmf: 15065 },
  ] });
  const result = await listRct1Orders();
  expect(result.total).toBe(2);
  expect(result.simulation_scope).toBe('RCT1');
  expect(db.query).toHaveBeenCalledTimes(1);
  expect(db.query.mock.calls[0][0]).toMatch(/o\.simulation_scope = \$1/);
  expect(db.query.mock.calls[0][1]).toEqual(['RCT1', null]);
  expect(db.query.mock.calls[0][0]).not.toMatch(/UPDATE|INSERT|DELETE/i);
});

test('market selection is independent and bound as query parameter', async () => {
  db.query.mockResolvedValue({ rows: [] });
  const result = await listRct1Orders({ marketCode: 'CM' });
  expect(result.total).toBe(0);
  expect(db.query.mock.calls[0][1]).toEqual(['RCT1', 'CM']);
});

test('rejects unexpected market codes without querying DB', async () => {
  await expect(listRct1Orders({ marketCode: 'KM;DROP TABLE orders' })).rejects.toMatchObject({ status: 400 });
  expect(db.query).not.toHaveBeenCalled();
});

test('RCT1 uses the canonical dashboard payload, displaying all seven rows, including terminal orders', () => {
  const statuses = ['collected', 'collected', 'in_transit', 'in_transit', 'in_transit', 'collected', 'cancelled'];
  const result = projectCanonicalRct1({
    mode: 'RCT1',
    orders: statuses.map((status, i) => ({
      reference: `RCT1-${i + 1}`, status,
      payment_status: i === 6 ? 'pending' : 'paid',
      market_code: i === 6 ? 'CM' : 'KM', total_kmf: 15065,
    })),
  });
  expect(result.simulation_scope).toBe('RCT1');
  expect(result.summary.total_orders).toBe(7);
  expect(result.summary.cancelled).toBe(1);
  expect(result.funnel).toMatchObject({
    creees: 6, payees: 6, expediees: 6,
    disponibles_relais: 3, retirees: 3, perdues: 1,
  });
  expect(result.priority_orders).toHaveLength(7);
  expect(result.priority_orders.every(row => row.actionable === false)).toBe(true);
  expect(result.priority_orders[6].market_code).toBe('CM');
  expect(result.summary.orders_to_order).toBeNull();
  expect(result.signals.litiges_ouverts).toBeNull();
  expect(result.work_queues.to_order_total).toBeNull();
});

test('RCT1 never infers missing relations or operational KPIs as zero', () => {
  const result = projectCanonicalRct1({
    mode: 'RCT1',
    orders: [{ reference: 'RCT1-1', status: 'ordered', payment_status: 'paid', market_code: 'KM' }],
  });
  expect(result.priority_orders[0]).toMatchObject({
    client_name: null, product_lines: null, parcel_count: null, relais_name: null,
  });
  expect(result.summary.awaiting_hub_reception).toBeNull();
  expect(result.summary.parcels_to_create).toBeNull();
  expect(result.signals.commandes_bloquees).toBeNull();
});

test('RCT1 uses parameterized market scope via canonical builder', async () => {
  db.query.mockResolvedValue({ rows: [{ reference: 'RCT1-CM1', market_code: 'CM', status: 'cancelled' }] });
  const result = await buildRct1Orders({ marketCode: 'CM' });
  expect(db.query.mock.calls[0][1]).toEqual(['RCT1', 'CM']);
  expect(result.priority_orders).toHaveLength(1);
});
