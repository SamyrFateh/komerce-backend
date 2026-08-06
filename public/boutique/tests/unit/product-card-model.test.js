'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/view-models/product-card-model.test.js
 *
 * Lot 3 — js/view-models/product-card-model.js (242L)
 * resolveProductCardModel() : Product + Category + CardConfig → CardModel
 * normalisé. Logique 100% pure (pas de DOM, pas de réseau) → import direct
 * de card-config.js réel (pas de mock), tests table-driven input/output.
 *
 * Périmètre couvert :
 *   - resolveSource (whitelist stricte, namespace product/category, source
 *     absente/non whitelistée)
 *   - evalCondition (5 conditions connues + inconnue → false)
 *   - formatKmf (valide, zéro/négatif/NaN → "Prix à confirmer")
 *   - formatBadgeLabel (avec/sans placeholder {value}, sans format)
 *   - resolveImage (source primaire, fallback déclaré whitelisté, fallback
 *     URL littérale, aucun fallback exploitable → placeholder)
 *   - resolveBadges (condition remplie/non remplie, label vide filtré, type
 *     par défaut 'text', badgesCfg non-array)
 *   - resolveSubtitle (primaire, fallback, aucun des deux)
 *   - resolveProductCardModel : config invalide → DEFAULT_CARD_CONFIG,
 *     titre par défaut si absent, prix formaté, disponibilité (is_available
 *     explicite false, stock à 0, stock null/undefined = dispo par défaut)
 */

const { DEFAULT_CARD_CONFIG } = require('../../js/card-config.js');
const { resolveProductCardModel } = require('../../js/view-models/product-card-model.js');

describe('resolveProductCardModel — cas nominal', () => {
  it('résout titre, sous-titre, prix, image à partir d\'un produit complet', () => {
    const product = {
      name: 'Chaise Komerce',
      subcategory: 'Mobilier',
      category: 'maison',
      image_url: 'https://cdn.example.com/chaise.jpg',
      price_kmf: 12500,
    };
    const model = resolveProductCardModel(product, {});
    expect(model.title).toBe('Chaise Komerce');
    expect(model.subtitle).toBe('Mobilier');
    expect(model.imageUrl).toBe('https://cdn.example.com/chaise.jpg');
    expect(model.priceLabel).toBe('12 500 KMF');
    expect(model.isAvailable).toBe(true);
  });

  it('applique DEFAULT_CARD_CONFIG quand aucune config n\'est fournie', () => {
    const model = resolveProductCardModel({ name: 'X' });
    expect(model).toEqual(resolveProductCardModel({ name: 'X' }, {}, DEFAULT_CARD_CONFIG));
  });
});

describe('resolveProductCardModel — fallback config invalide', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['version 2', { version: 2, template: 'x' }],
    ['sans version', { template: 'x' }],
  ])('config %s → retombe sur DEFAULT_CARD_CONFIG', (_label, config) => {
    const withInvalid = resolveProductCardModel({ name: 'A' }, {}, config);
    const withDefault = resolveProductCardModel({ name: 'A' }, {}, DEFAULT_CARD_CONFIG);
    expect(withInvalid).toEqual(withDefault);
  });
});

describe('resolveProductCardModel — titre', () => {
  it('produit sans nom → titre par défaut "Produit Komerce"', () => {
    expect(resolveProductCardModel({}).title).toBe('Produit Komerce');
  });

  it('nom composé uniquement d\'espaces → titre par défaut', () => {
    expect(resolveProductCardModel({ name: '   ' }).title).toBe('Produit Komerce');
  });

  it('nom valide avec espaces superflus → trim appliqué', () => {
    expect(resolveProductCardModel({ name: '  Sac à main  ' }).title).toBe('Sac à main');
  });
});

describe('resolveProductCardModel — image (resolveImage)', () => {
  it('image_url produit présente → utilisée telle quelle', () => {
    const model = resolveProductCardModel({ image_url: 'https://x/img.png' });
    expect(model.imageUrl).toBe('https://x/img.png');
  });

  it('image_url absente, category.image_url présente → fallback catégorie', () => {
    const model = resolveProductCardModel({}, { image_url: 'https://cat/img.png' });
    expect(model.imageUrl).toBe('https://cat/img.png');
  });

  it('aucune image produit/catégorie → placeholder littéral du fallback array', () => {
    const model = resolveProductCardModel({}, {});
    expect(model.imageUrl).toBe('/images/placeholder-product.png');
  });

  it('image_url produit = chaîne vide → tombe sur le fallback catégorie', () => {
    const model = resolveProductCardModel({ image_url: '   ' }, { image_url: 'https://cat/y.png' });
    expect(model.imageUrl).toBe('https://cat/y.png');
  });

  it('config.image absente → placeholder direct', () => {
    const config = { ...DEFAULT_CARD_CONFIG, image: undefined };
    const model = resolveProductCardModel({ image_url: 'https://x/img.png' }, {}, config);
    expect(model.imageUrl).toBe('/images/placeholder-product.png');
  });

  it('fallback déclaré (source whitelistée) épuisé sans valeur ni littéral → placeholder final', () => {
    const config = {
      ...DEFAULT_CARD_CONFIG,
      image: { source: 'product.image_url', fallback: ['category.image_url'] },
    };
    const model = resolveProductCardModel({}, {}, config);
    expect(model.imageUrl).toBe('/images/placeholder-product.png');
  });
});

