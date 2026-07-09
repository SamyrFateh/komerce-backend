'use strict';

/**
 * tests/unit/modal-view-model.test.js
 *
 * Module js/view-models/modal-view-model.js (424L, criticality: high) —
 * traduit un produit brut/sale en contrat d'affichage modal stable (7
 * classes CSS contractuelles cf. BOUTIQUE_SOURCE_OF_TRUTH.md §3B + 3
 * additionnelles). Jamais testé en direct avant cette session — mocké dans
 * b-modal-desktop-enhancers.test.js / b-modal-core.test.js.
 *
 * Import réel du module + b-utils.js (sanitize/fmt/fmtPrice/optimizeImgUrl
 * réels — fonction pure, pas de mock, même pattern que les autres
 * view-models déjà couverts).
 */

const { buildModalViewModel, applyModalClasses } = require('../../js/view-models/modal-view-model.js');

describe('buildModalViewModel — fallbacks garantis (produit vide/incomplet)', () => {
  it('produit vide → nom/description/prix par défaut, aucune exception', () => {
    const vm = buildModalViewModel();
    expect(vm.name).toBe('Produit Komerce');
    expect(vm.description).toBe('');
    expect(vm.priceKmf).toBeNull();
    expect(vm.priceLabel).toBe('Prix à confirmer');
    expect(vm.images).toEqual(['/images/placeholder-product.png']);
  });

  it('id null si absent', () => {
    expect(buildModalViewModel({}).id).toBeNull();
  });

  it('conserve id 0 (falsy mais valide) via ??', () => {
    expect(buildModalViewModel({ id: 0 }).id).toBe(0);
  });

  it('nom vide/espaces → fallback', () => {
    expect(buildModalViewModel({ name: '   ' }).name).toBe('Produit Komerce');
    expect(buildModalViewModel({ name: '' }).name).toBe('Produit Komerce');
  });

  it('trim les valeurs string', () => {
    expect(buildModalViewModel({ name: '  Chaussures  ' }).name).toBe('Chaussures');
  });
});

describe('buildModalViewModel — images', () => {
  it('accepte un tableau de strings', () => {
    const vm = buildModalViewModel({ images: ['a.jpg', 'b.jpg'] });
    expect(vm.images).toEqual(['a.jpg', 'b.jpg']);
  });

  it('accepte un tableau d\'objets {url}', () => {
    const vm = buildModalViewModel({ images: [{ url: 'a.jpg' }, { url: 'b.jpg' }] });
    expect(vm.images).toEqual(['a.jpg', 'b.jpg']);
  });

  it('filtre les entrées vides/invalides du tableau', () => {
    const vm = buildModalViewModel({ images: ['', null, 'a.jpg', {}] });
    expect(vm.images).toEqual(['a.jpg']);
  });

  it('fallback sur image_url si images absent', () => {
    expect(buildModalViewModel({ image_url: 'single.jpg' }).images).toEqual(['single.jpg']);
  });

  it('fallback sur imageUrl (camelCase) si image_url absent', () => {
    expect(buildModalViewModel({ imageUrl: 'camel.jpg' }).images).toEqual(['camel.jpg']);
  });

  it('placeholder garanti si rien de fourni', () => {
    expect(buildModalViewModel({}).images).toEqual(['/images/placeholder-product.png']);
  });

  it('optimizedImages et primaryImage dérivés des images', () => {
    const vm = buildModalViewModel({ images: ['a.jpg', 'b.jpg'] });
    expect(vm.optimizedImages).toEqual(['a.jpg', 'b.jpg']); // pas cloudinary → inchangé
    expect(vm.primaryImage).toBe('a.jpg');
  });

  it('optimise les URLs Cloudinary avec la largeur demandée', () => {
    const vm = buildModalViewModel(
      { images: ['https://res.cloudinary.com/x/image/upload/img.jpg'] },
      { imageSize: 400 }
    );
    expect(vm.optimizedImages[0]).toBe('https://res.cloudinary.com/x/image/upload/f_auto,q_auto,w_400/img.jpg');
  });

  it('imageSize par défaut = 800 si options absent', () => {
    const vm = buildModalViewModel({ images: ['https://res.cloudinary.com/x/image/upload/img.jpg'] });
    expect(vm.optimizedImages[0]).toContain('w_800');
  });
});

