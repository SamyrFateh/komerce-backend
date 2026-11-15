'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * PDP same-category fallback: only public products with LOCAL_ACTIVE prices.
 */
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/catalog-public-view', () => ({
  canonicalProductImageSql: jest.fn(() => 'p.image_url'),
  publicCatalogVisibilitySql: jest.fn(() => 'TRUE'),
}));
jest.mock('../../services/market-local-price-resolution-service', () => ({
  applyActiveMarketPricesToCatalogRows: jest.fn(),
}));

const db = require('../../db');
const {
  applyActiveMarketPricesToCatalogRows,
} = require('../../services/market-local-price-resolution-service');
const { computeSuggestions } = require('../../services/boutique-ranking-engine');

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const C = '33333333-3333-3333-3333-333333333333';
const D = '44444444-4444-4444-4444-444444444444';
const E = '55555555-5555-5555-5555-555555555555';
function item(id, category, subcategory, other = {}) {
  return {
    id, product_ref: 'KPR-' + id.slice(0, 3), name: id,
    category, subcategory, price_kmf: 17990, compatibility_group: null,
    is_active: true, sale_count: 0, image_url: '/image.webp',
    ...other,
  };
}
const anchor = item(A, 'Mode femme', 'Chemises');

beforeEach(() => {
  jest.clearAllMocks();
  applyActiveMarketPricesToCatalogRows.mockImplementation(async (executor, { products }) =>
    products.map((product) => ({
      ...product,
      market_price_source: 'LOCAL_ACTIVE',
      purchasable: true,
    }))
  );
});

test('sans chemise sœur, les autres vêtements même catégorie redeviennent suggérables', async () => {
  db.query.mockResolvedValue({ rows: [
    anchor,
    item(B, 'Mode femme', 'Débardeurs'),
    item(C, 'Maison', 'Vaisselle'),
  ] });
  const result = await computeSuggestions({ pdpMarketCode: 'KM', viewed_product_id: A, limit: 3 });
  expect(result.suggestions).toHaveLength(1);
  expect(result.suggestions[0]).toEqual(expect.objectContaining({
    product_id: B, reason_code: 'popular_in_category',
  }));
  expect(result.suggestions.map((p) => p.product_id)).not.toContain(A);
  expect(result.suggestions.map((p) => p.product_id)).not.toContain(C);
  expect(applyActiveMarketPricesToCatalogRows).toHaveBeenCalledWith(db, expect.objectContaining({ marketCode: 'KM' }));
});

test('compatibilité et même sous-catégorie restent devant le fallback catégorie', async () => {
  db.query.mockResolvedValue({ rows: [
    item(A, 'Mode femme', 'Chemises', { compatibility_group: 'tenue' }),
    item(B, 'Mode femme', 'Débardeurs'),
    item(C, 'Mode femme', 'Chemises'),
    item(D, 'Accessoires', 'Ceintures', { compatibility_group: 'tenue' }),
  ] });
  const result = await computeSuggestions({ pdpMarketCode: 'KM', viewed_product_id: A, limit: 3 });
  expect(result.suggestions.map((p) => p.product_id)).toEqual([D, C, B]);
  expect(result.suggestions.map((p) => p.reason_code)).toEqual([
    'complement_compat', 'same_subcategory', 'popular_in_category',
  ]);
});

test('ne recommande ni un prix non actif, ni un produit non achetable', async () => {
  db.query.mockResolvedValue({ rows: [anchor, item(B, 'Mode femme', 'Débardeurs'), item(C, 'Mode femme', 'Vestes')] });
  applyActiveMarketPricesToCatalogRows.mockImplementation(async (_, { products }) =>
    products.map((product) => ({
      ...product,
      market_price_source: product.id === B ? 'DRAFT' : 'LOCAL_ACTIVE',
      purchasable: product.id !== C,
    }))
  );
  const result = await computeSuggestions({ pdpMarketCode: 'KM', viewed_product_id: A, limit: 3 });
  expect(result.count).toBe(0);
});

test('sans produit ancre réellement exposé, aucune recommandation n’est inventée', async () => {
  db.query.mockResolvedValue({ rows: [item(B, 'Mode femme', 'Chemises'), item(C, 'Mode femme', 'Robes')] });
  const result = await computeSuggestions({ pdpMarketCode: 'KM', viewed_product_id: A, limit: 3 });
  expect(result.suggestions).toEqual([]);
  expect(applyActiveMarketPricesToCatalogRows).not.toHaveBeenCalled();
});

test('un ancre isolée reste sans suggestion plutôt que montrer des catégories sans lien', async () => {
  db.query.mockResolvedValue({ rows: [anchor, item(B, 'Maison', 'Décoration')] });
  const result = await computeSuggestions({ pdpMarketCode: 'KM', viewed_product_id: A, limit: 3 });
  expect(result.suggestions).toEqual([]);
});
