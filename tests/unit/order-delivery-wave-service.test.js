/**
 * @komerce-arch
 * @role          unit-order-delivery-wave
 * @domain        orders
 * @layer         test
 * @criticality   critical
 * @inputs        mock transactional pg executor
 * @outputs       deterministic assertions on reference/wave invariants
 * @depends       services/order-delivery-wave-service.js
 * @db-read       none
 * @db-write      none
 * @db-txn        mock
 * @impact-areas  orders, checkout, pickup, logistics
 * @version       2026-11
 */
'use strict';

jest.mock('../../services/relais-mutation-service', () => ({
  ensureRelaisShortCode: jest.fn().mockResolvedValue('YAO1'),
}));
const waves = require('../../services/order-delivery-wave-service');
const { ensureRelaisShortCode } = require('../../services/relais-mutation-service');

describe('order delivery waves — single commercial reference', () => {
  beforeEach(() => jest.clearAllMocks());

  test('four characters identify a wave; a letter is a first-character visual cue only', () => {
    for (let n = 0; n < 200; n++) {
      const c = waves.randomClientCode();
      expect(c).toMatch(/^[A-HJ-NP-Z][A-HJ-NP-Z2-9]{3}$/);
      expect(waves.buildReference({
        marketCode: 'CM', relayCode: 'YAO1', clientCode: c, suffix: 'X8',
      })).toMatch(/^CM-YAO1-[A-HJ-NP-Z][A-HJ-NP-Z2-9]{3}-X8$/);
    }
  });

  test('staging flag is explicit; production activation fails closed', () => {
    expect(waves.wavesEnabled({ KOMERCE_ENV: 'staging' })).toBe(false);
    expect(waves.wavesEnabled({ KOMERCE_ENV: 'staging', KOMERCE_ORDER_WAVES_ENABLED: '1' })).toBe(true);
    expect(() => waves.wavesEnabled({ KOMERCE_ENV: 'production', KOMERCE_ORDER_WAVES_ENABLED: '1' }))
      .toThrow('ORDER_WAVES_STAGING_ONLY');
  });

  test('same buyer and relay reuse their wave; unique order suffix per checkout', async () => {
    const emitted = new Set();
    let existingWave = null;
    const queries = [];
    const client = { query: jest.fn(async (sql, params) => {
      queries.push(sql);
      if (sql.includes('SELECT id FROM relais WHERE')) return { rows: [{ id: 'r1' }] };
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('FROM order_delivery_waves') && sql.includes('FOR UPDATE')) {
        return { rows: existingWave ? [existingWave] : [] };
      }
      if (sql.includes('INSERT INTO order_delivery_waves')) {
        existingWave = { id: 'wave1', client_code: params[3], opened_at: new Date().toISOString() };
        return { rows: [existingWave] };
      }
      if (sql.includes('FROM orders WHERE reference=')) return { rows: emitted.has(params[0]) ? [{ id: 'old' }] : [] };
      throw new Error('unexpected query: ' + sql);
    }) };
    const p = { userId: 'u1', marketId: 'm1', relaisId: 'r1', marketCode: 'CM' };
    const a = await waves.reserveWaveReference(client, p);
    emitted.add(a.reference);
    const b = await waves.reserveWaveReference(client, p);
    expect(a.waveId).toBe('wave1');
    expect(b.waveId).toBe('wave1');
    expect(a.clientCode).toBe(b.clientCode);
    expect(a.reference).not.toBe(b.reference);
    expect(a.reference).toMatch(/^CM-YAO1-[A-HJ-NP-Z][A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{2}$/);
    expect(ensureRelaisShortCode).toHaveBeenCalledTimes(2);
    expect(queries.filter(q => q.includes('INSERT INTO order_delivery_waves'))).toHaveLength(1);
  });

  test('first proven handoff closes admission in the same transaction', async () => {
    const before = process.env.KOMERCE_ENV;
    const beforeFlag = process.env.KOMERCE_ORDER_WAVES_ENABLED;
    try {
      process.env.KOMERCE_ENV = 'staging';
      process.env.KOMERCE_ORDER_WAVES_ENABLED = '1';
      const query = jest.fn().mockResolvedValue({ rows: [{ id: 'wave1' }] });
      await expect(waves.closeWaveOnFirstHandoff({ query }, 'order1')).resolves.toBe(true);
      expect(query.mock.calls[0][0]).toContain("close_reason='FIRST_HANDOFF'");
      expect(query.mock.calls[0][1]).toEqual(['order1']);
    } finally {
      if (before === undefined) delete process.env.KOMERCE_ENV;
      else process.env.KOMERCE_ENV = before;
      if (beforeFlag === undefined) delete process.env.KOMERCE_ORDER_WAVES_ENABLED;
      else process.env.KOMERCE_ORDER_WAVES_ENABLED = beforeFlag;
    }
  });
});
