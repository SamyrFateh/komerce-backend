'use strict';

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../scripts/aliexpress-500-catalog-sync', () => ({ SUPPLIER_NAME: 'AliExpress', stockSqlPredicate: jest.fn(() => 'TRUE') }));
jest.mock('../../services/suppliers/catalog-import-orchestrator', () => ({ importCatalog: jest.fn() }));

const { SURFACE_ID, plan } = require('../../services/suppliers/aliexpress-feed-topup-runtime');

describe('aliexpress-feed-topup-runtime', () => {
  test('construit un plan feed puis feed x catégorie borné', () => {
    const feeds = Array.from({ length: 90 }, (_, i) => `feed-${i + 1}`);
    const categories = Array.from({ length: 60 }, (_, i) => ({ id: String(i + 1), name: `cat-${i + 1}` }));
    const slots = plan(feeds, categories);
    expect(SURFACE_ID).toBe('feed-category-v1');
    expect(slots).toHaveLength((80 * 2) + (48 * 3));
    expect(slots[0]).toEqual({ feed: 'feed-1', page: 1, categoryId: null, categoryName: null });
    expect(slots[160]).toEqual({ feed: 'feed-1', page: 1, categoryId: '1', categoryName: 'cat-1' });
  });
});
