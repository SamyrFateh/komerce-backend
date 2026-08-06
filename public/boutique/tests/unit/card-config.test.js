'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/card-config.test.js
 *
 * Lot 3 — js/card-config.js (169L)
 * Source de vérité déclarative pour le rendu des cartes produit.
 * Logique 100% pure (pas de DOM, pas de réseau) : ALLOWED_SOURCES,
 * ALLOWED_CONDITIONS, DEFAULT_CARD_CONFIG, validateCardConfig().
 *
 * Périmètre couvert :
 *   - ALLOWED_SOURCES / ALLOWED_CONDITIONS : forme (Set), contenu attendu
 *   - DEFAULT_CARD_CONFIG : structure stable (version, template, sections)
 *   - validateCardConfig : config absente/non-objet, version ≠ 1, template
 *     non-string, sources non whitelistées (chaque section), conditions de
 *     badges non whitelistées, badges non-array ignoré, config valide
 *     retournée telle quelle
 */

const {
  ALLOWED_SOURCES,
  ALLOWED_CONDITIONS,
  DEFAULT_CARD_CONFIG,
  validateCardConfig,
} = require('../../js/card-config.js');

describe('ALLOWED_SOURCES', () => {
  it('est un Set', () => {
    expect(ALLOWED_SOURCES).toBeInstanceOf(Set);
  });

  it('contient les sources produit et catégorie attendues', () => {
    [
      'product.name',
      'product.image_url',
      'product.price_kmf',
      'product.price_aed',
      'product.category',
      'product.subcategory',
      'product.badge',
      'product.promo_pct',
      'product.stock',
      'product.is_available',
      'category.image_url',
      'category.theme_token',
      'category.accent_token',
    ].forEach((src) => expect(ALLOWED_SOURCES.has(src)).toBe(true));
  });

  it('ne contient pas de source arbitraire', () => {
    expect(ALLOWED_SOURCES.has('product.secret_field')).toBe(false);
    expect(ALLOWED_SOURCES.has('other.name')).toBe(false);
  });
});

describe('ALLOWED_CONDITIONS', () => {
  it('est un Set', () => {
    expect(ALLOWED_CONDITIONS).toBeInstanceOf(Set);
  });

  it('contient les 5 conditions attendues', () => {
    ['always', 'not_empty', 'gt_zero', 'lte_zero', 'is_false'].forEach((c) =>
      expect(ALLOWED_CONDITIONS.has(c)).toBe(true)
    );
  });

  it('ne contient pas une condition inconnue', () => {
    expect(ALLOWED_CONDITIONS.has('mystere')).toBe(false);
  });
});

describe('DEFAULT_CARD_CONFIG', () => {
  it('a la version 1 et le template standard_card_v1', () => {
    expect(DEFAULT_CARD_CONFIG.version).toBe(1);
    expect(DEFAULT_CARD_CONFIG.template).toBe('standard_card_v1');
  });

  it('définit image avec source et fallback en cascade', () => {
    expect(DEFAULT_CARD_CONFIG.image.source).toBe('product.image_url');
    expect(DEFAULT_CARD_CONFIG.image.fallback).toEqual([
      'category.image_url',
      '/images/placeholder-product.png',
    ]);
  });

  it('définit title/subtitle/price avec les sources attendues', () => {
    expect(DEFAULT_CARD_CONFIG.title.source).toBe('product.name');
    expect(DEFAULT_CARD_CONFIG.subtitle.source).toBe('product.subcategory');
    expect(DEFAULT_CARD_CONFIG.subtitle.fallback).toBe('product.category');
    expect(DEFAULT_CARD_CONFIG.price.source).toBe('product.price_kmf');
    expect(DEFAULT_CARD_CONFIG.price.format).toBe('kmf');
  });

  it('définit 3 badges (promo, text, stock) avec leurs conditions', () => {
    expect(DEFAULT_CARD_CONFIG.badges).toHaveLength(3);
    expect(DEFAULT_CARD_CONFIG.badges.map((b) => b.type)).toEqual(['promo', 'text', 'stock']);
    expect(DEFAULT_CARD_CONFIG.badges.every((b) => ALLOWED_CONDITIONS.has(b.condition))).toBe(true);
    expect(DEFAULT_CARD_CONFIG.badges.every((b) => ALLOWED_SOURCES.has(b.source))).toBe(true);
  });

  it('définit stock caché par défaut (visible=false, show_when=lte_zero)', () => {
    expect(DEFAULT_CARD_CONFIG.stock.visible).toBe(false);
    expect(DEFAULT_CARD_CONFIG.stock.show_when).toBe('lte_zero');
  });

  it('définit theme avec source et accent depuis category', () => {
    expect(DEFAULT_CARD_CONFIG.theme.source).toBe('category.theme_token');
    expect(DEFAULT_CARD_CONFIG.theme.accent).toBe('category.accent_token');
  });
});

