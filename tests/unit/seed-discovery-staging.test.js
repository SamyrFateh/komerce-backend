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
  SHOWCASE_LOCAL_PRODUCTS,
  PROVIDERS,
  PHYSICAL_OFFERS,
  SERVICES,
  buildDiscoveryCandidates,
  resolveShowcaseLocalProducts,
  shouldSeedDiscoveryStaging,
  seedDiscoveryStaging,
} = require('../../scripts/seed-discovery-staging');
const goldenFixture = require('../../tests/fixtures/catalog/golden-elite-pro');

const ORIGINAL_ENV = { ...process.env };
const MARKET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SHOWCASE_ROWS = SHOWCASE_LOCAL_PRODUCTS.map((product, index) => ({
  id: `bbbb${String(index + 1).padStart(4, '0')}-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  product_ref: product.productRef,
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

test('résout les produits Showcase V2 par refs stables et conserve leur ordre éditorial', async () => {
  db.query.mockResolvedValueOnce({ rows: [...SHOWCASE_ROWS].reverse() });

  const products = await resolveShowcaseLocalProducts();

  expect(db.query).toHaveBeenCalledWith(
    expect.stringMatching(/product_ref = ANY/),
    [SHOWCASE_LOCAL_PRODUCTS.map(product => product.productRef)]
  );
  expect(products.map(product => product.productRef)).toEqual(
    SHOWCASE_LOCAL_PRODUCTS.map(product => product.productRef)
  );
  expect(products.map(product => product.id)).toEqual(SHOWCASE_ROWS.map(row => row.id));
});

test('une ref Showcase absente est ignorée sans créer de faux produit', async () => {
  db.query.mockResolvedValueOnce({ rows: SHOWCASE_ROWS.slice(0, 3) });

  const products = await resolveShowcaseLocalProducts();

  expect(products).toHaveLength(3);
  expect(products.map(product => product.productRef)).toEqual(
    SHOWCASE_LOCAL_PRODUCTS.slice(0, 3).map(product => product.productRef)
  );
});

test('staging opt-in seeds 8 produits locaux + providers in transaction', async () => {
  process.env.KOMERCE_ENV = 'staging';
  process.env.DISCOVERY_STAGING_SEED_ENABLED = 'yes';
  db.query
    .mockResolvedValueOnce({ rows: [{ id: MARKET_ID }] })
    .mockResolvedValueOnce({ rows: SHOWCASE_ROWS });

  const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  db.withTransaction.mockImplementation(async callback => callback(client));

  const result = await seedDiscoveryStaging();
  expect(result.seeded).toBe(true);
  expect(result.market).toBe('KM');
  expect(result.product).toBe(goldenFixture.productRow().id);
  expect(result.products).toBe(8);
  expect(result.showcaseProducts).toBe(7);
  expect(result.providers).toBe(5);
  expect(result.physicalOffers).toBe(4);
  expect(result.services).toBe(7);
  expect(result.candidates.split(',')).toHaveLength(12);

  // Golden Product seeded via son owner catalog.
  expect(seedGoldenProduct).toHaveBeenCalledTimes(1);

  // 8 Products Komerce réellement exposés en local-stock : Golden + 7 V2.
  expect(setLocalStock).toHaveBeenCalledTimes(8);
  expect(setLocalStockExposure).toHaveBeenCalledTimes(8);
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
  for (const [index, row] of SHOWCASE_ROWS.entries()) {
    expect(setLocalStock).toHaveBeenCalledWith(expect.objectContaining({
      productId: row.id,
      qtyPhysical: SHOWCASE_LOCAL_PRODUCTS[index].qtyPhysical,
    }));
    expect(setLocalStockExposure).toHaveBeenCalledWith(
      row.id,
      MARKET_ID,
      'ENABLED',
      'KM_MAIN'
    );
  }

  // Providers/offers/services via transaction.
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

test('les refs Showcase couvrent plusieurs univers et restent stables', () => {
  expect(SHOWCASE_LOCAL_PRODUCTS.map(product => product.productRef)).toEqual([
    'SHOWCASE-V2-0020',
    'SHOWCASE-V2-0100',
    'SHOWCASE-V2-0140',
    'SHOWCASE-V2-0230',
    'SHOWCASE-V2-0320',
    'SHOWCASE-V2-0405',
    'SHOWCASE-V2-0440',
  ]);
  expect(new Set(SHOWCASE_LOCAL_PRODUCTS.map(product => product.productRef)).size).toBe(7);
});

test('l’ordre Discovery donne 8 Products Komerce, 2 offres et 2 services', () => {
  const productIds = [GOLDEN_PRODUCT.id, ...SHOWCASE_ROWS.map(row => row.id)];
  const candidates = buildDiscoveryCandidates(productIds);

  expect(candidates).toHaveLength(12);
  expect(candidates.filter(candidate => candidate.startsWith('product:'))).toHaveLength(8);
  expect(candidates.filter(candidate => candidate.startsWith('physical_offer:'))).toHaveLength(2);
  expect(candidates.filter(candidate => candidate.startsWith('service:'))).toHaveLength(2);
  expect(candidates[0]).toBe(`product:${goldenFixture.productRow().id}`);
  expect(candidates).toEqual([
    `product:${productIds[0]}`,
    `product:${productIds[1]}`,
    `physical_offer:${PHYSICAL_OFFERS[0].id}`,
    `product:${productIds[2]}`,
    `product:${productIds[3]}`,
    `service:${SERVICES[6].id}`,
    `product:${productIds[4]}`,
    `product:${productIds[5]}`,
    `physical_offer:${PHYSICAL_OFFERS[2].id}`,
    `product:${productIds[6]}`,
    `product:${productIds[7]}`,
    `service:${SERVICES[1].id}`,
  ]);
});

test('le rail reste valable si Showcase V2 est partiellement absent', () => {
  const candidates = buildDiscoveryCandidates([GOLDEN_PRODUCT.id, SHOWCASE_ROWS[0].id]);

  expect(candidates).toEqual([
    `product:${GOLDEN_PRODUCT.id}`,
    `product:${SHOWCASE_ROWS[0].id}`,
    `physical_offer:${PHYSICAL_OFFERS[0].id}`,
    `service:${SERVICES[6].id}`,
    `physical_offer:${PHYSICAL_OFFERS[2].id}`,
    `service:${SERVICES[1].id}`,
  ]);
});
