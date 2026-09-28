'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db', () => ({ query: jest.fn() }));
const db = require('../../db');
const { readRunProgress } = require('../../services/catalog-run-progress');
const { publicCatalogVisibilitySql } = require('../../services/catalog-public-view');

const draft = (ref, overrides = {}) => ({
  product_ref: ref, name: 'Lampe de bureau', category: 'maison', price_kmf: 100,
  description: 'Lampe de bureau pour la maison.', lifecycle_status: 'candidate',
  is_active: false, needs_review: false, content_source: 'manual', active_media: 1,
  ...overrides,
});
const marketCounts = (overrides = {}) => ({
  awaiting_validation: 0, hidden: 0, exposed_refs: [], visible_refs: [], ...overrides,
});

test('partitions drafts, readiness, publications and other lifecycle without inventing publication', async () => {
  const q = { query: jest.fn()
    .mockResolvedValueOnce({ rows: [draft('A'), draft('B', { content_source: 'connector_raw' }),
      draft('C', { needs_review: true }), draft('D', { active_media: 0 }),
      draft('E', { is_active: true }), draft('F', { lifecycle_status: 'archived' })] })
    .mockResolvedValueOnce({ rows: [] }) };
  const result = await readRunProgress(['A','B','C','D','E','F','G','A'], q);
  expect(result.catalog).toEqual({ received: 6, preparing: 3, ready: 1, published: 1, other: 1, missing: 1 });
  expect(result.items.find(p => p.product_ref === 'D').reason).toMatch(/média/);
  expect(result.items).toHaveLength(6);
  expect(result).toMatchObject({ available: true, markets: [], exposed_products: 0, visible_products: 0 });
  expect(q.query.mock.calls[0][1]).toEqual([['A','B','C','D','E','F','G']]);
  expect(q.query.mock.calls[0][0]).toContain('WHERE p.product_ref = ANY($1::text[])');
  expect(q.query.mock.calls.every(([sql]) => !/\b(?:INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(true);
});

test('scopes every market to the cohort and counts unique visible products instead of adding countries', async () => {
  const q = { query: jest.fn()
    .mockResolvedValueOnce({ rows: [draft('A'), draft('B', { is_active: true })] })
    .mockResolvedValueOnce({ rows: [{ code:'KM', name:'Comores' }, { code:'CM', name:'Cameroun' }] })
    .mockResolvedValueOnce({ rows: [marketCounts({ awaiting_validation:1, exposed_refs:['B'], visible_refs:['B'] })] })
    .mockResolvedValueOnce({ rows: [marketCounts({ hidden:1, exposed_refs:['B'] })] }) };
  const result = await readRunProgress(['A','B'], q);
  expect(result.visible_products).toBe(1);
  expect(result.exposed_products).toBe(1);
  expect(result.markets).toEqual([
    { code:'KM', name:'Comores', awaiting_validation:1, hidden:0, exposed:1, visible:1 },
    { code:'CM', name:'Cameroun', awaiting_validation:0, hidden:1, exposed:1, visible:0 },
  ]);
  for (const [sql, params] of q.query.mock.calls.slice(2)) {
    expect(params[0]).toEqual(['A','B']);
    expect(params[2]).toEqual(['A']);
    expect(sql).toContain(publicCatalogVisibilitySql('p', { marketCodeParamIndex: 2 }));
    expect(sql).toContain('pme.product_id IS NULL');
  }
});

test('empty cohort stays empty and uses default executor', async () => {
  db.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
  const result = await readRunProgress([]);
  expect(result.catalog.received).toBe(0);
  expect(result.items).toEqual([]);
  expect(db.query.mock.calls[0][1]).toEqual([[]]);
});

test('failed observation rejects rather than returning invented zeroes', async () => {
  await expect(readRunProgress(['A'], { query: jest.fn().mockRejectedValue(new Error('offline')) }))
    .rejects.toThrow('offline');
});
