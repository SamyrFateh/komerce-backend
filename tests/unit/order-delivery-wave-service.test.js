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
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

jest.mock('../../services/relais-mutation-service', () => ({
  ensureRelaisShortCode: jest.fn().mockResolvedValue('YA01'),
}));
const waves = require('../../services/order-delivery-wave-service');
const { ensureRelaisShortCode } = require('../../services/relais-mutation-service');

describe('order delivery waves — référence commerciale unique', () => {
  beforeEach(() => jest.clearAllMocks());

  test('nomenclature exacte, groupe B7Q + ordre 01, sans deuxième référence', () => {
    for (let n = 0; n < 100; n++) {
      const c = waves.randomClientCode('B');
      expect(c).toMatch(/^B[A-HJ-NP-Z2-9]{2}$/);
      expect(waves.buildReference({
        marketCode: 'CM', relayCode: 'YA01', clientCode: c, orderNumber: 1,
      })).toMatch(/^CM-YA01-B[A-HJ-NP-Z2-9]{2}01$/);
    }
    expect(waves.buildReference({ marketCode: 'CM', relayCode: 'YA01',
      clientCode: 'B7Q', orderNumber: 1 })).toBe('CM-YA01-B7Q01');
    expect(waves.buildReference({ marketCode: 'CM', relayCode: 'YA01',
      clientCode: 'B7Q', orderNumber: 99 })).toBe('CM-YA01-B7Q99');
    expect(() => waves.buildReference({ marketCode: 'CM', relayCode: 'YA01',
      clientCode: 'B7Q', orderNumber: 100 })).toThrow('ORDER_WAVE_REFERENCE_PART_INVALID');
  });

  test('rotation A-Z, puis A, mais répartition par quantités actives', () => {
    expect(waves.chooseLetter([])).toBe('A');
    expect(waves.chooseLetter([{ letter: 'A', units: 3, allocations: 1 }])).toBe('B');
    expect(waves.chooseLetter([
      { letter: 'A', units: 3, allocations: 1 },
      { letter: 'B', units: 9, allocations: 1 },
    ])).toBe('C');
    expect(waves.chooseLetter('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter, i) => ({
      letter, units: i === 2 ? 0 : 20, allocations: 1,
    })))).toBe('C');
    expect(waves.chooseLetter('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => ({
      letter, units: 0, allocations: 1,
    })))).toBe('A');
  });

  test('staging flag explicite ; activation production refusée', () => {
    expect(waves.wavesEnabled({ KOMERCE_ENV: 'staging' })).toBe(false);
    expect(waves.wavesEnabled({ KOMERCE_ENV: 'staging', KOMERCE_ORDER_WAVES_ENABLED: '1' })).toBe(true);
    expect(() => waves.wavesEnabled({ KOMERCE_ENV: 'production', KOMERCE_ORDER_WAVES_ENABLED: '1' }))
      .toThrow('ORDER_WAVES_STAGING_ONLY');
  });

  function fakeClient() {
    const activeByRecipient = new Map();
    const counters = new Map();
    const allocations = [];
    const query = jest.fn(async (sql, params = []) => {
      if (sql.includes('SELECT id FROM relais WHERE')) return { rows: [{ id: 'r1' }] };
      if (sql.includes('SELECT id FROM recipients WHERE')) return { rows: [{ id: params[0] }] };
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('FROM order_delivery_waves') && sql.includes('FOR UPDATE')) {
        return { rows: activeByRecipient.has(params[0]) ? [activeByRecipient.get(params[0])] : [] };
      }
      if (sql.includes('sum(CASE WHEN closed_at')) {
        return { rows: allocations.length ? [{ letter: 'A', units: 5, allocations: 1 }] : [] };
      }
      if (sql.includes('INSERT INTO order_delivery_waves')) {
        const rec = { id: 'wave-' + params[0], client_code: params[3],
          opened_at: new Date().toISOString(), next_order_number: 1 };
        activeByRecipient.set(params[0], rec);
        allocations.push(rec);
        counters.set(rec.id, 1);
        return { rows: [rec] };
      }
      if (sql.includes('UPDATE order_delivery_waves') && sql.includes('next_order_number=')) {
        const n = counters.get(params[0]);
        if (n !== params[2]) return { rows: [] };
        counters.set(params[0], n + 1);
        const wave = [...activeByRecipient.values()].find(r => r.id === params[0]);
        wave.next_order_number = n + 1;
        return { rows: [{ id: params[0] }] };
      }
      throw new Error('Unexpected query: ' + sql);
    });
    return { client: { query }, activeByRecipient, counters };
  }

  test('une vague regroupe les commandes 01 puis 02 et compte les articles attendus', async () => {
    const { client, counters } = fakeClient();
    const p = { userId: 'u1', recipientId: 'r1', marketId: 'm1', relaisId: 'r1', marketCode: 'CM' };
    const a = await waves.reserveWaveReference(client, { ...p, expectedUnits: 3 });
    const b = await waves.reserveWaveReference(client, { ...p, expectedUnits: 2 });
    expect(a.waveId).toBe(b.waveId);
    expect(a.clientCode).toBe(b.clientCode);
    expect(a.reference).toMatch(/^CM-YA01-A[A-HJ-NP-Z2-9]{2}01$/);
    expect(b.reference).toBe(a.reference.slice(0, -2) + '02');
    expect(counters.get(a.waveId)).toBe(3);
    expect(client.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO order_delivery_waves'))).toHaveLength(1);
    expect(client.query.mock.calls.filter(([sql]) => sql.includes('planned_units=planned_units+$2'))
      .map(([, params]) => params[1])).toEqual([3, 2]);
    expect(ensureRelaisShortCode).toHaveBeenCalledTimes(2);
  });

  test('destinataires distincts au même relais : groupe distinct, même acheteur possible', async () => {
    const { client } = fakeClient();
    const base = { userId: 'buyer1', marketId: 'm1', relaisId: 'r1', marketCode: 'CM' };
    const a = await waves.reserveWaveReference(client, { ...base, recipientId: 'recipient1' });
    const b = await waves.reserveWaveReference(client, { ...base, recipientId: 'recipient2' });
    expect(a.waveId).not.toBe(b.waveId);
    expect(a.clientCode[0]).toBe('A');
    expect(b.clientCode[0]).toBe('B');
  });

  test('refus destinataire étranger avant réservation', async () => {
    const client = { query: jest.fn(async sql => {
      if (sql.includes('SELECT id FROM relais WHERE')) return { rows: [{ id: 'r1' }] };
      if (sql.includes('SELECT id FROM recipients WHERE')) return { rows: [] };
      throw new Error('unexpected SQL: ' + sql);
    }) };
    await expect(waves.reserveWaveReference(client, {
      userId: 'u1', recipientId: 'foreign', marketId: 'm1', relaisId: 'r1', marketCode: 'CM',
    })).rejects.toThrow('ORDER_WAVE_RECIPIENT_NOT_VERIFIED');
  });

  test('première remise ferme la vague dans la même transaction', async () => {
    const before = process.env.KOMERCE_ENV;
    const flag = process.env.KOMERCE_ORDER_WAVES_ENABLED;
    try {
      process.env.KOMERCE_ENV = 'staging';
      process.env.KOMERCE_ORDER_WAVES_ENABLED = '1';
      const query = jest.fn().mockResolvedValue({ rows: [{ id: 'wave1' }] });
      await expect(waves.closeWaveOnFirstHandoff({ query }, 'order1')).resolves.toBe(true);
      expect(query.mock.calls[0][0]).toContain("close_reason='FIRST_HANDOFF'");
    } finally {
      if (before == null) delete process.env.KOMERCE_ENV; else process.env.KOMERCE_ENV = before;
      if (flag == null) delete process.env.KOMERCE_ORDER_WAVES_ENABLED; else process.env.KOMERCE_ORDER_WAVES_ENABLED = flag;
    }
  });
});
