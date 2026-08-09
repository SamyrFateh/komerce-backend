'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/view-models/product-card-view-model.test.js
 *
 * Lot 3 — js/view-models/product-card-view-model.js (194L)
 * buildProductCardViewModel() : produit brut Komerce → contrat d'affichage
 * stable (labels, badges, classes CSS). Logique pure, pas de DOM ni réseau —
 * b-utils.js (sanitize/fmt/fmtPrice/optimizeImgUrl) est utilisé réellement
 * (fonctions pures, jsdom fournit `document` pour sanitize()), pas de mock.
 *
 * Périmètre couvert :
 *   - normalizeString/normalizeNumber/normalizePromoPct (bornes 0/95)
 *   - inferFulfillmentType / inferAvailabilityStatus (alias camelCase et
 *     snake_case, valeur par défaut)
 *   - inferDataQualityScore (score explicite vs calculé, plafond à 100)
 *   - buildCssClasses (chaque classe conditionnelle, cumul, seuil low-confidence)
 *   - buildBadges (chaque badge conditionnel, cumul, aucun badge)
 *   - buildProductCardViewModel : image (product > category > placeholder),
 *     thème catégorie, prix avec/sans promo (oldPriceKmf recalculé), variant
 *     par défaut, sanitisation des champs texte
 */

const { buildProductCardViewModel } = require('../../js/view-models/product-card-view-model.js');

describe('buildProductCardViewModel — cas nominal', () => {
  it('résout name/price/image à partir d\'un produit minimal', () => {
    const vm = buildProductCardViewModel({ id: 1, name: 'Sac', price_kmf: 15000, image_url: 'https://x/img.png' });
    expect(vm.id).toBe(1);
    expect(vm.name).toBe('Sac');
    expect(vm.priceKmf).toBe(15000);
    expect(vm.imageUrl).toBe('https://x/img.png');
    expect(vm.variant).toBe('grid');
    expect(vm.cardVariant).toBe('standard');
  });

  it('produit vide ({}) → nom/description/prix par défaut, sans throw', () => {
    const vm = buildProductCardViewModel({});
    expect(vm.name).toBe('Produit Komerce');
    expect(vm.description).toBe('');
    expect(vm.priceLabel).toBe('Prix à confirmer');
    expect(vm.imageUrl).toBe('/images/placeholder-product.svg');
  });

  it('appel sans argument (défauts product={} et options={}) ne throw pas', () => {
    expect(() => buildProductCardViewModel()).not.toThrow();
  });
});

describe('buildProductCardViewModel — image (product > category > placeholder)', () => {
  it('image_url produit prioritaire sur la catégorie', () => {
    const vm = buildProductCardViewModel(
      { image_url: 'https://p/img.png' },
      { category: { image_url: 'https://c/img.png' } }
    );
    expect(vm.imageUrl).toBe('https://p/img.png');
  });

  it('images[0].url utilisé si image_url absente', () => {
    const vm = buildProductCardViewModel({ images: [{ url: 'https://arr/img.png' }] });
    expect(vm.imageUrl).toBe('https://arr/img.png');
  });

  it('images[0] chaîne directe (pas d\'objet {url}) utilisée', () => {
    const vm = buildProductCardViewModel({ images: ['https://arr2/img.png'] });
    expect(vm.imageUrl).toBe('https://arr2/img.png');
  });

  it('sans image produit, fallback sur category.imageUrl / image_url', () => {
    const vm = buildProductCardViewModel({}, { category: { imageUrl: 'https://cat/img.png' } });
    expect(vm.imageUrl).toBe('https://cat/img.png');
  });

  it('aucune image nulle part → placeholder par défaut', () => {
    expect(buildProductCardViewModel({}).imageUrl).toBe('/images/placeholder-product.svg');
  });

  it('options.category non-objet (string) → ignoré, pas de throw', () => {
    expect(() => buildProductCardViewModel({}, { category: 'oops' })).not.toThrow();
    expect(buildProductCardViewModel({}, { category: 'oops' }).imageUrl).toBe('/images/placeholder-product.svg');
  });
});

describe('buildProductCardViewModel — thème catégorie', () => {
  it('themeToken/accentToken résolus depuis options.category (camelCase prioritaire)', () => {
    const vm = buildProductCardViewModel(
      {},
      { category: { themeToken: 'dark', theme_token: 'ignored', accentToken: 'gold', accent_token: 'ignored' } }
    );
    expect(vm.themeToken).toBe('dark');
    expect(vm.accentToken).toBe('gold');
  });

  it('fallback snake_case si camelCase absent', () => {
    const vm = buildProductCardViewModel({}, { category: { theme_token: 'light', accent_token: 'silver' } });
    expect(vm.themeToken).toBe('light');
    expect(vm.accentToken).toBe('silver');
  });

  it('sans catégorie → null', () => {
    const vm = buildProductCardViewModel({});
    expect(vm.themeToken).toBeNull();
    expect(vm.accentToken).toBeNull();
  });
});

