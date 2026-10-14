'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const {
  classifySupplierProduct,
  supplierCategoryLevels,
  supplierSignals,
  scoreCategory,
} = require('../../services/customs-dynamic-category-classifier');

describe('dynamic customs supplier category classifier', () => {
  test('classifies into a category that does not exist anywhere in scanner code', () => {
    const categories = [
      {
        key: 'bagagerie_test',
        label: 'Bagagerie',
        classification_terms: { crossbody: 10, handbag: 9, satchel: 8 },
        display_order: 4,
        is_active: true,
      },
      {
        key: 'default',
        label: 'Default',
        classification_terms: {},
        display_order: 999,
        is_active: true,
      },
    ];

    const result = classifySupplierProduct({
      product_name: 'Women Leather Crossbody Bag',
      raw_payload: { discovery: { keyword: 'women crossbody bag' } },
    }, categories);

    expect(result).toEqual(expect.objectContaining({
      key: 'bagagerie_test',
      source: 'mapped',
      confidence: 'high',
      reason: 'configured_terms_match',
    }));
  });

  test('ignores inactive categories even when their terms match', () => {
    const result = classifySupplierProduct({
      product_name: 'Women Leather Crossbody Bag',
      raw_payload: { discovery: { keyword: 'crossbody bag' } },
    }, [
      {
        key: 'disabled_bags',
        label: 'Disabled Bags',
        classification_terms: { crossbody: 20 },
        is_active: false,
      },
      {
        key: 'default',
        label: 'Default',
        classification_terms: {},
        is_active: true,
      },
    ]);

    expect(result).toEqual(expect.objectContaining({
      key: 'default',
      source: 'default',
      reason: 'no_configured_term_match',
    }));
  });

  test('returns unresolved instead of inventing a business category when no match exists', () => {
    const result = classifySupplierProduct({
      product_name: 'Unknown Supplier Object',
      raw_payload: { discovery: { keyword: 'mystery object' } },
    }, [
      {
        key: 'known_category',
        label: 'Known',
        classification_terms: { known: 10 },
        is_active: true,
      },
    ]);

    expect(result).toEqual(expect.objectContaining({
      key: null,
      source: 'default',
      confidence: 'low',
      reason: 'no_configured_term_match',
    }));
  });

  test('supplier identity outranks a polluted discovery keyword', () => {
    const categories = [
      {
        key: 'hardware_dynamic',
        label: 'Hardware',
        classification_terms: { motorcycle: 7, footpeg: 10, bicycle: 9 },
        is_active: true,
      },
      {
        key: 'fashion_dynamic',
        label: 'Fashion',
        classification_terms: { blouse: 7, dress: 7 },
        is_active: true,
      },
    ];

    const result = classifySupplierProduct({
      product_name: 'Aluminum Motorcycle Part Universal Footpeg for bicycle',
      raw_payload: {
        discovery: {
          keyword: 'linen women blouse',
          target_subcategory: 'Femme',
        },
      },
    }, categories);

    expect(result).toEqual(expect.objectContaining({
      key: 'hardware_dynamic',
      source: 'mapped',
    }));
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ signal: 'product_name', term: 'footpeg' }),
    ]));
  });

  test('falls back to active boutique subcategory affinity when lexical match is unresolved', () => {
    const categories = [
      { key: 'materiels', label: 'Matériels', classification_terms: { wrench: 10 }, is_active: true },
      { key: 'electro', label: 'Électro', classification_terms: { speaker: 10 }, is_active: true },
    ];
    const result = classifySupplierProduct({
      product_name: 'Generic replacement component',
      raw_payload: {
        discovery: {
          target_category: 'Auto',
          target_subcategory: 'Freinage',
        },
      },
    }, categories, {
      boutique_customs_affinities: [
        { category_key: 'Auto', subcategory_key: 'Freinage', customs_category_key: 'materiels' },
      ],
    });

    expect(result).toEqual(expect.objectContaining({
      key: 'materiels',
      source: 'boutique_affinity',
      confidence: 'medium',
      reason: 'boutique_subcategory_affinity',
    }));
  });

  test('supplier lexical identity still outranks a conflicting boutique affinity', () => {
    const categories = [
      { key: 'materiels', label: 'Matériels', classification_terms: { wrench: 10 }, is_active: true },
      { key: 'electro', label: 'Électro', classification_terms: { speaker: 10 }, is_active: true },
    ];
    const result = classifySupplierProduct({
      product_name: 'Bluetooth Speaker Portable Speaker',
      raw_payload: {
        discovery: {
          target_category: 'Auto',
          target_subcategory: 'Freinage',
        },
      },
    }, categories, {
      boutique_customs_affinities: [
        { category_key: 'Auto', subcategory_key: 'Freinage', customs_category_key: 'materiels' },
      ],
    });

    expect(result).toEqual(expect.objectContaining({
      key: 'electro',
      source: 'mapped',
    }));
  });

  test('uses discovery intent only as a secondary signal', () => {
    const signals = supplierSignals({
      product_name: 'Real Product',
      supplier_category: 'Supplier Category',
      description: 'Description',
      raw_payload: { discovery: { keyword: 'Search Intent', target_subcategory: 'Target' } },
    });
    expect(signals.map(({ name, multiplier }) => [name, multiplier])).toEqual([
      ['product_name', 6],
      ['supplier_category', 4],
      ['description', 2],
      ['keyword', 2],
      ['target_subcategory', 1],
    ]);
  });

  test('fournisseur multirayons : évite le faux électroménager pour bague, bracelet et boucles d’oreilles', () => {
    const categories = [
      {key:'electro',label:'Électroménager compact',
        classification_terms:{watches:7,'wrist watch':10,lamp:4},is_active:true},
      {key:'mariage',label:'Mariage et cadeaux',
        classification_terms:{jewelry:7,wedding:7,decor:5},is_active:true},
    ];
    for (const [name,leaf] of [
      ['Sterling Silver Colorful Crystals Ring Female Rainbow Color Zircon Ring','Rings'],
      ['Red Heart Glossy Strip Simple Ball Bracelet','Bracelets & Bangles'],
      ['Stainless Steel Thin Rod Piercing Earrings Colored Tourmaline Gradient Zircon','Earrings'],
    ]) {
      const product={product_name:name,
        supplier_category:`Jewelry & Watches > Fashion Jewelry > ${leaf}`};
      const signals=supplierSignals(product);
      expect(signals.map(x=>x.name)).not.toContain('supplier_category_root');
      expect(signals.map(x=>x.name)).toContain('supplier_category_leaf');
      // La branche « Fashion Jewelry » seule ne peut valider une classification
      // douanière, et « Watches » (rayon parent) n'est jamais prise pour un objet.
      expect(scoreCategory(categories[0],signals).score).toBe(0);
      const classification=classifySupplierProduct(product,categories);
      expect(classification).toMatchObject({
        key:null,source:'default',confidence:'low',reason:'object_identity_unconfirmed',
      });
      expect(classification.top_candidate_key).toBe('mariage');
    }
  });

  test('chemin CJ en slash ou chevrons : compare surtout la feuille et pas le rayon parent', () => {
    expect(supplierCategoryLevels('Jewelry & Watches > Fashion Jewelry > Rings'))
      .toEqual(['Jewelry & Watches','Fashion Jewelry','Rings']);
    expect(supplierCategoryLevels('Home & Garden, Furniture / Home Storage / Home Office Storage'))
      .toEqual(['Home & Garden, Furniture','Home Storage','Home Office Storage']);
    expect(supplierSignals({
      product_name:'Temporary Metal Waterproof Key Box At The Door',
      supplier_category:'Home & Garden, Furniture / Home Storage / Home Office Storage',
    }).map(({name,multiplier})=>[name,multiplier])).toEqual([
      ['product_name',6],
      ['supplier_category_leaf',4],
      ['supplier_category_branch',1],
    ]);
    expect(supplierCategoryLevels(null)).toEqual([]);
  });

  test('le rayon fournisseur ne classe pas seul, même avec un terme surpondéré', () => {
    const result=classifySupplierProduct({
      product_name:'Unidentified Supplier Item',
      supplier_category:'Miscellaneous > Fashion Jewelry > Rings',
    },[{key:'jewelry',label:'Jewelry',
      classification_terms:{jewelry:99},is_active:true}]);
    expect(result).toMatchObject({
      key:null,source:'default',reason:'object_identity_unconfirmed',
      top_candidate_key:'jewelry',
    });
    expect(result.score).toBe(99);
  });

  test('objet identifié dans le titre : conserve la classification dynamique haute confiance', () => {
    const categories=[
      {key:'bagagerie_dyn',label:'Bagagerie',
        classification_terms:{crossbody:10,handbag:8},is_active:true},
      {key:'electro_dyn',label:'Électronique',
        classification_terms:{headphones:9,'wireless headset':12},is_active:true},
    ];
    const bag=classifySupplierProduct({
      product_name:'Women Leather Crossbody Bag',
      supplier_category:'Fashion > Bags > Crossbody Bag',
    },categories);
    expect(bag).toMatchObject({key:'bagagerie_dyn',source:'mapped',confidence:'high'});
    expect(bag.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({signal:'product_name',term:'crossbody'}),
    ]));
    // La feuille fournisseur précise peut confirmer la catégorie même si
    // le titre ne possède aucun terme de taxonomie configuré.
    const audio=classifySupplierProduct({
      product_name:'Audio Device Model 42',
      supplier_category:'Consumer Electronics > Audio > Headphones',
    },categories);
    expect(audio).toMatchObject({key:'electro_dyn',source:'mapped',confidence:'high'});
    expect(audio.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({signal:'supplier_category_leaf',term:'headphones'}),
    ]));
  });

  test('replay de 12 objets observés : aucune catégorie inventée si taxonomie insuffisante', () => {
    const cases = [
      ['Temporary Metal Waterproof Key Box At The Door','Home, Garden & Furniture > Home Storage > Home Office Storage'],
      ['Sterling Silver Colorful Crystals Ring Female Rainbow Color Zircon Ring','Jewelry & Watches > Fashion Jewelry > Rings'],
      ['Solar Silk Cloth Pendant Tassel Lantern','Home, Garden & Furniture > Home Storage > Home Office Storage'],
      ['Stainless steel multifunctional sink drain stand','Home & Garden, Furniture / Home Storage / Home Office Storage'],
      ['Office Stationery Handmade Art Paper Cutting Special','Home, Garden & Furniture > Home Storage > Home Office Storage'],
      ['New Hot Selling Stoneware Nordic Creative Western Plate','Home, Garden & Furniture > Home Storage > Kitchen Storage'],
      ['Abdominal Exercising Band Squat Hard Pull Power Weightlifting Rowing Bench Press Protection Belt Men And Women Equipment Training','Sports & Outdoors > Sportswear > Sports Accessories'],
      ['Cocktail Glass Creative And Personalized With A Tall Stemchampagne Crystal Margarita Saucer-shaped Cup','Home, Garden & Furniture > Kitchen, Dining & Bar > Drinkware'],
      ['Red Heart Glossy Strip Simple Ball Bracelet','Jewelry & Watches > Fashion Jewelry > Bracelets & Bangles'],
      ['Stainless Steel Thin Rod Piercing Earrings Colored Tourmaline Gradient Zircon','Jewelry & Watches > Fashion Jewelry > Earrings'],
      ['Solid Wood Bay Window Succulent Plant Shelf For Indoor Living Room Desks','Home, Garden & Furniture > Home Storage > Home Office Storage'],
      ['Cute Breakfast Plate And Single-serving Bowl Set Underglaze Ceramic','Home, Garden & Furniture > Home Storage > Home Office Storage'],
    ];
    // Mini-référentiel des mots à risque déjà présents dans la calibration,
    // PAS un duplicata des catégories métier de production.
    const existingTerms=[
      {key:'electro',label:'Électroménager compact',
        classification_terms:{watches:7,lamp:4},is_active:true},
      {key:'mariage',label:'Mariage et cadeaux',
        classification_terms:{jewelry:7,decor:5},is_active:true},
    ];
    const decisions=cases.map(([product_name,supplier_category])=>
      classifySupplierProduct({product_name,supplier_category},existingTerms));
    expect(decisions).toHaveLength(12);
    expect(decisions.every(x=>x.source==='default')).toBe(true);
    // Aucune amélioration superficielle du taux de classement ne doit créer
    // une mauvaise classification douanière pour ces objets.
    expect(decisions.every(x=>x.key===null)).toBe(true);
  });

  test('configured weighted terms dominate weak label metadata', () => {
    const signals = [{ name: 'keyword', value: 'premium crossbody bag', multiplier: 5 }];
    const scored = scoreCategory({
      key: 'x',
      label: 'Bag',
      classification_terms: { crossbody: 10 },
    }, signals);

    expect(scored.score).toBeGreaterThanOrEqual(50);
    expect(scored.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ term: 'crossbody', contribution: 50 }),
    ]));
  });
});
