'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
}));

jest.mock('../../services/catalog-market-exposure-service', () => ({
  EXPOSURE: { ENABLED: 'ENABLED', DISABLED: 'DISABLED' },
  setExposure: jest.fn().mockResolvedValue({ commercial_exposure: 'ENABLED' }),
}));

jest.mock('../../services/market-commercial-price-service', () => ({
  setMarketPriceDraft: jest.fn().mockResolvedValue({ decision_status: 'DRAFT_PENDING_GATE' }),
  resetMarketPriceDraft: jest.fn().mockResolvedValue({ decision_status: 'RESET_TO_GLOBAL_BASE' }),
}));

jest.mock('../../utils/currency', () => ({
  projectAmount: jest.fn(async amount => Number(amount)),
  roundToMinorUnit: jest.fn((amount, minorUnit) => {
    const factor = 10 ** Number(minorUnit || 0);
    return Math.round(Number(amount) * factor) / factor;
  }),
}));

const db = require('../../db');
const catalogExposure = require('../../services/catalog-market-exposure-service');
const marketCommercialPrice = require('../../services/market-commercial-price-service');
const { projectAmount, roundToMinorUnit } = require('../../utils/currency');
const {
  PRICE_SOURCE,
  DEFAULT_PRODUCT_COUNT,
  REQUIRED_CATEGORIES,
  marketTags,
  marketProfile,
  isProductionRuntime,
  loadCuratedCatalog,
  validateCuratedCatalog,
  selectCuratedProducts,
  ensureProducts,
  localDraftAmountForProduct,
  prepareProductsForMarket,
  createOrder,
  cleanup,
  main,
} = require('../../scripts/seed-market-test-data');

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_EXIT_CODE = process.exitCode;

beforeEach(() => {
  jest.clearAllMocks();
  projectAmount.mockImplementation(async amount => Number(amount));
  roundToMinorUnit.mockImplementation((amount, minorUnit) => {
    const factor = 10 ** Number(minorUnit || 0);
    return Math.round(Number(amount) * factor) / factor;
  });
  catalogExposure.setExposure.mockResolvedValue({ commercial_exposure: 'ENABLED' });
  marketCommercialPrice.setMarketPriceDraft.mockResolvedValue({ decision_status: 'DRAFT_PENDING_GATE' });
  marketCommercialPrice.resetMarketPriceDraft.mockResolvedValue({ decision_status: 'RESET_TO_GLOBAL_BASE' });
  process.env = { ...ORIGINAL_ENV };
  delete process.env.NODE_ENV;
  delete process.env.KOMERCE_ENV;
  process.exitCode = undefined;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
  process.exitCode = ORIGINAL_EXIT_CODE;
});

test('namespace uniquement les fixtures opérationnelles par code marché', () => {
  expect(marketTags('cm')).toEqual({
    code: 'CM',
    refPrefix: 'SEEDTEST-CM-',
    relaisName: 'SEEDTEST CM relais',
  });
  expect(marketTags('CG').refPrefix).toBe('SEEDTEST-CG-');
  expect(marketTags('KM').refPrefix).toBe('SEEDTEST-KM-');
});

test('les profils de relais ne réutilisent pas le +269 hors Comores', () => {
  expect(marketProfile({ code: 'KM', name: 'Comores' }).phonePrefix).toBe('+269');
  expect(marketProfile({ code: 'CM', name: 'Cameroun' }).phonePrefix).toBe('+237');
  expect(marketProfile({ code: 'CG', name: 'Congo' }).phonePrefix).toBe('+242');
});

test('refuse production depuis NODE_ENV ou KOMERCE_ENV', () => {
  process.env.NODE_ENV = 'production';
  expect(isProductionRuntime()).toBe(true);

  delete process.env.NODE_ENV;
  process.env.KOMERCE_ENV = 'production';
  expect(isProductionRuntime()).toBe(true);

  process.env.KOMERCE_ENV = 'staging';
  expect(isProductionRuntime()).toBe(false);
});

