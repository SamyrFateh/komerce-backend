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
  FLAG,
  DEFAULT_PRODUCT_COUNT,
  REQUIRED_CATEGORIES,
  marketTags,
  marketProfile,
  isTruthy,
  runtimeSeedGuard,
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
  delete process.env.MARKET_STAGING_SEED_ENABLED;
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

test('KOMERCE_ENV=staging prime NODE_ENV=production pour la vérité business du runtime', () => {
  process.env.NODE_ENV = 'production';
  process.env.KOMERCE_ENV = 'staging';

  expect(isProductionRuntime()).toBe(false);
  expect(runtimeSeedGuard()).toMatchObject({
    env: 'staging',
    source: 'KOMERCE_ENV',
    optIn: false,
    allowed: false,
  });
});

test('fallback NODE_ENV=production reste fail-closed si KOMERCE_ENV est absent', () => {
  process.env.NODE_ENV = 'production';

  expect(isProductionRuntime()).toBe(true);
  expect(runtimeSeedGuard()).toMatchObject({
    env: 'production',
    source: 'NODE_ENV',
    allowed: false,
  });
});

test('KOMERCE_ENV=production reste production même si NODE_ENV=test', () => {
  process.env.NODE_ENV = 'test';
  process.env.KOMERCE_ENV = 'production';

  expect(isProductionRuntime()).toBe(true);
  expect(runtimeSeedGuard()).toMatchObject({
    env: 'production',
    source: 'KOMERCE_ENV',
    allowed: false,
  });
});

test('écriture staging exige un opt-in explicite, le dry-run non', () => {
  process.env.KOMERCE_ENV = 'staging';

  expect(FLAG).toBe('MARKET_STAGING_SEED_ENABLED');
  expect(isTruthy('true')).toBe(true);
  expect(isTruthy('1')).toBe(true);
  expect(runtimeSeedGuard()).toMatchObject({ env: 'staging', optIn: false, allowed: false });
  expect(runtimeSeedGuard({ requireOptIn: false })).toMatchObject({ env: 'staging', optIn: false, allowed: true });

  process.env[FLAG] = 'true';
  expect(runtimeSeedGuard()).toMatchObject({ env: 'staging', optIn: true, allowed: true });
});

test('un opt-in ne permet jamais une écriture hors staging', () => {
  process.env.KOMERCE_ENV = 'production';
  process.env[FLAG] = 'true';
  expect(runtimeSeedGuard()).toMatchObject({ env: 'production', optIn: true, allowed: false });

  process.env.KOMERCE_ENV = 'development';
  expect(runtimeSeedGuard()).toMatchObject({ env: 'development', optIn: true, allowed: false });
});

test('main refuse toute écriture staging sans opt-in avant la moindre lecture DB', async () => {
  process.env.KOMERCE_ENV = 'staging';
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  await main(['node', 'seed-market-test-data.js', '--market', 'CM', '--orders', '1']);

  expect(process.exitCode).toBe(1);
  expect(db.query).not.toHaveBeenCalled();
  expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/MARKET_STAGING_SEED_ENABLED=true/));
  errorSpy.mockRestore();
});

test('main dry-run accepte staging sans opt-in et reste sans écriture', async () => {
  process.env.NODE_ENV = 'production';
  process.env.KOMERCE_ENV = 'staging';
  db.query.mockResolvedValueOnce({
    rows: [{ id: 'market-cm-id', code: 'CM', name: 'Cameroun', currency: 'XAF', minor_unit: 0 }],
  });
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

  await main(['node', 'seed-market-test-data.js', '--market', 'CM', '--orders', '1', '--dry-run']);

  expect(process.exitCode).toBeUndefined();
  expect(db.query).toHaveBeenCalledTimes(1);
  expect(db.query.mock.calls[0][0]).toMatch(/SELECT id, code, name, currency, minor_unit FROM markets/);
  expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/Aucune écriture effectuée/));
  expect(catalogExposure.setExposure).not.toHaveBeenCalled();
  expect(marketCommercialPrice.setMarketPriceDraft).not.toHaveBeenCalled();
  logSpy.mockRestore();
});

test('le catalogue curaté V2 agrège 40 produits et couvre les six rayons', () => {
  const catalog = loadCuratedCatalog();
  const report = validateCuratedCatalog(catalog);

  expect(DEFAULT_PRODUCT_COUNT).toBe(40);
  expect(catalog).toHaveLength(40);
  expect(report.count).toBe(40);
  for (const category of REQUIRED_CATEGORIES) {
    expect(report.categories).toContain(category);
  }
  expect(report.categories).toContain('Enfant');
  expect(catalog.every(product => product.curated === true)).toBe(true);
  expect(catalog.some(product => /^SEEDTEST/i.test(product.name))).toBe(false);
});

test('les médias Commons enfant gardent page source, auteur et licence autorisée', () => {
  const commons = loadCuratedCatalog().filter(product => product.source.startsWith('commons:'));

  expect(commons).toHaveLength(4);
  expect(commons.every(product => product.category === 'Enfant')).toBe(true);
  for (const product of commons) {
    expect(product.source_url).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    expect(product.source_author).toBeTruthy();
    expect(['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-3.0']).toContain(product.license);
  }
});

test('le quality gate refuse les faux produits génériques', () => {
  const broken = loadCuratedCatalog().map(product => ({ ...product }));
  broken[0] = {
    ...broken[0],
    name: 'Produit 1',
    description: 'Raw test product: fake fixture that should never reach staging.',
  };

  expect(() => validateCuratedCatalog(broken)).toThrow(/nom produit non curaté|description insuffisante ou brute/);
});

test('le quality gate refuse un média Commons sans licence explicite', () => {
  const broken = loadCuratedCatalog().map(product => ({ ...product }));
  const index = broken.findIndex(product => product.source.startsWith('commons:'));
  broken[index] = { ...broken[index], license: null };

  expect(() => validateCuratedCatalog(broken)).toThrow(/licence Commons non autorisée/);
});

test('la sélection 40 reste déterministe, intercalée et couvre tous les rayons', () => {
  const catalog = loadCuratedCatalog();
  const selected = selectCuratedProducts(catalog, DEFAULT_PRODUCT_COUNT);

  expect(selected).toHaveLength(40);
  expect(new Set(selected.map(product => product.product_ref)).size).toBe(40);
  expect(selected.slice(0, REQUIRED_CATEGORIES.length).map(product => product.category)).toEqual(REQUIRED_CATEGORIES);
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
  expect(db.query.mock.calls.map(([, params]) => params[10])).toEqual([9000, 9001, 9002]);
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

test('--cleanup sans --market est refusé avant toute lecture DB une fois le runtime/opt-in valides', async () => {
  process.env.KOMERCE_ENV = 'staging';
  process.env[FLAG] = 'true';
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  await main(['node', 'seed-market-test-data.js', '--cleanup']);

  expect(process.exitCode).toBe(1);
  expect(db.query).not.toHaveBeenCalled();
  expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/--market est requis/));
  errorSpy.mockRestore();
});
