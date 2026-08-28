'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
const db = require('../../db');
const service = require('../../services/client-index');

const MARKET_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => jest.clearAllMocks());

function row(overrides = {}) {
  return {
    name: 'Amina',
    phone: '+2691234567',
    orders_total: 4,
    orders_valid: 3,
    ltv_kmf: 180000,
    average_basket_kmf: 60000,
    first_order_at: '2026-06-01T10:00:00Z',
    last_order_at: '2026-08-20T10:00:00Z',
    days_since_last_order: 8,
    markets: ['KM'],
    total_count: 1,
    ...overrides,
  };
}

test('normalise recherche, pagination et tri dans des bornes fermées', () => {
  expect(service.normalizeSearch('  Amina  ')).toBe('Amina');
  expect(service.normalizeSearch('x'.repeat(100))).toHaveLength(80);
  expect(service.normalizePage('3')).toBe(3);
  expect(service.normalizePage('0')).toBe(1);
  expect(service.normalizePageSize('500')).toBe(100);
  expect(service.normalizePageSize('bad')).toBe(25);
  expect(service.normalizeSort('ltv')).toBe('ltv');
  expect(service.normalizeSort('DROP TABLE')).toBe('recent');
});

test('scopeFilter reste global avec null et échoue fermé sans marché', () => {
  expect(service.scopeFilter(null, 1)).toEqual({ sql: '', params: [] });
  expect(service.scopeFilter([], 1)).toEqual({ sql: ' AND FALSE', params: [] });
  expect(service.scopeFilter([MARKET_ID], 2)).toEqual({
    sql: ' AND o.market_id = ANY($2::uuid[])',
    params: [[MARKET_ID]],
  });
});

test('index marché applique le scope avant agrégation et ne publie aucune UUID', async () => {
  db.query.mockResolvedValue({ rows: [row()] });
  const payload = await service.listClients(
    { search: 'Amina', sort: 'orders', page: 2, page_size: 10 },
    { marketIds: [MARKET_ID], market: { code: 'KM', name: 'Comores', currency: 'KMF' }, now: '2026-08-28T10:00:00Z' }
  );

  const [sql, params] = db.query.mock.calls[0];
  expect(sql).toContain('o.market_id = ANY($1::uuid[])');
  expect(sql).toContain('ORDER BY orders_valid DESC');
  expect(sql).toContain('LOWER(COALESCE(name');
  expect(params).toEqual([[MARKET_ID], '%amina%', 10, 10]);
  expect(payload.scope).toEqual({ mode: 'market', market: { code: 'KM', name: 'Comores', currency: 'KMF' } });
  expect(payload.pagination).toEqual({ page: 2, page_size: 10, total: 1, total_pages: 1 });
  expect(payload.clients[0]).toMatchObject({ phone: '+2691234567', orders_valid: 3, ltv_kmf: 180000, markets: ['KM'] });
  expect(JSON.stringify(payload)).not.toContain(MARKET_ID);
});

test('index global sans résultat garde total_pages à zéro et paramètres strictement bornés', async () => {
  db.query.mockResolvedValue({ rows: [] });
  const payload = await service.listClients({ sort: 'invalid' }, { marketIds: null, now: 0 });

  const [sql, params] = db.query.mock.calls[0];
  expect(sql).not.toContain('market_id = ANY');
  expect(sql).toContain('ORDER BY last_order_at DESC');
  expect(params).toEqual([25, 0]);
  expect(payload.scope).toEqual({ mode: 'global', market: null });
  expect(payload.pagination.total_pages).toBe(0);
  expect(payload.clients).toEqual([]);
});
