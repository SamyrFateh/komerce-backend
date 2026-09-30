'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));

const itemEvents = require('../../services/import-runtime-item-events');
const runs = require('../../services/import-runtime-runs');

const T0 = '2026-09-28T10:00:00.000Z';
const NOW = Date.parse('2026-09-28T10:00:20.000Z');

function q(rows = []) {
  return { query: jest.fn().mockResolvedValue({ rows }) };
}

describe('import-runtime-item-events service', () => {
  test('startItem insère un instantané borné et idempotent sur (run_id, seq)', async () => {
    const client = q([{ id: 'ev-1' }]);
    const res = await itemEvents.startItem('run-1', {
      seq: 3,
      product: { supplier_product_id: ' SP-1 ', product_name: 'x'.repeat(500), purchase_price: '12.5', currency: 'EUR' },
    }, client);
    expect(res).toEqual({ id: 'ev-1' });
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (run_id, seq) DO NOTHING');
    expect(params[0]).toBe('run-1');
    expect(params[1]).toBe(3);
    expect(params[2]).toBe('SP-1');
    expect(params[3]).toHaveLength(300);
    expect(params[5]).toBe(12.5);
  });

  test('startItem renvoie null sur conflit et normalise prix / textes invalides', async () => {
    const client = q([]);
    expect(await itemEvents.startItem('run-1', { seq: 1, product: { purchase_price: 'abc', product_name: '  ' } }, client)).toBeNull();
    const params = client.query.mock.calls[0][1];
    expect(params[3]).toBeNull();
    expect(params[5]).toBeNull();
    await itemEvents.startItem('run-1', { seq: 2, product: { purchase_price: -1 } }, client);
    expect(client.query.mock.calls[1][1][5]).toBeNull();
    await itemEvents.startItem('run-1', { seq: 3, product: { purchase_price: '' } }, client);
    expect(client.query.mock.calls[2][1][5]).toBeNull();
  });

  test('startItem refuse un run ou une séquence invalide', async () => {
    await expect(itemEvents.startItem(null, { seq: 1 }, q())).rejects.toThrow('IMPORT_RUNTIME_ITEM_START_INVALID');
    await expect(itemEvents.startItem('r', { seq: 0 }, q())).rejects.toThrow('IMPORT_RUNTIME_ITEM_START_INVALID');
    await expect(itemEvents.startItem('r', undefined, q())).rejects.toThrow('IMPORT_RUNTIME_ITEM_START_INVALID');
  });

  test('finishItem ferme sans jamais reculer avant started_at', async () => {
    const client = q([{ id: 'ev-1' }]);
    expect(await itemEvents.finishItem('ev-1', { outcome: 'deferred', candidateId: 'c-1' }, client)).toEqual({ id: 'ev-1' });
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('GREATEST(NOW(), started_at)');
    expect(params).toEqual(['ev-1', 'deferred', 'c-1']);
    expect(await itemEvents.finishItem(null, {}, client)).toBeNull();
    expect(await itemEvents.finishItem('ev-2', undefined, q([]))).toBeNull();
  });

  test('listRunItems borne la limite (défaut 12, max 50)', async () => {
    const client = q([{ id: 'a' }]);
    expect(await itemEvents.listRunItems('run-1', {}, client)).toEqual([{ id: 'a' }]);
    expect(client.query.mock.calls[0][1]).toEqual(['run-1', 12]);
    await itemEvents.listRunItems('run-1', { limit: 500 }, client);
    expect(client.query.mock.calls[1][1][1]).toBe(50);
    await itemEvents.listRunItems('run-1', { limit: 0 }, client);
    expect(client.query.mock.calls[2][1][1]).toBe(12);
  });
});

describe('projection avec événements produit', () => {
  const run = {
    run_ref: 'KIR-000001', provider: 'AliExpress', source_type: 'api', source_ref: 'aliexpress',
    mode: 'replay', status: 'RUNNING', source_total: 3, import_ref: 'KSI-1',
    started_at: T0, finished_at: null, updated_at: T0, failure_reason: null,
    stages: { SOURCE_CONNECTED: { started_at: T0, finished_at: T0 } }, intake: null,
  };
  const item = (seq, over = {}) => ({
    seq, supplier_product_id: `SP-${seq}`, product_name: `Produit ${seq}`, image_url: null,
    purchase_price: '9.90', currency: 'EUR', stage: 'REFINERY', outcome: null,
    started_at: '2026-09-28T10:00:10.000Z', finished_at: null, ...over,
  });

  test('un produit ouvert est « en cours » et porte prix et durée', () => {
    const p = runs.buildProjection({ run, rows: [], items: [item(2), item(1, { outcome: 'deferred', finished_at: '2026-09-28T10:00:12.000Z' })], now: NOW });
    expect(p.item_events).toBe(true);
    expect(p.current_item_kind).toBe('in_progress');
    expect(p.current_item.seq).toBe(2);
    expect(p.current_item.in_progress).toBe(true);
    expect(p.recent_items).toHaveLength(2);
    expect(p.events.some((e) => e.kind === 'ITEM_FINISHED')).toBe(true);
  });

  test('run terminé : le dernier produit fini devient « dernier traité »', () => {
    const done = { ...run, status: 'COMPLETED', finished_at: '2026-09-28T10:00:15.000Z' };
    const p = runs.buildProjection({ run: done, rows: [], items: [item(1, { outcome: 'deferred', finished_at: '2026-09-28T10:00:12.000Z' })], now: NOW });
    expect(p.current_item_kind).toBe('last_processed');
    expect(p.current_item.in_progress).toBeFalsy();
    expect(p.current_item.duration_ms).toBe(2000);
  });

  test('un produit ouvert depuis plus de 10 min n’est plus présenté comme en cours', () => {
    const p = runs.buildProjection({ run, rows: [], items: [item(1, { started_at: '2026-09-28T09:00:00.000Z' })], now: NOW });
    expect(p.current_item_kind).not.toBe('in_progress');
  });

  test('sans événement, retombe sur le comportement historique', () => {
    const p = runs.buildProjection({ run, rows: [], items: [], now: NOW });
    expect(p.item_events).toBe(false);
    expect(p.current_item_kind).toBeNull();
    expect(p.current_item).toBeNull();
  });
});