test('le manifeste curaté V1 passe le quality gate et couvre les rayons requis', () => {
  const catalog = loadCuratedCatalog();
  const report = validateCuratedCatalog(catalog);

  expect(catalog).toHaveLength(20);
  expect(report.count).toBe(20);
  for (const category of REQUIRED_CATEGORIES) {
    expect(report.categories).toContain(category);
  }
  expect(catalog.every(product => product.curated === true)).toBe(true);
  expect(catalog.some(product => /^SEEDTEST/i.test(product.name))).toBe(false);
});

test('le quality gate refuse les faux produits génériques', () => {
  const catalog = loadCuratedCatalog();
  const broken = catalog.map(product => ({ ...product }));
  broken[0] = {
    ...broken[0],
    name: 'Produit 1',
    description: 'Raw test product: fake fixture that should never reach staging.',
  };

  expect(() => validateCuratedCatalog(broken)).toThrow(/nom produit non curaté|description insuffisante ou brute/);
});

test('la sélection de 15 produits reste déterministe et couvre chaque rayon requis', () => {
  const catalog = loadCuratedCatalog();
  const selected = selectCuratedProducts(catalog, DEFAULT_PRODUCT_COUNT);

  expect(selected).toHaveLength(DEFAULT_PRODUCT_COUNT);
  expect(new Set(selected.map(product => product.product_ref)).size).toBe(DEFAULT_PRODUCT_COUNT);
  for (const category of REQUIRED_CATEGORIES) {
    expect(selected.some(product => product.category === category)).toBe(true);
  }
});

test('ensureProducts upsert le catalogue global par product_ref sans namespace pays', async () => {
  db.query.mockImplementation(async (_sql, params) => ({
    rows: [{
      id: `id-${params[0]}`,
      product_ref: params[0],
      name: params[1],
      description: params[2],
      category: params[3],
      subcategory: params[4],
      price_kmf: params[5],
      image_url: params[7],
      stock: params[9],
    }],
  }));

  const products = await ensureProducts(3);

  expect(products).toHaveLength(3);
  expect(db.query).toHaveBeenCalledTimes(3);
  for (const [sql, params] of db.query.mock.calls) {
    expect(sql).toMatch(/ON CONFLICT \(product_ref\)/);
    expect(params[0]).toMatch(/^KPR-990\d{3}$/);
    expect(params[1]).not.toMatch(/^SEEDTEST/);
  }
});

test('projette le prix KMF vers la devise canonique du marché et respecte minor_unit', async () => {
  projectAmount.mockResolvedValueOnce(19999.6);

  const amount = await localDraftAmountForProduct(
    { id: 'product-cm-1', product_ref: 'KPR-990001', price_kmf: 15000 },
    { id: 'market-cm-id', code: 'CM', currency: 'XAF', minor_unit: 0 }
  );

  expect(projectAmount).toHaveBeenCalledWith(15000, 'KMF', 'XAF');
  expect(roundToMinorUnit).toHaveBeenCalledWith(19999.6, 0);
  expect(amount).toBe(20000);
});

test('un produit sans product_ref canonique bloque la préparation avant toute décision locale', async () => {
  await expect(localDraftAmountForProduct(
    { id: 'product-cm-1', price_kmf: 12000 },
    { id: 'market-cm-id', code: 'CM', currency: 'XAF', minor_unit: 0 }
  )).rejects.toThrow(/sans product_ref canonique/);

  expect(projectAmount).not.toHaveBeenCalled();
  expect(catalogExposure.setExposure).not.toHaveBeenCalled();
  expect(marketCommercialPrice.setMarketPriceDraft).not.toHaveBeenCalled();
});

test('prépare chaque produit sur le même Market ID: exposition ENABLED + prix local DRAFT', async () => {
  const market = {
    id: 'market-cm-id',
    code: 'CM',
    name: 'Cameroun',
    currency: 'XAF',
    minor_unit: 0,
  };
  const products = [
    { id: 'product-1', product_ref: 'KPR-990001', price_kmf: 12000 },
    { id: 'product-2', product_ref: 'KPR-990002', price_kmf: 18000 },
  ];
  projectAmount
    .mockResolvedValueOnce(16000)
    .mockResolvedValueOnce(24000);

  const result = await prepareProductsForMarket(products, market);

  expect(result).toEqual({ exposed: 2, drafts: 2 });
  expect(catalogExposure.setExposure).toHaveBeenCalledTimes(2);
  expect(catalogExposure.setExposure).toHaveBeenNthCalledWith(
    1, 'product-1', 'market-cm-id', 'ENABLED', null
  );
  expect(catalogExposure.setExposure).toHaveBeenNthCalledWith(
    2, 'product-2', 'market-cm-id', 'ENABLED', null
  );

  expect(marketCommercialPrice.setMarketPriceDraft).toHaveBeenCalledTimes(2);
  expect(marketCommercialPrice.setMarketPriceDraft).toHaveBeenNthCalledWith(1, {
    market,
    productRef: 'KPR-990001',
    amount: 16000,
    reason: 'SEEDTEST CM prix local de test',
    source: PRICE_SOURCE,
    actorId: null,
  });
});

