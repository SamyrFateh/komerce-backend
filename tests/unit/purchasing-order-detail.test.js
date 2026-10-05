'use strict';
/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/purchasing-grouped-service', () => ({ getGroupedPurchaseOrder: jest.fn() }));
const db = require('../../db');
const { getGroupedPurchaseOrder } = require('../../services/purchasing-grouped-service');
const { getPurchaseOrderDetail } = require('../../services/purchasing-order-detail');

const PO = '00000000-0000-0000-0000-000000000001';
const detail = { purchase_order: { id: PO }, lines: [{ market_id: 'KM' }, { market_id: 'CM' }], markets: ['KM', 'CM'], multi_market: true };
const empty = { orders: [], order_lines: [], groups: [], group_members: [], payments: [], proofs: [], events: [] };

beforeEach(() => { jest.resetAllMocks(); });

test('adds the execution projection without changing the existing detail or market scope', async () => {
  getGroupedPurchaseOrder.mockResolvedValueOnce(detail);
  db.query.mockResolvedValueOnce({ rows: [{ execution: empty }] });
  const result = await getPurchaseOrderDetail(PO);
  expect(getGroupedPurchaseOrder).toHaveBeenCalledWith(PO, db);
  expect(result).toEqual({ ...detail, supplier_execution: empty });
  expect(result.lines).toBe(detail.lines);
  expect(db.query).toHaveBeenCalledTimes(1);
  expect(db.query.mock.calls[0][1]).toEqual([PO]);
  expect(detail).not.toHaveProperty('supplier_execution');
});

test('uses the supplied query interface and preserves ambiguity, nulls and decimal currency facts', async () => {
  const execution = { ...empty, payments: [{ id: 'payment', expected_amount: '99999999999999.1234', observed_amount: null, currency: 'USD', status: 'ambiguous', reconciliation_status: 'unverified', real_debit_verified: false }] };
  const q = { query: jest.fn().mockResolvedValue({ rows: [{ execution }] }) };
  getGroupedPurchaseOrder.mockResolvedValueOnce(detail);
  expect((await getPurchaseOrderDetail(PO, q)).supplier_execution).toBe(execution);
  expect(getGroupedPurchaseOrder).toHaveBeenCalledWith(PO, q);
  expect(db.query).not.toHaveBeenCalled();
});

test.each(['INVALID_INPUT', 'PURCHASE_ORDER_NOT_FOUND', 'PURCHASE_ORDER_NOT_GROUPED'])('propagates %s before any execution read', async (code) => {
  const error = Object.assign(new Error(code), { code });
  getGroupedPurchaseOrder.mockRejectedValueOnce(error);
  await expect(getPurchaseOrderDetail(PO)).rejects.toBe(error);
  expect(db.query).not.toHaveBeenCalled();
});

test('does not turn an unavailable execution source into an empty successful projection', async () => {
  getGroupedPurchaseOrder.mockResolvedValueOnce(detail);
  const error = new Error('execution relation unavailable');
  db.query.mockRejectedValueOnce(error);
  await expect(getPurchaseOrderDetail(PO)).rejects.toBe(error);
});
