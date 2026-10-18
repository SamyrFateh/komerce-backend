'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assessCashOrderProvenance } = require('../../services/cash-order-provenance-readonly');

test('missing collection remains unproven', async () => {
  const db = { query: async () => ({ rows: [] }) };
  const result = await assessCashOrderProvenance(db, 'order-1');
  assert.equal(result.status, 'MISSING_COLLECTION');
});

test('even CONFIRMED deposit allocation cannot certify final remittance', async () => {
  let calls = 0;
  const db = { query: async () => {
    calls++;
    if (calls === 1) return { rows: [{ id: 'collection-1', order_id: 'order-1', collected_by: 'agent-1', market_id: 'market-1', amount_kmf: '1500' }] };
    return { rows: [{ collection_id: 'collection-1', deposit_id: 'deposit-1', amount_kmf: '1500', allocation_basis: 'CONFIRMED', movement_kind: 'FINAL', status: 'verified' }] };
  } };
  const result = await assessCashOrderProvenance(db, 'order-1');
  assert.equal(result.status, 'FINAL_REMITTANCE_NOT_ATTRIBUTABLE');
  assert.equal(result.final_remittance_proven_kmf, 0);
  assert.equal(result.collections[0].allocations[0].basis, 'CONFIRMED');
  assert.equal(calls, 2);
});

test('FIFO reconstructed allocation is not final proof', async () => {
  let calls = 0;
  const db = { query: async () => {
    calls++;
    return { rows: calls === 1
      ? [{ id: 'collection-1', order_id: 'order-1', collected_by: 'agent-1', market_id: 'market-1', amount_kmf: '100' }]
      : [{ collection_id: 'collection-1', deposit_id: 'deposit-1', amount_kmf: '100', allocation_basis: 'RECONSTRUCTED', movement_kind: 'LEGACY', status: 'verified' }] };
  } };
  const result = await assessCashOrderProvenance(db, 'order-1');
  assert.equal(result.final_remittance_proven_kmf, 0);
});
