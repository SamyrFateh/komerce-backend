'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../../scripts/seed-golden-product', () => ({
  seedGoldenProduct: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/local-stock-service', () => ({
  setLocalStock: jest.fn().mockResolvedValue({ id: 'ls-1' }),
  setLocalStockExposure: jest.fn().mockResolvedValue({ id: 'ls-1', commercial_exposure: 'ENABLED' }),
}));

const db = require('../../db');
const { seedGoldenProduct } = require('../../scripts/seed-golden-product');
const { setLocalStock, setLocalStockExposure } = require('../../services/local-stock-service');
const {
  STAGING_MEDIA,
  GOLDEN_PRODUCT,
  CJ_LOCAL_PRODUCTS,
  PROVIDERS,
  PHYSICAL_OFFERS,
  SERVICES,
  buildDiscoveryCandidates,
  resolveCjLocalProducts,
  shouldSeedDiscoveryStaging,
  seedDiscoveryStaging,
} = require('../../scripts/seed-discovery-staging');
const goldenFixture = require('../../tests/fixtures/catalog/golden-elite-pro');

const ORIGINAL_ENV = { ...process.env };
const MARKET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CATEGORY_BY_FAMILY = Object.freeze({
  women: 'Mode & Beauté', beauty: 'Mode & Beauté',
  comfort: 'Maison', kitchen: 'Maison',
  phones: 'Tech', audio: 'Tech',
  tools: 'Bricolage', electric: 'Bricolage',
  ceremony: 'Créations personnelles', gift: 'Créations personnelles',
  filters: 'Auto', 'car-light': 'Auto',
});
const CJ_ROWS = CJ_LOCAL_PRODUCTS.map((product, index) => ({
  id: `bbbb${String(index + 1).padStart(4, '0')}-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  product_ref: `KPR-${131333 + index}`,
  sort_order: product.sortOrder,
  qtyPhysical: product.qtyPhysical,
  category: CATEGORY_BY_FAMILY[product.family],
  subcategory: 'Test',
  image_url: `https://cf.cjdropshipping.com/local-${index}.jpg`,
}));

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.KOMERCE_ENV;
  delete process.env.NODE_ENV;
  delete process.env.DISCOVERY_STAGING_SEED_ENABLED;
});

afterAll(() => { process.env = ORIGINAL_ENV; });

test('seed impossible en production même avec le flag explicite', async () => {
  process.env.KOMERCE_ENV = 'production';
  process.env.DISCOVERY_STAGING_SEED_ENABLED = 'true';
  expect(shouldSeedDiscoveryStaging()).toBe(false);
  await expect(seedDiscoveryStaging()).resolves.toEqual({
    seeded: false,
    reason: 'staging-only-opt-in',
  });
  expect(db.query).not.toHaveBeenCalled();
  expect(db.withTransaction).not.toHaveBeenCalled();
  expect(seedGoldenProduct).not.toHaveBeenCalled();
});

test('staging reste sans écriture tant que le flag seed est absent', async () => {
  process.env.KOMERCE_ENV = 'staging';
  expect(shouldSeedDiscoveryStaging()).toBe(false);
  await seedDiscoveryStaging();
  expect(db.query).not.toHaveBeenCalled();
});

test('résout 12 produits CJ réels par slots déterministes et conserve leur ordre éditorial', async () => {
  db.query.mockResolvedValueOnce({ rows: [...CJ_ROWS].reverse() });

  const products = await resolveCjLocalProducts();

  const sql = db.query.mock.calls[0][0];
  expect(sql).toMatch(/sourcing_source = \$1/);
  expect(sql).toMatch(/sort_order = ANY/);
  expect(sql).toContain("product_ref NOT LIKE 'SHOWCASE-V2-%'");
  expect(products.map(product => product.sort_order)).toEqual(
    CJ_LOCAL_PRODUCTS.map(product => product.sortOrder)
  );
  expect(products.map(product => product.id)).toEqual(CJ_ROWS.map(row => row.id));
  expect(products.every(product => product.image_url.startsWith('https://'))).toBe(true);
});

test('un représentant CJ absent fait échouer le seed au lieu de dégrader silencieusement le rail', async () => {
  db.query.mockResolvedValueOnce({ rows: CJ_ROWS.slice(0, 11) });
  await expect(resolveCjLocalProducts()).rejects.toThrow(/Représentant CJ local introuvable/);
});

