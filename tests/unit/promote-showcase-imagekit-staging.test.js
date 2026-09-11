'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  FLAG,
  DEFAULT_MARKETS,
  runtimePromotionGuard,
  parseMarketCodes,
  parseArgs,
  validateHostedProducts,
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
    });
  });

  test('autorise explicitement une cible staging jusqu’à 500', () => {
    expect(parseArgs([
      'promote', '--replace-active', '--target', '500', '--input', 'data/catalogue-test-raw/showcase-curated-staging-500.json',
    ])).toMatchObject({ target: 500, replaceActive: true });
    expect(() => parseArgs(['promote', '--replace-active', '--target', '501'])).toThrow(/entre 1 et 500/);
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
});