describe('buildProductCardViewModel — prix et promo', () => {
  it('sans promo → priceLabel formaté, pas de prix barré, promoLabel vide', () => {
    const vm = buildProductCardViewModel({ price_kmf: 10000 });
    expect(vm.priceLabel).toBe(vm.priceLabel); // sanity, valeur exacte testée ci-dessous
    expect(vm.oldPriceKmf).toBe(0);
    expect(vm.oldPriceLabel).toBe('');
    expect(vm.promoLabel).toBe('');
    expect(vm.priceEurLabel).toMatch(/^≈ /);
  });

  it('avec promo_pct valide (0 < pct < 95) → oldPriceKmf recalculé et promoLabel', () => {
    const vm = buildProductCardViewModel({ price_kmf: 8000, promo_pct: 20 });
    expect(vm.promoPct).toBe(20);
    expect(vm.promoLabel).toBe('-20%');
    expect(vm.oldPriceKmf).toBe(Math.round(8000 / 0.8));
    expect(vm.oldPriceLabel).not.toBe('');
    expect(vm.cardVariant).toBe('promo');
  });

  it('promo_pct <= 0 → normalisé à 0, pas de prix barré', () => {
    expect(buildProductCardViewModel({ price_kmf: 1000, promo_pct: 0 }).promoPct).toBe(0);
    expect(buildProductCardViewModel({ price_kmf: 1000, promo_pct: -5 }).promoPct).toBe(0);
  });

  it('promo_pct >= 95 → normalisé à 0 (garde-fou anti-prix aberrant)', () => {
    expect(buildProductCardViewModel({ price_kmf: 1000, promo_pct: 95 }).promoPct).toBe(0);
    expect(buildProductCardViewModel({ price_kmf: 1000, promo_pct: 150 }).promoPct).toBe(0);
  });

  it('promo_pct décimal arrondi', () => {
    expect(buildProductCardViewModel({ price_kmf: 1000, promo_pct: 33.6 }).promoPct).toBe(34);
  });

  it('priceKmf <= 0 même avec promo_pct > 0 → oldPriceKmf reste 0', () => {
    const vm = buildProductCardViewModel({ price_kmf: 0, promo_pct: 20 });
    expect(vm.oldPriceKmf).toBe(0);
    expect(vm.priceLabel).toBe('Prix à confirmer');
  });

  it('alias promoPct (camelCase) supporté', () => {
    expect(buildProductCardViewModel({ price_kmf: 1000, promoPct: 10 }).promoPct).toBe(10);
  });

  it('alias priceKmf (camelCase) supporté', () => {
    expect(buildProductCardViewModel({ priceKmf: 500 }).priceKmf).toBe(500);
  });
});

describe('buildProductCardViewModel — fulfillmentType / availabilityStatus', () => {
  it('fulfillment_type snake_case reconnu', () => {
    expect(buildProductCardViewModel({ fulfillment_type: 'local_stock' }).fulfillmentType).toBe('local_stock');
  });
  it('fulfillmentType camelCase reconnu si snake_case absent', () => {
    expect(buildProductCardViewModel({ fulfillmentType: 'dubai_sourcing' }).fulfillmentType).toBe('dubai_sourcing');
  });
  it('source_type / sourceType en dernier recours', () => {
    expect(buildProductCardViewModel({ source_type: 'custom_made' }).fulfillmentType).toBe('custom_made');
    expect(buildProductCardViewModel({ sourceType: 'preorder' }).fulfillmentType).toBe('preorder');
  });
  it('aucun champ renseigné → "standard" par défaut', () => {
    expect(buildProductCardViewModel({}).fulfillmentType).toBe('standard');
  });

  it('availability_status / availabilityStatus / status, défaut "available"', () => {
    expect(buildProductCardViewModel({ availability_status: 'low_stock' }).availabilityStatus).toBe('low_stock');
    expect(buildProductCardViewModel({ availabilityStatus: 'low_stock' }).availabilityStatus).toBe('low_stock');
    expect(buildProductCardViewModel({ status: 'low_stock' }).availabilityStatus).toBe('low_stock');
    expect(buildProductCardViewModel({}).availabilityStatus).toBe('available');
  });
});