describe('resolveProductCardModel — prix (formatKmf)', () => {
  it('prix positif → formaté en KMF avec séparateur de milliers', () => {
    expect(resolveProductCardModel({ price_kmf: 125000 }).priceLabel).toBe('125 000 KMF');
  });

  it('prix arrondi (décimal) → Math.round appliqué', () => {
    expect(resolveProductCardModel({ price_kmf: 999.6 }).priceLabel).toBe('1 000 KMF');
  });

  it.each([
    ['zéro', 0],
    ['négatif', -50],
    ['NaN', 'not-a-number'],
    ['absent', undefined],
  ])('prix %s → "Prix à confirmer"', (_label, price_kmf) => {
    expect(resolveProductCardModel({ price_kmf }).priceLabel).toBe('Prix à confirmer');
  });

  it('config.price.format ≠ "kmf" → valeur brute stringifiée sans formatage', () => {
    const config = { ...DEFAULT_CARD_CONFIG, price: { source: 'product.price_kmf', format: 'raw' } };
    expect(resolveProductCardModel({ price_kmf: 500 }, {}, config).priceLabel).toBe('500');
  });
});

describe('resolveProductCardModel — sous-titre (resolveSubtitle)', () => {
  it('subcategory présente → utilisée', () => {
    expect(resolveProductCardModel({ subcategory: 'Électronique' }).subtitle).toBe('Électronique');
  });

  it('subcategory absente, category présente → fallback category', () => {
    expect(resolveProductCardModel({ category: 'Maison' }).subtitle).toBe('Maison');
  });

  it('ni subcategory ni category → sous-titre vide', () => {
    expect(resolveProductCardModel({}).subtitle).toBe('');
  });

  it('config.subtitle absente → sous-titre vide sans throw', () => {
    const config = { ...DEFAULT_CARD_CONFIG, subtitle: undefined };
    expect(resolveProductCardModel({ subcategory: 'X' }, {}, config).subtitle).toBe('');
  });
});

describe('resolveProductCardModel — badges (resolveBadges)', () => {
  it('promo_pct > 0 → badge promo formaté "-{value}%"', () => {
    const model = resolveProductCardModel({ promo_pct: 20 });
    expect(model.badges).toEqual(expect.arrayContaining([{ type: 'promo', label: '-20%' }]));
  });

  it('promo_pct = 0 (gt_zero non satisfait) → pas de badge promo', () => {
    const model = resolveProductCardModel({ promo_pct: 0 });
    expect(model.badges.find((b) => b.type === 'promo')).toBeUndefined();
  });

  it('badge texte (product.badge) non vide → badge type "text"', () => {
    const model = resolveProductCardModel({ badge: 'Exclusivité' });
    expect(model.badges).toEqual(expect.arrayContaining([{ type: 'text', label: 'Exclusivité' }]));
  });

  it('stock <= 0 → badge stock "Rupture" (format littéral sans {value})', () => {
    const model = resolveProductCardModel({ stock: 0 });
    expect(model.badges).toEqual(expect.arrayContaining([{ type: 'stock', label: 'Rupture' }]));
  });

  it('stock > 0 → pas de badge stock', () => {
    const model = resolveProductCardModel({ stock: 5 });
    expect(model.badges.find((b) => b.type === 'stock')).toBeUndefined();
  });

  it('config.badges absente ou non-array → aucun badge, pas de throw', () => {
    const config = { ...DEFAULT_CARD_CONFIG, badges: 'oops' };
    expect(resolveProductCardModel({ promo_pct: 20 }, {}, config).badges).toEqual([]);
  });

  it('badge sans "type" déclaré → type par défaut "text"', () => {
    const config = {
      ...DEFAULT_CARD_CONFIG,
      badges: [{ source: 'product.badge', condition: 'not_empty' }],
    };
    const model = resolveProductCardModel({ badge: 'Nouveau' }, {}, config);
    expect(model.badges).toEqual([{ type: 'text', label: 'Nouveau' }]);
  });

  it('entrée de badges non-objet (null) → ignorée sans throw', () => {
    const config = { ...DEFAULT_CARD_CONFIG, badges: [null, { source: 'product.badge', condition: 'not_empty' }] };
    expect(() => resolveProductCardModel({ badge: 'X' }, {}, config)).not.toThrow();
  });

  it('condition "always" → badge toujours affiché, quelle que soit la valeur', () => {
    const config = {
      ...DEFAULT_CARD_CONFIG,
      badges: [{ type: 'text', source: 'product.badge', condition: 'always' }],
    };
    const model = resolveProductCardModel({}, {}, config);
    // valeur undefined + pas de format → label vide → filtré par `if (!label) return acc;`
    expect(model.badges).toEqual([]);
    const model2 = resolveProductCardModel({ badge: 'X' }, {}, config);
    expect(model2.badges).toEqual([{ type: 'text', label: 'X' }]);
  });

  it('condition "is_false" → badge affiché seulement quand value === false strictement', () => {
    const config = {
      ...DEFAULT_CARD_CONFIG,
      badges: [{ type: 'text', source: 'product.is_available', condition: 'is_false', format: 'Indisponible' }],
    };
    expect(resolveProductCardModel({ is_available: false }, {}, config).badges).toEqual([
      { type: 'text', label: 'Indisponible' },
    ]);
    expect(resolveProductCardModel({ is_available: true }, {}, config).badges).toEqual([]);
    expect(resolveProductCardModel({ is_available: 0 }, {}, config).badges).toEqual([]);
  });

  it('condition inconnue déclarée sur un badge → badge masqué (default: false)', () => {
    const config = {
      ...DEFAULT_CARD_CONFIG,
      badges: [{ type: 'text', source: 'product.badge', condition: 'mystere' }],
    };
    expect(resolveProductCardModel({ badge: 'X' }, {}, config).badges).toEqual([]);
  });
});