describe('buildModalViewModel — prix et promo', () => {
  it('priceKmf null si absent/invalide', () => {
    expect(buildModalViewModel({}).priceKmf).toBeNull();
    expect(buildModalViewModel({ price_kmf: 'abc' }).priceKmf).toBeNull();
  });

  it('accepte priceKmf (camelCase) en fallback de price_kmf', () => {
    expect(buildModalViewModel({ priceKmf: 5000 }).priceKmf).toBe(5000);
  });

  it('priceLabel formaté si prix > 0', () => {
    const vm = buildModalViewModel({ price_kmf: 15000 });
    expect(vm.priceLabel).not.toBe('Prix à confirmer');
    expect(vm.priceLabel).toContain('KMF');
  });

  it('priceLabel = "Prix à confirmer" si priceKmf = 0', () => {
    expect(buildModalViewModel({ price_kmf: 0 }).priceLabel).toBe('Prix à confirmer');
  });

  it('priceEurLabel vide si pas de prix', () => {
    expect(buildModalViewModel({}).priceEurLabel).toBe('');
  });

  it('priceEurLabel présent si prix > 0', () => {
    expect(buildModalViewModel({ price_kmf: 15000 }).priceEurLabel).toContain('≈');
  });

  it('promoPct null si absent', () => {
    expect(buildModalViewModel({ price_kmf: 1000 }).promoPct).toBeNull();
  });

  it('promoPct ignoré (null) si sous le seuil de bruit (< 5%)', () => {
    expect(buildModalViewModel({ price_kmf: 1000, promo_pct: 3 }).promoPct).toBeNull();
  });

  it('promoPct ignoré (null) si >= 95% (probable erreur de saisie)', () => {
    expect(buildModalViewModel({ price_kmf: 1000, promo_pct: 95 }).promoPct).toBeNull();
    expect(buildModalViewModel({ price_kmf: 1000, promo_pct: 99 }).promoPct).toBeNull();
  });

  it('promoPct valide et arrondi', () => {
    expect(buildModalViewModel({ price_kmf: 1000, promo_pct: 20.6 }).promoPct).toBe(21);
  });

  it('promoLabel formaté "-N%"', () => {
    expect(buildModalViewModel({ price_kmf: 1000, promo_pct: 20 }).promoLabel).toBe('-20%');
  });

  it('oldPriceKmf calculé depuis priceKmf + promoPct (prix avant remise)', () => {
    // priceKmf=800, promo 20% → ancien prix = 800 / 0.8 = 1000
    const vm = buildModalViewModel({ price_kmf: 800, promo_pct: 20 });
    expect(vm.oldPriceKmf).toBe(1000);
    expect(vm.oldPriceLabel).toContain('KMF');
  });

  it('oldPriceKmf null si pas de promo valide', () => {
    expect(buildModalViewModel({ price_kmf: 800 }).oldPriceKmf).toBeNull();
  });

  it('oldPriceKmf null si priceKmf absent même avec promo', () => {
    expect(buildModalViewModel({ promo_pct: 20 }).oldPriceKmf).toBeNull();
  });

  it('oldPriceKmf null si priceKmf = 0 même avec promo', () => {
    expect(buildModalViewModel({ price_kmf: 0, promo_pct: 20 }).oldPriceKmf).toBeNull();
  });
});

