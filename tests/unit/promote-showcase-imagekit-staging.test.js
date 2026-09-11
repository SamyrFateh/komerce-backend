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

  test('valide uniquement des médias ImageKit canoniques du namespace showcase-v2', () => {
    expect(validateHostedProducts([hostedProduct()], 1)).toEqual({ products: 1, refs: 1, images: 1 });

    expect(() => validateHostedProducts([
      hostedProduct({ image_url: 'https://res.cloudinary.com/demo/image/upload/a.jpg', images: ['https://res.cloudinary.com/demo/image/upload/a.jpg'] }),
    ], 1)).toThrow(/non ImageKit canonique/);
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