describe('resolveProductCardModel — stock affiché (show_when)', () => {
  it('stock <= 0 avec show_when=lte_zero → stockLabel affiché', () => {
    const model = resolveProductCardModel({ stock: 0 });
    expect(model.stockLabel).toBe('0');
  });

  it('stock > 0 avec show_when=lte_zero → stockLabel vide', () => {
    const model = resolveProductCardModel({ stock: 10 });
    expect(model.stockLabel).toBe('');
  });

  it('config.stock.show_when absente → utilise stock.visible (false par défaut)', () => {
    const config = { ...DEFAULT_CARD_CONFIG, stock: { source: 'product.stock', visible: true } };
    expect(resolveProductCardModel({ stock: 3 }, {}, config).stockLabel).toBe('3');
  });
});

describe('resolveProductCardModel — thème', () => {
  it('theme_token/accent_token résolus depuis category, null si absents', () => {
    const withTheme = resolveProductCardModel({}, { theme_token: 'dark', accent_token: 'gold' });
    expect(withTheme.themeToken).toBe('dark');
    expect(withTheme.accentToken).toBe('gold');

    const withoutTheme = resolveProductCardModel({}, {});
    expect(withoutTheme.themeToken).toBeNull();
    expect(withoutTheme.accentToken).toBeNull();
  });
});

describe('resolveProductCardModel — disponibilité', () => {
  it('is_available === false → non disponible, quel que soit le stock', () => {
    expect(resolveProductCardModel({ is_available: false, stock: 50 }).isAvailable).toBe(false);
  });

  it('stock null/undefined et is_available non renseigné → disponible par défaut', () => {
    expect(resolveProductCardModel({}).isAvailable).toBe(true);
  });

  it('stock à 0 (défini) → non disponible', () => {
    expect(resolveProductCardModel({ stock: 0 }).isAvailable).toBe(false);
  });

  it('stock > 0 → disponible', () => {
    expect(resolveProductCardModel({ stock: 3 }).isAvailable).toBe(true);
  });
});

describe('resolveSource — sécurité whitelist (via resolveProductCardModel)', () => {
  it('source non whitelistée déclarée en config → ignorée (undefined), fallback titre par défaut', () => {
    const config = { ...DEFAULT_CARD_CONFIG, title: { source: 'product.secret_internal_field', visible: true } };
    const product = { name: 'Réel', secret_internal_field: 'Fuite' };
    expect(resolveProductCardModel(product, {}, config).title).toBe('Produit Komerce');
  });

  it('namespace inconnu ("other.x") → undefined', () => {
    const config = { ...DEFAULT_CARD_CONFIG, title: { source: 'other.name' } };
    expect(resolveProductCardModel({ name: 'X' }, {}, config).title).toBe('Produit Komerce');
  });
});