describe('buildModalViewModel — fulfillmentType (mapping sourcing interne → contrat)', () => {
  it.each([
    ['local_stock', 'local'],
    ['local', 'local'],
    ['preorder', 'preorder'],
    ['backorder', 'preorder'],
    ['custom_made', 'custom'],
    ['custom', 'custom'],
    ['confection', 'custom'],
    ['dubai_sourcing', 'relay'],
    ['relay', 'relay'],
    ['standard', 'relay'],
  ])('mappe "%s" → "%s"', (raw, expected) => {
    expect(buildModalViewModel({ fulfillment_type: raw }).fulfillmentType).toBe(expected);
  });

  it('valeur inconnue/absente → fallback "relay" (DEFAULT_FULFILLMENT)', () => {
    expect(buildModalViewModel({}).fulfillmentType).toBe('relay');
    expect(buildModalViewModel({ fulfillment_type: 'totally_unknown' }).fulfillmentType).toBe('relay');
  });

  it('insensible à la casse', () => {
    expect(buildModalViewModel({ fulfillment_type: 'LOCAL_STOCK' }).fulfillmentType).toBe('local');
  });

  it('fallback sourceType si fulfillment_type absent', () => {
    expect(buildModalViewModel({ source_type: 'custom' }).fulfillmentType).toBe('custom');
  });
});

describe('buildModalViewModel — stockStatus', () => {
  it.each([
    ['unavailable', 'unavailable'],
    ['out_of_stock', 'unavailable'],
    ['rupture', 'unavailable'],
    ['low', 'low'],
    ['low_stock', 'low'],
    ['available', 'available'],
    ['in_stock', 'available'],
  ])('statut explicite "%s" → "%s"', (raw, expected) => {
    expect(buildModalViewModel({ stock_status: raw }).stockStatus).toBe(expected);
  });

  it('dérive depuis la quantité si statut absent : 0 → unavailable', () => {
    expect(buildModalViewModel({ stock: 0 }).stockStatus).toBe('unavailable');
  });

  it('dérive depuis la quantité : <= 10 → low', () => {
    expect(buildModalViewModel({ stock: 5 }).stockStatus).toBe('low');
    expect(buildModalViewModel({ stock: 10 }).stockStatus).toBe('low');
  });

  it('dérive depuis la quantité : > 10 → available', () => {
    expect(buildModalViewModel({ stock: 50 }).stockStatus).toBe('available');
  });

  it('fallback prudent "available" si ni statut ni quantité fournis', () => {
    expect(buildModalViewModel({}).stockStatus).toBe('available');
  });

  it('statut explicite prioritaire sur la quantité', () => {
    expect(buildModalViewModel({ stock_status: 'available', stock: 0 }).stockStatus).toBe('available');
  });

  it('stockLabel : rupture', () => {
    expect(buildModalViewModel({ stock_status: 'unavailable' }).stockLabel).toBe('✗ Rupture');
  });

  it('stockLabel : stock bas avec quantité connue', () => {
    expect(buildModalViewModel({ stock: 3 }).stockLabel).toBe('🔥 Plus que 3 en stock');
  });

  it('stockLabel : stock bas sans quantité précise (statut explicite "low" sans stock numérique)', () => {
    expect(buildModalViewModel({ stock_status: 'low' }).stockLabel).toBe('🔥 Stock limité');
  });

  it('stockLabel : disponible', () => {
    expect(buildModalViewModel({}).stockLabel).toBe('✓ Disponible');
  });
});

describe('buildModalViewModel — deliveryEstimate / deliveryLabel', () => {
  it('null si aucun champ fourni', () => {
    expect(buildModalViewModel({}).deliveryEstimate).toBeNull();
  });

  it('prend le premier champ non vide parmi les candidats', () => {
    expect(buildModalViewModel({ eta: '48h' }).deliveryEstimate).toBe('48h');
  });

  it('priorité à delivery_estimate sur les autres champs', () => {
    expect(buildModalViewModel({ delivery_estimate: 'A', eta: 'B' }).deliveryEstimate).toBe('A');
  });

  it('deliveryLabel = deliveryEstimate si présent', () => {
    expect(buildModalViewModel({ eta: '48h' }).deliveryLabel).toBe('48h');
  });

  it.each([
    ['local', 'Disponible immédiatement'],
    ['preorder', 'Sur précommande'],
    ['custom', 'Sur commande / confection'],
    ['relay', 'Livraison point relais'],
  ])('deliveryLabel fallback par fulfillmentType "%s" → "%s"', (fulfillment, expected) => {
    expect(buildModalViewModel({ fulfillment_type: fulfillment }).deliveryLabel).toBe(expected);
  });
});

