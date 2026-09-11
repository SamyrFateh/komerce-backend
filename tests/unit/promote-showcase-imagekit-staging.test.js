'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  FLAG,
  DEFAULT_MARKETS,
  DEFAULT_ECONOMIC_REPORT,
  ECONOMIC_AUTHORITY,
  runtimePromotionGuard,
  parseMarketCodes,
  parseArgs,
  validateHostedProducts,
  economicFixtureForProduct,
  syntheticMarketCorridor,
  summarizeEconomicRows,
  auditEconomicCatalog,
} = require('../../scripts/promote-showcase-imagekit-staging');

function hostedProduct(overrides = {}) {
  return {
    product_ref: 'KPR-990001',
    name: 'Palette de fards avec miroir',
    description: 'Palette compacte avec miroir intégré et plusieurs teintes pour varier les maquillages du quotidien.',
    category: 'Beauté',
    subcategory: 'Maquillage',
    price_kmf: 9500,
    stock: 32,
    image_url: 'https://ik.imagekit.io/demo/komerce/staging/showcase-v2/kpr-990001/hero.webp',
    images: ['https://ik.imagekit.io/demo/komerce/staging/showcase-v2/kpr-990001/hero.webp'],
    ...overrides,
  };
}

describe('promote-showcase-imagekit-staging', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  test('exige une promotion explicite et destructive assumée', () => {
    expect(() => parseArgs([])).toThrow(/Commande requise: promote/);
    expect(() => parseArgs(['promote'])).toThrow(/--replace-active/);
    expect(parseArgs(['promote', '--replace-active'])).toMatchObject({
      command: 'promote',
      target: 40,
      markets: [...DEFAULT_MARKETS],
      replaceActive: true,
      economicReport: DEFAULT_ECONOMIC_REPORT,
    });
  });

  test('autorise explicitement une cible staging jusqu’à 500', () => {
    expect(parseArgs([
      'promote', '--replace-active', '--target', '500', '--input', 'data/catalogue-test-raw/showcase-curated-staging-500.json',
    ])).toMatchObject({ target: 500, replaceActive: true });
    expect(() => parseArgs(['promote', '--replace-active', '--target', '501'])).toThrow(/entre 1 et 500/);
  });

  test('accepte une sortie de rapport économique explicite', () => {
    const parsed = parseArgs([
      'promote', '--replace-active', '--economic-report', 'tmp/economic-report.json',
    ]);
    expect(parsed.economicReport).toMatch(/tmp[\\/]economic-report\.json$/);
  });

  test('déduplique et normalise les Market IDs', () => {
    expect(parseMarketCodes('cm, CG,cm,km')).toEqual(['CM', 'CG', 'KM']);
    expect(() => parseMarketCodes('CMR')).toThrow(/ISO alpha-2/);
  });

  test('KOMERCE_ENV=staging prime NODE_ENV=production mais exige opt-in', () => {
    process.env.NODE_ENV = 'production';
    process.env.KOMERCE_ENV = 'staging';
    delete process.env[FLAG];
    expect(runtimePromotionGuard()).toMatchObject({ env: 'staging', optIn: false, allowed: false });

    process.env[FLAG] = '1';
    expect(runtimePromotionGuard()).toMatchObject({ env: 'staging', optIn: true, allowed: true });
  });

  test('une vraie production reste refusée même avec opt-in', () => {
    process.env.KOMERCE_ENV = 'production';
    process.env[FLAG] = '1';
    expect(runtimePromotionGuard()).toMatchObject({ env: 'production', optIn: true, allowed: false });
  });

  test('valide médias, contenu et stock strictement positif', () => {
    expect(validateHostedProducts([hostedProduct()], 1)).toEqual({ products: 1, refs: 1, images: 1, stock_units: 32 });

    expect(() => validateHostedProducts([
      hostedProduct({ image_url: 'https://res.cloudinary.com/demo/image/upload/a.jpg', images: ['https://res.cloudinary.com/demo/image/upload/a.jpg'] }),
    ], 1)).toThrow(/non ImageKit canonique/);
    expect(() => validateHostedProducts([hostedProduct({ stock: 0 })], 1)).toThrow(/stock entier > 0/);
    expect(() => validateHostedProducts([hostedProduct({ description: 'trop court' })], 1)).toThrow(/description curatée/);
  });

  test('refuse shortfall, product_ref dupliqué et média dupliqué', () => {
    expect(() => validateHostedProducts([], 1)).toThrow(/Manifest ImageKit incomplet/);

    const shared = 'https://ik.imagekit.io/demo/komerce/staging/showcase-v2/shared/hero.webp';
    expect(() => validateHostedProducts([
      hostedProduct({ product_ref: 'KPR-990001', image_url: shared, images: [shared] }),
      hostedProduct({ product_ref: 'KPR-990001', image_url: 'https://ik.imagekit.io/demo/komerce/staging/showcase-v2/kpr-990002/hero.webp', images: ['https://ik.imagekit.io/demo/komerce/staging/showcase-v2/kpr-990002/hero.webp'] }),
    ], 2)).toThrow(/product_ref dupliqué/);

    expect(() => validateHostedProducts([
      hostedProduct({ product_ref: 'KPR-990001', image_url: shared, images: [shared] }),
      hostedProduct({ product_ref: 'KPR-990002', image_url: shared, images: [shared] }),
    ], 2)).toThrow(/média dupliqué/);
  });

  test('crée un coût nominal et un poids de staging déterministes sans écraser une source fournie', () => {
    const product = hostedProduct();
    const first = economicFixtureForProduct(product);
    const second = economicFixtureForProduct(product);
    expect(first).toEqual(second);
    expect(first.cost_kmf).toBeGreaterThan(0);
    expect(first.weight_kg).toBeGreaterThan(0);
    expect(first.cost_source).toBe('staging_synthetic');

    const provided = economicFixtureForProduct(hostedProduct({ cost_kmf: 4100, weight_kg: 0.42 }));
    expect(provided).toMatchObject({
      cost_kmf: 4100,
      weight_kg: 0.42,
      profile: 'SOURCE_PROVIDED',
      cost_source: 'source',
      weight_source: 'source',
    });
  });

  test('construit une plage marché de test sans la faire passer pour une preuve marché', () => {
    const range = syntheticMarketCorridor(hostedProduct(), 'CM');
    expect(range.authority).toBe(ECONOMIC_AUTHORITY);
    expect(range.sample_count).toBe(3);
    expect(range.low.price_kmf).toBeLessThan(range.target.price_kmf);
    expect(range.high.price_kmf).toBeGreaterThan(range.target.price_kmf);
    expect(range.observations).toEqual([]);
  });

  test('un SKU non viable reste un résultat économique valide et non une erreur catalogue', () => {
    const summary = summarizeEconomicRows([
      { market_code: 'KM', category: 'Tech', status: 'VIABLE' },
      { market_code: 'KM', category: 'Tech', status: 'NON_VIABLE_STRUCTURAL' },
      { market_code: 'CM', category: 'Mode', status: 'VIABLE_UNDER_CONDITIONS' },
    ], { products: 3, markets: 1 });

    expect(summary.errors).toBe(0);
    expect(summary.counts.VIABLE).toBe(1);
    expect(summary.counts.NON_VIABLE_STRUCTURAL).toBe(1);
    expect(summary.counts.VIABLE_UNDER_CONDITIONS).toBe(1);
  });

  test('orchestre le moteur canonique pour chaque couple SKU × Market ID', async () => {
    const products = [
      { id: 'p1', product_ref: 'KPR-990001', category: 'Tech', price_kmf: 10000 },
      { id: 'p2', product_ref: 'KPR-990002', category: 'Mode', price_kmf: 12000 },
    ];
    const ensureMarketFn = jest.fn(async (code) => ({ id: `m-${code}`, code, currency: 'KMF' }));
    const loadConfigFn = jest.fn(async ({ marketId }) => ({ marketId }));
    const recommendFn = jest.fn(async ({ product_id }) => product_id === 'p1'
      ? {
        purchase_cost_kmf: 4000,
        variable_cost_outside_purchase_kmf: 1000,
        variable_cost_complete_kmf: 5000,
        minimum_safe_price_kmf: 6000,
        target_margin_pct: 35,
        safety_margin_pct: 10,
      }
      : {
        purchase_cost_kmf: 13000,
        variable_cost_outside_purchase_kmf: 1000,
        variable_cost_complete_kmf: 14000,
        minimum_safe_price_kmf: 14500,
        target_margin_pct: 35,
        safety_margin_pct: 10,
      });
    const projectViabilityFn = jest.fn((corridor, economics) => {
      const targetContribution = corridor.target.price_kmf - economics.variable_cost_complete_kmf;
      const status = targetContribution > 0 ? 'VIABLE' : 'NON_VIABLE_STRUCTURAL';
      return {
        status,
        label: status,
        sourcing_action: status === 'VIABLE' ? 'KEEP_AND_TEST_SCALE' : 'AVOID_OR_RESOURCE',
        purchase_cost_kmf: economics.purchase_cost_kmf,
        variable_cost_complete_kmf: economics.variable_cost_complete_kmf,
        market_prices_kmf: {
          low: corridor.low.price_kmf,
          target: corridor.target.price_kmf,
          high: corridor.high.price_kmf,
        },
        contribution_scenarios_kmf: { target_kmf: targetContribution },
        purchase_cost_ceiling_at_target_kmf: { safe_kmf: corridor.target.price_kmf - 1000 },
        purchase_cost_gap_to_safe_ceiling_kmf: 500,
        resilience: 'TARGET_DEPENDENT',
        reason: 'test',
      };
    });

    const report = await auditEconomicCatalog(products, ['KM', 'CM'], {
      concurrency: 2,
      ensureMarketFn,
      loadConfigFn,
      recommendFn,
      projectViabilityFn,
    });

    expect(report.authority).toBe(ECONOMIC_AUTHORITY);
    expect(report.summary.expected).toBe(4);
    expect(report.summary.classified).toBe(4);
    expect(report.summary.errors).toBe(0);
    expect(recommendFn).toHaveBeenCalledTimes(4);
    expect(projectViabilityFn).toHaveBeenCalledTimes(4);
  });
});
