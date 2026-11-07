'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * Canonical LOCAL_STOCK receiving directly at relay may be collected
 * without synthetic Hub shipped/packed/relais_received catchup.
 */
jest.mock('../../db', () => ({ connect: jest.fn(), query: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
const { _hasCanonicalDirectLocalReceipt } = require('../../services/scan-engine');

function direct() {
  return {
    parcel: { id: 'local-parcel', status: 'available', shipment_id: null,
      shipped_at: null, in_transit_at: null },
    items: [{ quantity: 2, fulfillment_source: 'LOCAL_STOCK',
      qty_received: 2, qty_shipped: 0 }],
  };
}
const proof = () => ({ query: jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) });

describe('direct local relay receipt suppresses fictitious shipment catchup', () => {
  test('verified LOCAL_STOCK at relay is a complete physical receipt', async () => {
    const s = direct(), db = proof();
    await expect(_hasCanonicalDirectLocalReceipt(db, s.parcel, s.items)).resolves.toBe(true);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("step='relais_received'"), [s.parcel.id]);
  });
  test('physical proof is mandatory — never infer receipt from available alone', async () => {
    const s = direct(), db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await expect(_hasCanonicalDirectLocalReceipt(db, s.parcel, s.items)).resolves.toBe(false);
  });
  test('import, legacy shipped local and quantities lacking receipt do not bypass catchup', async () => {
    for (const mutate of [
      s => { s.items[0].fulfillment_source = 'IMPORT'; },
      s => { s.items[0].fulfillment_source = null; },
      s => { s.items[0].qty_shipped = 2; },
      s => { s.items[0].qty_received = 0; },
      s => { s.parcel.shipped_at = '2026-11-07T00:00:00Z'; },
      s => { s.parcel.shipment_id = 'international'; },
      s => { s.parcel.in_transit_at = '2026-11-07T00:00:00Z'; },
      s => { s.parcel.status = 'shipped'; },
      s => { s.items = []; },
    ]) {
      const s = direct(), db = proof();
      mutate(s);
      await expect(_hasCanonicalDirectLocalReceipt(db, s.parcel, s.items)).resolves.toBe(false);
      expect(db.query).not.toHaveBeenCalled();
    }
  });
});
