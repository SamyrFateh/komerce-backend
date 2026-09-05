'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../db', () => ({
  query: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../../services/local-stock-service', () => ({
  setLocalStock: jest.fn().mockResolvedValue({}),
  setLocalStockExposure: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../scripts/cj-real-showcase-seed', () => ({
  slotSortOrder: (familyIndex, slotIndex) => -1063 + familyIndex * 3 + slotIndex,
}));

const db = require('../../db');
const { setLocalStock, setLocalStockExposure } = require('../../services/local-stock-service');
const repair = require('../../scripts/discovery-cj-local-repair');

const MARKET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function cjRow(config, index) {
  return {
    id: `bbbb${String(index + 1).padStart(4, '0')}-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    product_ref: `KPR-${131333 + index}`,
    sort_order: config.sortOrder,
    qtyPhysical: config.qtyPhysical,
    category: index < 2 ? 'Mode & Beauté' : ['Maison', 'Tech', 'Bricolage', 'Créations personnelles', 'Auto'][index - 2],
    subcategory: 'Test',
    image_url: `https://cf.cjdropshipping.com/product-${index}.jpg`,
  };
}

beforeEach(() => jest.clearAllMocks());

test('le plan local ne dépend plus d’aucune ref SHOWCASE-V2 et couvre les six univers', () => {
  expect(repair.CJ_LOCAL_PRODUCTS.map(item => item.sortOrder)).toEqual([
    -1063, -1054, -1051, -1039, -1030, -1021, -1012,
  ]);
  expect(new Set(repair.CJ_LOCAL_PRODUCTS.map(item => item.sortOrder)).size).toBe(7);

  const source = fs.readFileSync(
    path.resolve(__dirname, '../../scripts/discovery-cj-local-repair.js'),
    'utf8'
  );
  expect(source).not.toMatch(/productRef:\s*['"]SHOWCASE-V2-/);
  expect(source).toContain("SUPPLIER = 'CJdropshipping'");
  expect(source).toContain('publicCatalogVisibilitySql');
});

test('resolveCjProducts exige 7 vrais produits CJ publiables et conserve l’ordre éditorial', async () => {
  const rows = repair.CJ_LOCAL_PRODUCTS.map(cjRow).reverse();
  db.query.mockResolvedValueOnce({ rows });

  const products = await repair.resolveCjProducts();

  expect(db.query).toHaveBeenCalledWith(
    expect.stringContaining("p.sourcing_source = $1"),
    ['CJdropshipping', repair.CJ_LOCAL_PRODUCTS.map(item => item.sortOrder)]
  );
  const sql = db.query.mock.calls[0][0];
  expect(sql).toContain("p.product_ref NOT LIKE 'SHOWCASE-V2-%'");
  expect(sql).toContain("p.image_url NOT ILIKE 'data:image/%'");
  expect(sql).toContain("NULLIF(BTRIM(p.image_url), '') IS NOT NULL");

  expect(products.map(item => item.sort_order)).toEqual(
    repair.CJ_LOCAL_PRODUCTS.map(item => item.sortOrder)
  );
  expect(products.every(item => item.image_url.startsWith('https://'))).toBe(true);
});

test('un représentant CJ manquant fait échouer le repair au lieu de dégrader silencieusement le rail', async () => {
  db.query.mockResolvedValueOnce({
    rows: repair.CJ_LOCAL_PRODUCTS.slice(0, 6).map(cjRow),
  });

  await expect(repair.resolveCjProducts()).rejects.toThrow(/Représentant CJ local introuvable/);
});

test('les 7 CJ passent par le owner local-stock et sont exposés commercialement', async () => {
  const products = repair.CJ_LOCAL_PRODUCTS.map(cjRow);
  await repair.exposeCjProducts(MARKET_ID, products);

  expect(setLocalStock).toHaveBeenCalledTimes(7);
  expect(setLocalStockExposure).toHaveBeenCalledTimes(7);
  for (const [index, product] of products.entries()) {
    expect(setLocalStock).toHaveBeenCalledWith({
      productId: product.id,
      marketId: MARKET_ID,
      location: 'KM_MAIN',
      qtyPhysical: repair.CJ_LOCAL_PRODUCTS[index].qtyPhysical,
    });
    expect(setLocalStockExposure).toHaveBeenCalledWith(
      product.id, MARKET_ID, 'ENABLED', 'KM_MAIN'
    );
  }
});

test('la politique éditoriale reste bornée à 12 cartes avec Golden + 7 CJ + 4 objets locaux', () => {
  const products = repair.CJ_LOCAL_PRODUCTS.map(cjRow);
  const candidates = repair.buildCandidates(products);

  expect(candidates).toHaveLength(12);
  expect(candidates.filter(item => item.startsWith('product:'))).toHaveLength(8);
  expect(candidates.filter(item => item.startsWith('physical_offer:'))).toHaveLength(2);
  expect(candidates.filter(item => item.startsWith('service:'))).toHaveLength(2);
  expect(candidates[0]).toBe('product:aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa0001');
  expect(candidates.some(item => item.endsWith('@Maison'))).toBe(true);
  expect(candidates.some(item => item.includes('@Maison|Bricolage'))).toBe(true);
});

test('Discovery Product réutilise le même gate public que GET /api/products', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../services/discovery-rail-composer.js'),
    'utf8'
  );
  expect(source).toContain("const { publicCatalogVisibilitySql } = require('./catalog-public-view')");
  expect(source).toContain("AND ${publicCatalogVisibilitySql('p')}");
});