describe('buildModalViewModel — variants', () => {
  it('null si absent et pas de flag has_variants', () => {
    expect(buildModalViewModel({}).variants).toBeNull();
  });

  it('[] si has_variants=true mais données pas encore chargées', () => {
    expect(buildModalViewModel({ has_variants: true }).variants).toEqual([]);
  });

  it('tableau non vide conservé tel quel', () => {
    const variants = [{ size: 'M' }, { size: 'L' }];
    expect(buildModalViewModel({ variants }).variants).toEqual(variants);
  });

  it('tableau vide → null (pas [] pour un tableau explicitement vide)', () => {
    expect(buildModalViewModel({ variants: [] }).variants).toBeNull();
  });

  it('objet converti en tableau {key, value}', () => {
    const vm = buildModalViewModel({ variants: { size: 'M', color: 'red' } });
    expect(vm.variants).toEqual([{ key: 'size', value: 'M' }, { key: 'color', value: 'red' }]);
  });

  it('objet vide → null', () => {
    expect(buildModalViewModel({ variants: {} }).variants).toBeNull();
  });

  it('type inattendu (ni array ni objet, ex: string/number) → null', () => {
    expect(buildModalViewModel({ variants: 'oops' }).variants).toBeNull();
    expect(buildModalViewModel({ variants: 42 }).variants).toBeNull();
  });
});

describe('buildModalViewModel — specs', () => {
  it('null si absent', () => {
    expect(buildModalViewModel({}).specs).toBeNull();
  });

  it('tableau de strings → {label:"", value}', () => {
    const vm = buildModalViewModel({ specs: ['100% coton'] });
    expect(vm.specs).toEqual([{ label: '', value: '100% coton' }]);
  });

  it('tableau de {label, value} conservé et normalisé', () => {
    const vm = buildModalViewModel({ specs: [{ label: 'Matière', value: 'Coton' }] });
    expect(vm.specs).toEqual([{ label: 'Matière', value: 'Coton' }]);
  });

  it('filtre les entrées sans valeur', () => {
    const vm = buildModalViewModel({ specs: [{ label: 'Vide', value: '' }, { label: 'OK', value: 'x' }] });
    expect(vm.specs).toEqual([{ label: 'OK', value: 'x' }]);
  });

  it('tableau vide après filtrage → null', () => {
    expect(buildModalViewModel({ specs: [{ label: 'Vide', value: '' }] }).specs).toBeNull();
  });

  it('accepte specifications (alias) et un objet clé/valeur', () => {
    const vm = buildModalViewModel({ specifications: { Matière: 'Coton' } });
    expect(vm.specs).toEqual([{ label: 'Matière', value: 'Coton' }]);
  });

  it('type inattendu (ni array ni objet) → null', () => {
    expect(buildModalViewModel({ specs: 'oops' }).specs).toBeNull();
    expect(buildModalViewModel({ specs: 42 }).specs).toBeNull();
  });
});

describe('buildModalViewModel — socialProof (règle dure : zéro chiffre inventé)', () => {
  it('null si absent', () => {
    expect(buildModalViewModel({}).socialProof).toBeNull();
  });

  it('null si tous les champs sont nuls/zéro (pas de données réelles)', () => {
    expect(buildModalViewModel({ social_proof: { sold_count: 0, rating: 0, reviews_count: 0 } }).socialProof).toBeNull();
  });

  it('actif si sold_count > 0 seul', () => {
    const vm = buildModalViewModel({ social_proof: { sold_count: 42 } });
    expect(vm.socialProof).not.toBeNull();
    expect(vm.socialProof.soldLabel).toBe('42 vendus');
  });

  it('actif si rating > 0 seul', () => {
    const vm = buildModalViewModel({ social_proof: { rating: 4.5 } });
    expect(vm.socialProof.ratingLabel).toBe('4.5');
  });

  it('actif si reviews_count > 0 seul', () => {
    const vm = buildModalViewModel({ social_proof: { reviews_count: 12 } });
    expect(vm.socialProof.reviewsLabel).toBe('12 avis');
  });

  it('labels vides pour les champs à 0/absents même si le bloc est actif', () => {
    const vm = buildModalViewModel({ social_proof: { sold_count: 10 } });
    expect(vm.socialProof.ratingLabel).toBe('');
    expect(vm.socialProof.reviewsLabel).toBe('');
  });
});