test('createOrder écrit le market_id et projette total_eur via Currency Boundary', async () => {
  const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
  projectAmount.mockResolvedValueOnce(24.4);
  db.query
    .mockResolvedValueOnce({ rows: [{ id: 'order-1' }] })
    .mockResolvedValueOnce({ rows: [] });

  await createOrder({
    marketId: 'market-cm-id',
    marketCode: 'CM',
    relaisId: 'relais-cm-id',
    products: [{ id: 'product-cm-1', price_kmf: 12000 }],
  });

  randomSpy.mockRestore();

  expect(projectAmount).toHaveBeenCalledWith(12000, 'KMF', 'EUR');
  const [orderSql, orderParams] = db.query.mock.calls[0];
  expect(orderSql).toMatch(/reference, relais_id, market_id/);
  expect(orderParams[0]).toMatch(/^SEEDTEST-CM-/);
  expect(orderParams[1]).toBe('relais-cm-id');
  expect(orderParams[2]).toBe('market-cm-id');
  expect(orderParams[4]).toBe(24.4);
});

test('createOrder fail-closed si marketId manque', async () => {
  await expect(createOrder({
    marketId: null,
    marketCode: 'CM',
    relaisId: 'relais-cm-id',
    products: [{ id: 'product-cm-1', price_kmf: 12000 }],
  })).rejects.toThrow(/marketId is required/);
  expect(db.query).not.toHaveBeenCalled();
});

test('cleanup CM préserve le catalogue global et retire seulement la projection CM', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [
      { id: 'product-1', product_ref: 'KPR-990001' },
      { id: 'product-2', product_ref: 'KPR-990002' },
    ] })
    .mockResolvedValueOnce({ rows: [] });

  const market = { id: 'market-cm-id', code: 'CM', name: 'Cameroun', currency: 'XAF' };
  await cleanup(market);

  const [selectSql, selectParams] = db.query.mock.calls[0];
  expect(selectSql).toMatch(/reference LIKE \$1 AND market_id = \$2/);
  expect(selectParams).toEqual(['SEEDTEST-CM-%', 'market-cm-id']);

  const allSql = db.query.mock.calls.map(([sql]) => sql).join('\n');
  expect(allSql).not.toMatch(/DELETE FROM products/);

  expect(catalogExposure.setExposure).toHaveBeenCalledTimes(2);
  expect(catalogExposure.setExposure).toHaveBeenNthCalledWith(
    1, 'product-1', 'market-cm-id', 'DISABLED', null
  );
  expect(marketCommercialPrice.resetMarketPriceDraft).toHaveBeenCalledTimes(2);
  expect(marketCommercialPrice.resetMarketPriceDraft).toHaveBeenNthCalledWith(1, {
    market,
    productRef: 'KPR-990001',
    reason: 'SEEDTEST CM cleanup staging',
    source: PRICE_SOURCE,
    actorId: null,
  });

  const [deleteRelaisSql, deleteRelaisParams] = db.query.mock.calls[4];
  expect(deleteRelaisSql).toMatch(/DELETE FROM relais/);
  expect(deleteRelaisParams).toEqual(['SEEDTEST CM relais', 'market-cm-id']);
});

test('--cleanup sans --market est refusé avant toute lecture DB', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  await main(['node', 'seed-market-test-data.js', '--cleanup']);

  expect(process.exitCode).toBe(1);
  expect(db.query).not.toHaveBeenCalled();
  errorSpy.mockRestore();
});