describe('validateCardConfig — entrées invalides → DEFAULT_CARD_CONFIG', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['string', 'not-an-object'],
    ['number', 42],
    ['array', []],
  ])('config %s → fallback', (_label, config) => {
    expect(validateCardConfig(config)).toBe(DEFAULT_CARD_CONFIG);
  });

  it('version ≠ 1 → fallback', () => {
    expect(validateCardConfig({ version: 2, template: 'x' })).toBe(DEFAULT_CARD_CONFIG);
  });

  it('version absente → fallback', () => {
    expect(validateCardConfig({ template: 'x' })).toBe(DEFAULT_CARD_CONFIG);
  });

  it('template non-string → fallback', () => {
    expect(validateCardConfig({ version: 1, template: 42 })).toBe(DEFAULT_CARD_CONFIG);
  });

  it('template absent → fallback', () => {
    expect(validateCardConfig({ version: 1 })).toBe(DEFAULT_CARD_CONFIG);
  });
});

describe('validateCardConfig — sources non whitelistées → fallback', () => {
  it.each(['image', 'title', 'subtitle', 'price', 'theme'])(
    'section %s avec source non autorisée → fallback',
    (section) => {
      const config = {
        version: 1,
        template: 'x',
        [section]: { source: 'product.secret_field' },
      };
      expect(validateCardConfig(config)).toBe(DEFAULT_CARD_CONFIG);
    }
  );

  it('badge avec source non autorisée → fallback', () => {
    const config = {
      version: 1,
      template: 'x',
      badges: [{ source: 'product.secret_field', condition: 'always' }],
    };
    expect(validateCardConfig(config)).toBe(DEFAULT_CARD_CONFIG);
  });
});

describe('validateCardConfig — conditions non whitelistées → fallback', () => {
  it('badge avec condition inconnue → fallback', () => {
    const config = {
      version: 1,
      template: 'x',
      badges: [{ source: 'product.badge', condition: 'mystere' }],
    };
    expect(validateCardConfig(config)).toBe(DEFAULT_CARD_CONFIG);
  });
});

describe('validateCardConfig — cas tolérés', () => {
  it('badges non-array → ignoré (pas de vérification, pas de throw), config retournée telle quelle', () => {
    const config = { version: 1, template: 'x', badges: 'oops' };
    expect(validateCardConfig(config)).toBe(config);
  });

  it('badge sans source ni condition (objet vide) → toléré', () => {
    const config = { version: 1, template: 'x', badges: [{}] };
    expect(validateCardConfig(config)).toBe(config);
  });

  it('sections absentes (image/title/subtitle/price/theme) → toléré, rien à vérifier', () => {
    const config = { version: 1, template: 'minimal' };
    expect(validateCardConfig(config)).toBe(config);
  });
});

describe('validateCardConfig — config valide → retournée telle quelle (pas une copie de DEFAULT)', () => {
  it('config custom entièrement valide est préservée', () => {
    const config = {
      version: 1,
      template: 'custom_v2',
      image: { source: 'product.image_url', fallback: ['category.image_url'] },
      title: { source: 'product.name', visible: true },
      badges: [{ type: 'promo', source: 'product.promo_pct', condition: 'gt_zero', format: '-{value}%' }],
    };
    const result = validateCardConfig(config);
    expect(result).toBe(config);
    expect(result).not.toBe(DEFAULT_CARD_CONFIG);
  });
});