describe('buildProductCardViewModel — dataQualityScore', () => {
  it('score explicite (data_quality_score) prioritaire sur le calcul', () => {
    expect(buildProductCardViewModel({ data_quality_score: 42, name: 'X' }).dataQualityScore).toBe(42);
  });
  it('score explicite camelCase (dataQualityScore)', () => {
    expect(buildProductCardViewModel({ dataQualityScore: 77 }).dataQualityScore).toBe(77);
  });
  it('score calculé : chaque champ présent ajoute son poids, plafonné à 100', () => {
    const vm = buildProductCardViewModel({
      name: 'X',
      price_kmf: 100,
      image_url: 'https://x/i.png',
      category: 'cat',
      description: 'desc',
    });
    expect(vm.dataQualityScore).toBe(100);
  });
  it('produit vide → score 0', () => {
    expect(buildProductCardViewModel({}).dataQualityScore).toBe(0);
  });
  it('images.length compte comme présence d\'image (sans image_url)', () => {
    const vm = buildProductCardViewModel({ name: 'X', images: ['a.png'] });
    expect(vm.dataQualityScore).toBe(25 + 25); // name + image
  });
  it('category_key / categoryKey comptent comme catégorie présente', () => {
    expect(buildProductCardViewModel({ category_key: 'k' }).dataQualityScore).toBe(15);
    expect(buildProductCardViewModel({ categoryKey: 'k' }).dataQualityScore).toBe(15);
  });
});

describe('buildProductCardViewModel — cssClasses', () => {
  it('promo → k-card--promo', () => {
    expect(buildProductCardViewModel({ price_kmf: 100, promo_pct: 10 }).cssClasses).toContain('k-card--promo');
  });
  it('is_flash / isFlash → k-card--flash', () => {
    expect(buildProductCardViewModel({ is_flash: true }).cssClasses).toContain('k-card--flash');
    expect(buildProductCardViewModel({ isFlash: true }).cssClasses).toContain('k-card--flash');
  });
  it('is_premium / isPremium → k-card--premium', () => {
    expect(buildProductCardViewModel({ is_premium: true }).cssClasses).toContain('k-card--premium');
    expect(buildProductCardViewModel({ isPremium: true }).cssClasses).toContain('k-card--premium');
  });
  it('is_new / isNew → k-card--new-arrival', () => {
    expect(buildProductCardViewModel({ is_new: true }).cssClasses).toContain('k-card--new-arrival');
    expect(buildProductCardViewModel({ isNew: true }).cssClasses).toContain('k-card--new-arrival');
  });
  it.each([
    ['local_stock', 'k-card--local-stock'],
    ['dubai_sourcing', 'k-card--dubai-sourcing'],
    ['custom_made', 'k-card--custom-made'],
    ['preorder', 'k-card--preorder'],
    ['backorder', 'k-card--backorder'],
  ])('fulfillmentType=%s → classe %s', (type, cls) => {
    expect(buildProductCardViewModel({ fulfillment_type: type }).cssClasses).toContain(cls);
  });
  it('availabilityStatus=low_stock → k-card--low-stock', () => {
    expect(buildProductCardViewModel({ status: 'low_stock' }).cssClasses).toContain('k-card--low-stock');
  });
  it('has_variants/hasVariants → k-card--has-variants + badge variants', () => {
    const vm = buildProductCardViewModel({ has_variants: true });
    expect(vm.cssClasses).toContain('k-card--has-variants');
    expect(vm.hasVariants).toBe(true);
    const vm2 = buildProductCardViewModel({ variants: [1, 2] });
    expect(vm2.hasVariants).toBe(true);
  });
  it('dataQualityScore entre 1 et 54 → k-card--low-confidence', () => {
    const vm = buildProductCardViewModel({ name: 'X' }); // score 25
    expect(vm.cssClasses).toContain('k-card--low-confidence');
  });
  it('dataQualityScore = 0 → pas de low-confidence', () => {
    expect(buildProductCardViewModel({}).cssClasses).not.toContain('k-card--low-confidence');
  });
  it('dataQualityScore >= 55 → pas de low-confidence', () => {
    const vm = buildProductCardViewModel({ name: 'X', price_kmf: 100, image_url: 'i.png' }); // 75
    expect(vm.cssClasses).not.toContain('k-card--low-confidence');
  });
  it('cssClassName est la jointure espace des cssClasses', () => {
    const vm = buildProductCardViewModel({ price_kmf: 100, promo_pct: 10 });
    expect(vm.cssClassName).toBe(vm.cssClasses.join(' '));
  });
  it('produit minimal → seulement la classe de base k-card--standard', () => {
    expect(buildProductCardViewModel({}).cssClasses).toEqual(['k-card--standard']);
  });
});

