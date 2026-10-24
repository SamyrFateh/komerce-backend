'use strict';
jest.mock('../../db', () => ({ query: jest.fn() }));
const db = require('../../db');
const { listRct1Orders } = require('../../services/dashboard-rct1-orders');

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