describe('buildModalViewModel — dataQualityScore', () => {
  it('score explicite respecté et clampé [0,100]', () => {
    expect(buildModalViewModel({ data_quality_score: 80 }).dataQualityScore).toBe(80);
    expect(buildModalViewModel({ data_quality_score: 150 }).dataQualityScore).toBe(100);
    expect(buildModalViewModel({ data_quality_score: -10 }).dataQualityScore).toBe(0);
  });

  it('score dérivé : produit complet = 100', () => {
    const vm = buildModalViewModel({
      name: 'Sac', price_kmf: 1000, images: ['a.jpg'], category: 'sacs', description: 'joli sac',
    });
    expect(vm.dataQualityScore).toBe(100);
  });

  it('score dérivé : produit totalement vide = 0 (nom fallback ne compte pas)', () => {
    expect(buildModalViewModel({}).dataQualityScore).toBe(0);
  });

  it('isLowConfidence true sous le seuil de 40', () => {
    expect(buildModalViewModel({}).isLowConfidence).toBe(true);
  });

  it('isLowConfidence false au-dessus du seuil', () => {
    const vm = buildModalViewModel({
      name: 'Sac', price_kmf: 1000, images: ['a.jpg'], category: 'sacs', description: 'joli sac',
    });
    expect(vm.isLowConfidence).toBe(false);
  });

  it('image placeholder ne compte pas dans le score', () => {
    const vm = buildModalViewModel({ name: 'Sac', price_kmf: 1000 }); // pas d'image → placeholder
    expect(vm.dataQualityScore).toBe(50); // name(25) + price(25), pas d'image ni catégorie ni description
  });
});

describe('buildModalViewModel — safeName/safeDescription/imageAlt (sanitize réel)', () => {
  it('échappe le HTML dans safeName', () => {
    const vm = buildModalViewModel({ name: '<script>alert(1)</script>' });
    expect(vm.safeName).not.toContain('<script>');
  });

  it('échappe le HTML dans safeDescription', () => {
    const vm = buildModalViewModel({ description: '<img src=x onerror=alert(1)>' });
    expect(vm.safeDescription).not.toContain('<img');
  });

  it('imageAlt dérivé du nom sanitizé', () => {
    const vm = buildModalViewModel({ name: 'Sac <b>Deluxe</b>' });
    expect(vm.imageAlt).toBe(vm.safeName);
  });
});