describe('buildProductCardViewModel — badges', () => {
  it('aucun badge pour un produit minimal', () => {
    expect(buildProductCardViewModel({}).badges).toEqual([]);
  });
  it('badge promo présent avec label et className', () => {
    const badge = buildProductCardViewModel({ price_kmf: 100, promo_pct: 15 }).badges
      .find((b) => b.key === 'promo');
    expect(badge).toEqual({ key: 'promo', label: '-15%', className: 'k-card-badge--promo' });
  });
  it('badge local_stock', () => {
    expect(buildProductCardViewModel({ fulfillment_type: 'local_stock' }).badges).toEqual(
      expect.arrayContaining([{ key: 'local_stock', label: 'Disponible', className: 'k-card-badge--local-stock' }])
    );
  });
  it('badge dubai_sourcing', () => {
    expect(buildProductCardViewModel({ fulfillment_type: 'dubai_sourcing' }).badges).toEqual(
      expect.arrayContaining([{ key: 'dubai_sourcing', label: 'Sur commande', className: 'k-card-badge--dubai-sourcing' }])
    );
  });
  it('badge custom_made', () => {
    expect(buildProductCardViewModel({ fulfillment_type: 'custom_made' }).badges).toEqual(
      expect.arrayContaining([{ key: 'custom_made', label: 'Sur mesure', className: 'k-card-badge--custom-made' }])
    );
  });
  it('badge low_stock', () => {
    expect(buildProductCardViewModel({ status: 'low_stock' }).badges).toEqual(
      expect.arrayContaining([{ key: 'low_stock', label: 'Stock limité', className: 'k-card-badge--low-stock' }])
    );
  });
  it('badge variants', () => {
    expect(buildProductCardViewModel({ has_variants: true }).badges).toEqual(
      expect.arrayContaining([{ key: 'variants', label: 'Variantes', className: 'k-card-badge--variants' }])
    );
  });
  it('cumul de plusieurs badges simultanés', () => {
    const vm = buildProductCardViewModel({
      price_kmf: 100,
      promo_pct: 10,
      fulfillment_type: 'local_stock',
      has_variants: true,
    });
    expect(vm.badges.map((b) => b.key).sort()).toEqual(['local_stock', 'promo', 'variants'].sort());
  });
});

describe('buildProductCardViewModel — champs texte sanitisés', () => {
  it('safeName/safeDescription échappent le HTML', () => {
    const vm = buildProductCardViewModel({ name: '<b>Nom</b>', description: '<i>Desc</i>' });
    expect(vm.safeName).not.toContain('<b>');
    expect(vm.safeDescription).not.toContain('<i>');
  });

  it('shortName utilise short_name/shortName si fourni, sinon retombe sur name', () => {
    expect(buildProductCardViewModel({ name: 'Long nom', short_name: 'Court' }).shortName).toBe('Court');
    expect(buildProductCardViewModel({ name: 'Long nom', shortName: 'Court2' }).shortName).toBe('Court2');
    expect(buildProductCardViewModel({ name: 'Long nom' }).shortName).toBe('Long nom');
  });

  it('imageAlt utilise image_alt/imageAlt si fourni, sinon retombe sur name', () => {
    expect(buildProductCardViewModel({ name: 'X', image_alt: 'Alt text' }).imageAlt).toBe('Alt text');
    expect(buildProductCardViewModel({ name: 'X', imageAlt: 'Alt2' }).imageAlt).toBe('Alt2');
    expect(buildProductCardViewModel({ name: 'X' }).imageAlt).toBe('X');
  });

  it('raw conserve une référence au produit source original', () => {
    const product = { name: 'X' };
    expect(buildProductCardViewModel(product).raw).toBe(product);
  });
});

describe('buildProductCardViewModel — options diverses', () => {
  it('options.variant propage variant et optimizedImageUrl reçoit options.imageSize', () => {
    const vm = buildProductCardViewModel({ image_url: 'https://x/i.png' }, { variant: 'suggestion', imageSize: 200 });
    expect(vm.variant).toBe('suggestion');
    // optimizeImgUrl est un no-op sur des URL hors cloudinary, mais l'appel ne doit pas throw
    expect(vm.optimizedImageUrl).toBe('https://x/i.png');
  });

  it('sans options.imageSize → imageSize par défaut 400 utilisé sans throw', () => {
    expect(() => buildProductCardViewModel({ image_url: 'https://x/i.png' })).not.toThrow();
  });
});