test('staging opt-in seeds 13 produits locaux dont 12 CJ + providers in transaction', async () => {
  process.env.KOMERCE_ENV = 'staging';
  process.env.DISCOVERY_STAGING_SEED_ENABLED = 'yes';
  db.query
    .mockResolvedValueOnce({ rows: [{ id: MARKET_ID }] })
    .mockResolvedValueOnce({ rows: CJ_ROWS });

  const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  db.withTransaction.mockImplementation(async callback => callback(client));

  const result = await seedDiscoveryStaging();
  expect(result.seeded).toBe(true);
  expect(result.market).toBe('KM');
  expect(result.product).toBe(goldenFixture.productRow().id);
  expect(result.products).toBe(13);
  expect(result.cjProducts).toBe(12);
  expect(result.providers).toBe(5);
  expect(result.physicalOffers).toBe(4);
  expect(result.services).toBe(7);
  expect(result.candidates.split(',')).toHaveLength(18);

  expect(seedGoldenProduct).toHaveBeenCalledTimes(1);

  expect(setLocalStock).toHaveBeenCalledTimes(13);
  expect(setLocalStockExposure).toHaveBeenCalledTimes(13);
  expect(setLocalStock).toHaveBeenCalledWith(expect.objectContaining({
    productId: goldenFixture.productRow().id,
    qtyPhysical: 25,
  }));
  expect(setLocalStockExposure).toHaveBeenCalledWith(
    goldenFixture.productRow().id,
    MARKET_ID,
    'ENABLED',
    'KM_MAIN'
  );
  for (const [index, row] of CJ_ROWS.entries()) {
    expect(setLocalStock).toHaveBeenCalledWith(expect.objectContaining({
      productId: row.id,
      qtyPhysical: CJ_LOCAL_PRODUCTS[index].qtyPhysical,
    }));
    expect(setLocalStockExposure).toHaveBeenCalledWith(
      row.id,
      MARKET_ID,
      'ENABLED',
      'KM_MAIN'
    );
  }

  expect(db.withTransaction).toHaveBeenCalledTimes(1);
  expect(client.query).toHaveBeenCalledTimes(
    PROVIDERS.length + PHYSICAL_OFFERS.length + SERVICES.length
  );

  const sql = client.query.mock.calls.map(call => call[0]).join('\n');
  expect(sql).toMatch(/INSERT INTO providers/);
  expect(sql).toMatch(/INSERT INTO physical_offers/);
  expect(sql).toMatch(/INSERT INTO services/);
  expect(sql).toMatch(/image_ref/);
  expect(sql).toMatch(/public_phone/);
  expect(sql).toMatch(/public_whatsapp/);
  expect(sql).toMatch(/actions_enabled/);
  expect(sql).toMatch(/commercial_exposure = 'ENABLED'/);

  expect(PHYSICAL_OFFERS.every(x => x.imageRef && x.imageRef.startsWith('/boutique/'))).toBe(true);
  expect(SERVICES.every(x => x.imageRef && x.imageRef.startsWith('/boutique/'))).toBe(true);
  expect(Object.values(STAGING_MEDIA).every(x => x.endsWith('.webp'))).toBe(true);
});

test('le dataset staging éprouve réellement les combinaisons cumulatives', () => {
  const mechanic = SERVICES.find(service => service.title === 'Mécanique automobile');
  expect(mechanic.actions).toEqual(['quote', 'callback', 'call', 'whatsapp']);

  const samboussas = PHYSICAL_OFFERS.find(offer => offer.title === 'Samboussas au bœuf');
  expect(samboussas.actions).toEqual(['request', 'call', 'whatsapp']);

  expect(PROVIDERS.some(provider => provider.publicPhone && provider.publicWhatsapp)).toBe(true);
  expect(PROVIDERS.some(provider => !provider.publicPhone && !provider.publicWhatsapp)).toBe(true);
});

test('le plan CJ local couvre les six univers avec exactement deux produits par catégorie', () => {
  expect(CJ_LOCAL_PRODUCTS).toHaveLength(12);
  const counts = CJ_LOCAL_PRODUCTS.reduce((acc, product) => {
    const category = CATEGORY_BY_FAMILY[product.family];
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});
  expect(counts).toEqual({
    'Mode & Beauté': 2,
    Maison: 2,
    Tech: 2,
    Bricolage: 2,
    'Créations personnelles': 2,
    Auto: 2,
  });
});

test('l’ordre Discovery donne Golden + 12 CJ, 2 offres et 3 services avec scopes locaux', () => {
  const productIds = [GOLDEN_PRODUCT.id, ...CJ_ROWS.map(row => row.id)];
  const candidates = buildDiscoveryCandidates(productIds);

  expect(candidates).toHaveLength(18);
  expect(candidates.filter(candidate => candidate.startsWith('product:'))).toHaveLength(13);
  expect(candidates.filter(candidate => candidate.startsWith('physical_offer:'))).toHaveLength(2);
  expect(candidates.filter(candidate => candidate.startsWith('service:'))).toHaveLength(3);
  expect(candidates[0]).toBe(`product:${goldenFixture.productRow().id}`);
  expect(candidates).toContain(`service:${SERVICES[6].id}@Maison|Tech`);
  expect(candidates).toContain(`service:${SERVICES[2].id}@Bricolage|Tech`);
  expect(candidates).toContain(`physical_offer:${PHYSICAL_OFFERS[2].id}@Bricolage`);
  expect(candidates).toContain(`physical_offer:${PHYSICAL_OFFERS[1].id}@Maison|Créations personnelles`);
  expect(candidates).toContain(`service:${SERVICES[3].id}@Auto`);
});

test('un rail partiel ne réintroduit jamais de référence Showcase', () => {
  const candidates = buildDiscoveryCandidates([GOLDEN_PRODUCT.id, CJ_ROWS[0].id]);
  expect(candidates.join(',')).not.toContain('SHOWCASE-V2');
  expect(candidates[0]).toBe(`product:${GOLDEN_PRODUCT.id}`);
  expect(candidates[1]).toBe(`product:${CJ_ROWS[0].id}`);
});