describe('buildModalViewModel — cssClasses (contrat 7+3 classes)', () => {
  it('produit vide → no-price, fulfillment-relay, low-confidence uniquement', () => {
    const vm = buildModalViewModel({});
    expect(vm.cssClasses).toEqual(
      expect.arrayContaining(['k-modal--no-price', 'k-modal--fulfillment-relay', 'k-modal--low-confidence'])
    );
    expect(vm.cssClasses).not.toContain('k-modal--has-promo');
    expect(vm.cssClasses).not.toContain('k-modal--stock-out');
  });

  it('has-promo si oldPriceKmf > 0', () => {
    const vm = buildModalViewModel({ price_kmf: 800, promo_pct: 20 });
    expect(vm.cssClasses).toContain('k-modal--has-promo');
  });

  it('has-variants si variants non vide', () => {
    const vm = buildModalViewModel({ variants: [{ size: 'M' }] });
    expect(vm.cssClasses).toContain('k-modal--has-variants');
  });

  it('has-delivery si deliveryEstimate présent', () => {
    const vm = buildModalViewModel({ eta: '48h' });
    expect(vm.cssClasses).toContain('k-modal--has-delivery');
  });

  it('stock-low si stockStatus low', () => {
    const vm = buildModalViewModel({ stock: 3 });
    expect(vm.cssClasses).toContain('k-modal--stock-low');
  });

  it('stock-out si stockStatus unavailable', () => {
    const vm = buildModalViewModel({ stock: 0 });
    expect(vm.cssClasses).toContain('k-modal--stock-out');
  });

  it('has-social-proof si socialProof actif', () => {
    const vm = buildModalViewModel({ social_proof: { sold_count: 5 } });
    expect(vm.cssClasses).toContain('k-modal--has-social-proof');
  });

  it('has-specs si specs non vide', () => {
    const vm = buildModalViewModel({ specs: ['coton'] });
    expect(vm.cssClasses).toContain('k-modal--has-specs');
  });

  it('no-price absent si priceKmf > 0', () => {
    const vm = buildModalViewModel({ price_kmf: 1000 });
    expect(vm.cssClasses).not.toContain('k-modal--no-price');
  });

  it('low-confidence absent si score >= seuil', () => {
    const vm = buildModalViewModel({
      name: 'Sac', price_kmf: 1000, images: ['a.jpg'], category: 'sacs', description: 'joli sac',
    });
    expect(vm.cssClasses).not.toContain('k-modal--low-confidence');
  });

  it('cssClassName = jointure espace de cssClasses', () => {
    const vm = buildModalViewModel({});
    expect(vm.cssClassName).toBe(vm.cssClasses.join(' '));
  });

  it('fulfillment-* toujours présent quel que soit le type', () => {
    expect(buildModalViewModel({ fulfillment_type: 'local' }).cssClasses).toContain('k-modal--fulfillment-local');
    expect(buildModalViewModel({ fulfillment_type: 'custom' }).cssClasses).toContain('k-modal--fulfillment-custom');
  });
});

describe('applyModalClasses', () => {
  it('ne throw pas si modalEl null/undefined', () => {
    expect(() => applyModalClasses(null, { cssClasses: ['x'] })).not.toThrow();
  });

  it('ne throw pas si viewModel null/undefined ou sans cssClasses', () => {
    const el = document.createElement('div');
    expect(() => applyModalClasses(el, null)).not.toThrow();
    expect(() => applyModalClasses(el, {})).not.toThrow();
  });

  it('pose les classes du ViewModel sur l\'élément', () => {
    const el = document.createElement('div');
    applyModalClasses(el, { cssClasses: ['k-modal--has-promo', 'k-modal--stock-low'] });
    expect(el.classList.contains('k-modal--has-promo')).toBe(true);
    expect(el.classList.contains('k-modal--stock-low')).toBe(true);
  });

  it('retire les anciennes classes contractuelles avant de poser les nouvelles (pas de rémanence)', () => {
    const el = document.createElement('div');
    el.className = 'k-modal k-modal--has-promo k-modal--stock-low';
    applyModalClasses(el, { cssClasses: ['k-modal--has-specs'] });
    expect(el.classList.contains('k-modal--has-promo')).toBe(false);
    expect(el.classList.contains('k-modal--stock-low')).toBe(false);
    expect(el.classList.contains('k-modal--has-specs')).toBe(true);
  });

  it('ne touche pas aux classes non-contractuelles (sans préfixe k-modal--)', () => {
    const el = document.createElement('div');
    el.className = 'k-modal is-open k-modal--has-promo';
    applyModalClasses(el, { cssClasses: [] });
    expect(el.classList.contains('k-modal')).toBe(true);
    expect(el.classList.contains('is-open')).toBe(true);
    expect(el.classList.contains('k-modal--has-promo')).toBe(false);
  });

  it('idempotent — appelé deux fois de suite avec le même ViewModel, résultat stable', () => {
    const el = document.createElement('div');
    const vm = { cssClasses: ['k-modal--has-promo'] };
    applyModalClasses(el, vm);
    applyModalClasses(el, vm);
    expect(el.className.split(' ').filter(c => c === 'k-modal--has-promo').length).toBe(1);
  });
});
