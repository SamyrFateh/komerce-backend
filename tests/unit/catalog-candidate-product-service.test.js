'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  createDraftProductFromSourcingCandidate,
  hasVariantsFromCandidate,
  draftPurchaseCostFromCandidate,
  draftStockFromCandidate,
  resolveCommercialObjectTaxonomy,
  objectPhraseMatch,
} = require('../../services/catalog-candidate-product-service');

describe('contextual object phrase matching', () => {
  it('recognizes bounded intervening material descriptors', () => {
    expect(objectPhraseMatch('Car Zinc Alloy Leather Key Case Cover','car key case')).toBe(true);
    expect(objectPhraseMatch('Car Memory Foam Neck Pillow','car neck pillow')).toBe(true);
    expect(objectPhraseMatch('GEELY Car Zinc Alloy Leather Key Case','car key case')).toBe(true);
  });
  it('rejects reversed words and excess gaps', () => {
    expect(objectPhraseMatch('Key Case For Car','car key case')).toBe(false);
    expect(objectPhraseMatch('Car One Two Three Four Five Six Key Case','car key case')).toBe(false);
    expect(objectPhraseMatch('Toy Car Model','car key case')).toBe(false);
    expect(objectPhraseMatch('Car','car')).toBe(false);
  });
});

describe('commercial object routing — independent of customs', () => {
  const q = { query: jest.fn().mockResolvedValue({rows:[
    {category:'Auto',subcategory:'Accessoires',terms:{'car key case':12,'car neck pillow':12}},
    {category:'Tech',subcategory:'Phones',terms:{'phone case':12}},
  ]}) };
  beforeEach(() => q.query.mockClear());
  it('routes key cases and neck pillows to generic Auto accessories', async () => {
    expect(await resolveCommercialObjectTaxonomy(q,{product_name:'Car Zinc Alloy Leather Key Case Cover'}))
      .toEqual({category:'Auto',subcategory:'Accessoires'});
    expect(await resolveCommercialObjectTaxonomy(q,{product_name:'Car Neck Pillow Memory Foam'}))
      .toEqual({category:'Auto',subcategory:'Accessoires'});
  });
  it('does not invent a category from car alone or discovery search terms', async () => {
    expect(await resolveCommercialObjectTaxonomy(q,{product_name:'Toy Car Model',
      raw_payload:{discovery:{keyword:'car key case'}}}))
      .toEqual({category:null,subcategory:null});
  });
  it('fails closed on ambiguous identical scores', async () => {
    const ambiguous = {query:jest.fn().mockResolvedValue({rows:[
      {category:'Auto',subcategory:'Accessoires',terms:{'car key case':12}},
      {category:'Tech',subcategory:'Phones',terms:{'car key case':12}},
    ]})};
    expect(await resolveCommercialObjectTaxonomy(ambiguous,{product_name:'Car Key Case'}))
      .toEqual({category:null,subcategory:null});
  });
});

describe('catalog-candidate-product-service', () => {
  it('creates the inactive candidate product through the injected transaction client', async () => {
    const q = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ category: 'Mode & Beauté', subcategory: 'Femme' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'product-1' }] }),
    };
    const candidate = {
      product_name: 'Chemise',
      komerce_category: 'mode',
      purchase_price_kmf: 1200,
      estimated_weight_kg: 0.4,
      stock_available: 17,
      description: 'Raw supplier description',
      commercial_taxonomy_review: {
        status: 'CONFIRMED', category: 'Mode & Beauté', subcategory: 'Femme',
      },
      raw_payload: {
        discovery: {
          target_category: 'Auto',
          target_subcategory: 'Éclairage',
        },
      },
    };

    await expect(createDraftProductFromSourcingCandidate(q, {
      candidate,
      initialPrice: 2500,
    })).resolves.toBe('product-1');

    expect(q.query).toHaveBeenCalledTimes(2);
    expect(q.query.mock.calls[0][0]).toContain('FROM boutique_categories');
    expect(q.query.mock.calls[1][0]).toContain('INSERT INTO products');
    expect(q.query.mock.calls[1][0]).toContain("FALSE, 'candidate'");
    expect(q.query.mock.calls[1][1]).toEqual([
      'Chemise',
      'mode',
      'Mode & Beauté',
      'Femme',
      1200,
      2500,
      17,
      0.4,
      false,
      'Chemise',
      'Raw supplier description',
      'en',
      // 'Raw supplier description' ne porte aucun point final : aucune
      // phrase factuelle fiable n'est extraite, donc aucune invention —
      // description publiée nulle, revue éditoriale signalée.
      null,
      true,
    ]);
  });

  it('preserves historical catalog fallbacks', async () => {
    const q = {
      query: jest.fn().mockImplementation(sql => Promise.resolve(sql.includes('INSERT INTO products') ? { rows:[{id:'product-2'}] } : {rows:[]})),
    };

    await createDraftProductFromSourcingCandidate(q, {
      candidate: { product_name: 'Produit brut' },
      initialPrice: 900,
    });

    expect(q.query.mock.calls[1][1]).toEqual([
      'Produit brut',
      'autre',
      null,
      null,
      null,
      900,
      0,
      null,
      false,
      'Produit brut',
      null,
      'en',
      // Aucune description fournisseur : rien n'est fabriqué, revue signalée.
      null,
      true,
    ]);
  });

  it('publie un nom court et une description proposée sans revue quand la source est française et démontrée', async () => {
    const q = {
      query: jest.fn().mockImplementation(sql => Promise.resolve(sql.includes('INSERT INTO products') ? { rows:[{id:'product-4'}] } : {rows:[]})),
    };

    await createDraftProductFromSourcingCandidate(q, {
      candidate: {
        product_name: 'Casque Bluetooth',
        description: 'Casque sans fil confortable avec réduction de bruit. Autonomie de 20 heures.',
        // source_locale='fr' : seule voie doctrinale (§4) où connector_raw
        // peut être déclaré prêt sans revue humaine.
        normalized_source_contract: { source_locale: 'fr' },
      },
      initialPrice: 5000,
    });

    const params = q.query.mock.calls[1][1];
    expect(params[0]).toBe('Casque Bluetooth');
    // Première phrase extraite telle quelle (rien d'inventé), démontrée FR
    // par looksFrench/englishResidues (pas par la seule ponctuation) ;
    // la description fournisseur complète reste intacte dans description_source.
    expect(params[12]).toBe('Casque sans fil confortable avec réduction de bruit.');
    expect(params[13]).toBe(false);
    expect(params[10]).toBe('Casque sans fil confortable avec réduction de bruit. Autonomie de 20 heures.');
  });

  it('signale une revue pour une source non française même si une phrase s\'extrait proprement (DOCTRINE_CATALOGUE §4)', async () => {
    const q = {
      query: jest.fn().mockImplementation(sql => Promise.resolve(sql.includes('INSERT INTO products') ? { rows:[{id:'product-5'}] } : {rows:[]})),
    };

    await createDraftProductFromSourcingCandidate(q, {
      candidate: {
        product_name: 'Bluetooth Headset',
        description: 'Comfortable wireless headset. 20h battery.',
        // source_locale par défaut ('en') : connector_raw non français ne
        // peut jamais être déclaré prêt (doctrine §4), quelle que soit la
        // qualité apparente de l'extraction.
      },
      initialPrice: 3000,
    });

    const params = q.query.mock.calls[1][1];
    // La proposition reste disponible (rien n'est perdu)...
    expect(params[12]).toBe('Comfortable wireless headset.');
    // ...mais jamais déclarée prête sans revue.
    expect(params[13]).toBe(true);
  });
});


  it('does not confuse customs category with boutique taxonomy', async () => {
    const q = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ category: 'Tech', subcategory: 'Audio' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'product-3' }] }),
    };

    await createDraftProductFromSourcingCandidate(q, {
      candidate: {
        product_name: 'Casque',
        komerce_category: 'electro',
        commercial_taxonomy_review: {
          status: 'CONFIRMED', category: 'Tech', subcategory: 'Audio',
        },
        raw_payload: {
          discovery: {
            target_category: 'Auto',
            target_subcategory: 'Éclairage',
          },
        },
      },
      initialPrice: 12000,
    });

    const sql = q.query.mock.calls[1][0];
    const params = q.query.mock.calls[1][1];
    expect(sql).toContain('boutique_category_key');
    expect(sql).toContain('boutique_subcategory_key');
    expect(params[1]).toBe('electro');
    expect(params[2]).toBe('Tech');
    expect(params[3]).toBe('Audio');
  });

describe('catalog draft supplier truth', () => {
  it('ne fabrique ni coût fournisseur ni variantes absentes', () => {
    expect(draftPurchaseCostFromCandidate({})).toBeNull();
    expect(draftPurchaseCostFromCandidate({ purchase_price_kmf: 0 })).toBeNull();
    expect(draftPurchaseCostFromCandidate({ purchase_price_kmf: 1250 })).toBe(1250);
    expect(hasVariantsFromCandidate({})).toBe(false);
  });

  it('déduit has_variants uniquement des unités fournisseur réellement optionnées', () => {
    expect(hasVariantsFromCandidate({
      normalized_source_contract: {
        sellable_units: [
          { supplier_sku: 'CJ-1', option_values: { cj_size: 'M' } },
          { supplier_sku: 'CJ-2', option_values: { cj_size: 'L' } },
        ],
      },
    })).toBe(true);

    expect(hasVariantsFromCandidate({
      normalized_source_contract: {
        sellable_units: [{ supplier_sku: 'CJ-DEFAULT', option_values: {} }],
      },
    })).toBe(false);
  });
});

describe('catalog draft stock truth', () => {
  it('reprend le stock source connu et ne fabrique jamais le défaut historique 100', () => {
    expect(draftStockFromCandidate({ stock_available: 23 })).toBe(23);
    expect(draftStockFromCandidate({ stock_available: '7' })).toBe(7);
    expect(draftStockFromCandidate({ stock_available: null })).toBe(0);
    expect(draftStockFromCandidate({})).toBe(0);
    expect(draftStockFromCandidate({ stock_available: -1 })).toBe(0);
  });
});

describe('catalog candidate boutique taxonomy guard', () => {
  it('rejects Discovery-only (even a known-looking shelf) before creating a supplier draft', async () => {
    const q = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await expect(createDraftProductFromSourcingCandidate(q, {
      candidate: {
        supplier_name: 'CJdropshipping',
        product_name: 'Unidentifiable CJ SKU',
        supplier_category: 'General > Unknown Products',
        raw_payload: { discovery: { target_category: 'Auto', target_subcategory: 'Éclairage' } },
      },
      initialPrice: 1000,
    })).rejects.toThrow('BOUTIQUE_TAXONOMY_UNRESOLVED');
    expect(q.query.mock.calls.every(([sql]) => /^SELECT/i.test(sql.trim()))).toBe(true);
  });
});

describe('orphan prevention at catalog draft boundary', () => {
  test.each(['AliExpress', 'CJdropshipping'])('%s unresolved boutique taxonomy cannot create product', async (supplier) => {
    const q = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await expect(createDraftProductFromSourcingCandidate(q, {
      candidate: {
        product_name: 'Unknown unclassified item',
        supplier_name: supplier,
        normalized_source_contract: { supplier_name: supplier },
      },
      initialPrice: 1000,
    })).rejects.toThrow('BOUTIQUE_TAXONOMY_UNRESOLVED');
    expect(q.query.mock.calls.every(([sql]) => /^SELECT/i.test(sql.trim()))).toBe(true);
  });
});

describe('supplier commercial mapping priority', () => {
  test('confirmed path takes precedence over title scoring without touching customs', async () => {
    const {resolveActiveBoutiqueTaxonomy}=require('../../services/catalog-candidate-product-service');
    const q={query:jest.fn().mockResolvedValue({rows:[{category:'Auto',subcategory:'Accessoires'}]})};
    const result=await resolveActiveBoutiqueTaxonomy(q,{
      product_name:'Generic unknown item',supplier_category:'Automobiles > Interior Accessories',
      normalized_source_contract:{supplier_name:'AliExpress'},
      komerce_category:null,
    });
    expect(result).toEqual({category:'Auto',subcategory:'Accessoires'});
    expect(q.query.mock.calls[0][0]).toContain("m.status='CONFIRMED'");
    expect(q.query.mock.calls[0][1]).toEqual(['aliexpress','automobiles > interior accessories']);
  });
  test('unmapped supplier path falls back to read-only configured object matcher', async () => {
    const {resolveActiveBoutiqueTaxonomy}=require('../../services/catalog-candidate-product-service');
    const q={query:jest.fn()
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[{category:'Auto',subcategory:'Accessoires',terms:{'car neck pillow':12}}]})};
    const result=await resolveActiveBoutiqueTaxonomy(q,{
      product_name:'Car Neck Pillow',supplier_category:'Automobiles > Interior Accessories',
      normalized_source_contract:{supplier_name:'AliExpress'},
    });
    expect(result).toEqual({category:'Auto',subcategory:'Accessoires'});
    expect(q.query).toHaveBeenCalledTimes(2);
  });
});

describe('confirmed commercial attachment priority', () => {
  const { boutiqueTaxonomyFromCandidate, resolveActiveBoutiqueTaxonomy } =
    require('../../services/catalog-candidate-product-service');

  test('confirmed boutique taxonomy overrides discovery but never the customs field', async () => {
    const candidate = {
      product_name: 'Phone Case',
      komerce_category: 'douane-originale',
      commercial_taxonomy_review: {
        status: 'CONFIRMED', category: 'Tech', subcategory: 'Phones',
        source: 'SUPPLIER_MAPPING',
      },
      raw_payload: {
        discovery: { target_category: 'Auto', target_subcategory: 'Accessoires' },
      },
    };
    const q = { query: jest.fn().mockResolvedValue({
      rows: [{ category: 'Tech', subcategory: 'Phones' }],
    }) };
    expect(boutiqueTaxonomyFromCandidate(candidate)).toEqual({
      category: 'Tech', subcategory: 'Phones',
    });
    await expect(resolveActiveBoutiqueTaxonomy(q, candidate)).resolves.toEqual({
      category: 'Tech', subcategory: 'Phones',
    });
    expect(q.query).toHaveBeenCalledTimes(1);
    expect(q.query.mock.calls[0][1]).toEqual(['Tech', 'Phones']);
    expect(candidate.komerce_category).toBe('douane-originale');
  });

  test('unconfirmed commercial review and Discovery are both non-authoritative', () => {
    const {discoveryCommercialPrior}=require('../../services/catalog-candidate-product-service');
    const candidate={
      commercial_taxonomy_review: {
        status: 'PENDING', category: 'Tech', subcategory: 'Phones',
      },
      raw_payload: {
        discovery: { target_category: 'Auto', target_subcategory: 'Accessoires' },
      },
    };
    expect(boutiqueTaxonomyFromCandidate(candidate))
      .toEqual({category:null,subcategory:null});
    expect(discoveryCommercialPrior(candidate))
      .toEqual({category:'Auto',subcategory:'Accessoires'});
  });
});

describe('unified commercial classification verdict', () => {
  const {resolveCommercialTaxonomyVerdict}=require('../../services/catalog-candidate-product-service');
  test('confirmed supplier path classifies without title fallback',async()=>{
    const q={query:jest.fn().mockResolvedValue({rows:[{category:'Tech',subcategory:'Phones'}]})};
    const result=await resolveCommercialTaxonomyVerdict(q,{
      supplier_name:'AliExpress',supplier_category:'Phones > Cases',product_name:'Unknown object',
    });
    expect(result).toEqual({status:'AUTO_CLASSIFIED',category:'Tech',subcategory:'Phones',
      source:'CONFIRMED_SUPPLIER_PATH'});
    expect(q.query).toHaveBeenCalledTimes(1);
  });
  test('CJ unknown supplier path can classify by unique object name',async()=>{
    const q={query:jest.fn()
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[{category:'Auto',subcategory:'Accessoires',terms:{'car neck pillow':10}}]})};
    await expect(resolveCommercialTaxonomyVerdict(q,{
      supplier_name:'CJdropshipping',supplier_category:'Unmapped',product_name:'Car Neck Pillow',
    })).resolves.toMatchObject({status:'AUTO_CLASSIFIED',source:'OBJECT_NAME_MATCH',
      category:'Auto',subcategory:'Accessoires'});
  });
  test('ambiguous object remains review required with no fabricated pair',async()=>{
    const q={query:jest.fn()
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[
        {category:'Auto',subcategory:'Accessoires',terms:{'car neck pillow':10}},
        {category:'Maison',subcategory:'Textile',terms:{'car neck pillow':10}},
      ]})
      .mockResolvedValue({rows:[]})};
    await expect(resolveCommercialTaxonomyVerdict(q,{
      supplier_name:'AliExpress',supplier_category:'Unmapped',product_name:'Car Neck Pillow',
    })).resolves.toEqual({status:'REVIEW_REQUIRED',category:null,subcategory:null,
      source:'UNRESOLVED_COMMERCIAL_TAXONOMY'});
  });
});

test('confirmed supplier mapping overrides conflicting discovery for next product',async()=>{
  const {resolveCommercialTaxonomyVerdict}=require('../../services/catalog-candidate-product-service');
  const q={query:jest.fn().mockResolvedValueOnce({
    rows:[{category:'Tech',subcategory:'Phones'}]})};
  const result=await resolveCommercialTaxonomyVerdict(q,{
    supplier_name:'AliExpress',supplier_category:'Phones > Cases',
    product_name:'Phone Case',
    raw_payload:{discovery:{target_category:'Maison',target_subcategory:'Salon'}},
  });
  expect(result).toMatchObject({category:'Tech',subcategory:'Phones',
    source:'CONFIRMED_SUPPLIER_PATH'});
  expect(q.query).toHaveBeenCalledTimes(1);
});


describe('real supplier to inactive catalogue draft — independent commercial proof',()=>{
  const {
    resolveCommercialTaxonomyVerdict,
    createDraftProductFromSourcingCandidate,
  }=require('../../services/catalog-candidate-product-service');
  const cj=(name,path,category,subcategory)=>({
    supplier_name:'CJdropshipping',product_name:name,supplier_category:path,
    komerce_category:'cosmetiques',purchase_price_kmf:450,
    stock_available:7,
    raw_payload:{discovery:{target_category:category,target_subcategory:subcategory,
      keyword:'fog light',segment_id:'auto-eclairage'}},
  });
  test('a real lip gloss is routed to Mode category, NEVER Discovery Auto lighting',async()=>{
    const candidate=cj('Silky Light Fog Lip Gloss',
      'Health, Beauty & Hair > Makeup > Lipstick','Auto','Éclairage');
    const q={query:jest.fn(async sql=>{
      if(sql.includes('INSERT INTO products'))return {rows:[{id:'draft-cosmetic'}]};
      if(sql.includes('SELECT key FROM boutique_categories'))return {rows:[{key:'Mode & Beauté'}]};
      return {rows:[]};
    })};
    const verdict=await resolveCommercialTaxonomyVerdict(q,candidate);
    expect(verdict).toMatchObject({status:'CATEGORY_CLASSIFIED',level:'CATEGORY',
      category:'Mode & Beauté',subcategory:null,source:'SOURCE_AND_OBJECT_ROOT_CORROBORATED'});
    await expect(createDraftProductFromSourcingCandidate(q,{candidate,initialPrice:null}))
      .resolves.toBe('draft-cosmetic');
    const insert=q.query.mock.calls.find(([sql])=>sql.includes('INSERT INTO products'));
    expect(insert[1].slice(2,4)).toEqual(['Mode & Beauté',null]);
    expect(insert[0]).toContain("FALSE, FALSE, 'candidate'");
  });
  test('real object terms take precedence over a wrong Discovery segment, without publication',async()=>{
    const candidate=cj('Car Neck Pillow Memory Foam',
      'Car Accessories > Cushions','Maison','Déco');
    const query=jest.fn(async sql=>{
      if(sql.includes('FROM supplier_commercial_category_mappings'))return {rows:[]};
      if(sql.includes('object_classification_terms'))return {rows:[
        {category:'Auto',subcategory:'Accessoires',terms:{'car neck pillow':12}}
      ]};
      if(sql.includes('INSERT INTO products'))return {rows:[{id:'draft-1'}]};
      throw Error('Unexpected SQL query in object/draft path: '+sql);
    });
    const q={query};
    expect(await resolveCommercialTaxonomyVerdict(q,candidate)).toEqual({
      status:'AUTO_CLASSIFIED',category:'Auto',subcategory:'Accessoires',
      source:'OBJECT_NAME_MATCH',
    });
    await expect(createDraftProductFromSourcingCandidate(q,{candidate,initialPrice:null}))
      .resolves.toBe('draft-1');
    const insert=query.mock.calls.find(([sql])=>sql.includes('INSERT INTO products'));
    expect(insert[1].slice(1,4)).toEqual(['cosmetiques','Auto','Accessoires']);
    expect(insert[1][5]).toBeNull();
    expect(insert[0]).toContain("FALSE, FALSE, 'candidate'");
  });
  test('human CONFIRMED is authoritative and still validated against active shelves',async()=>{
    const candidate=cj('Unknown CJ SKU','Miscellaneous','Auto','Éclairage');
    candidate.commercial_taxonomy_review={status:'CONFIRMED',
      category:'Tech',subcategory:'Phones'};
    const q={query:jest.fn().mockResolvedValueOnce({rows:[
      {category:'Tech',subcategory:'Phones'}]})
      .mockResolvedValueOnce({rows:[{id:'confirmed-draft'}]})};
    expect(await createDraftProductFromSourcingCandidate(q,{candidate,initialPrice:null}))
      .toBe('confirmed-draft');
    expect(q.query.mock.calls[0][1]).toEqual(['Tech','Phones']);
    expect(q.query.mock.calls[1][1].slice(2,4)).toEqual(['Tech','Phones']);
  });
  test('a human-confirmed inactive destination cannot create a draft',async()=>{
    const candidate=cj('Unknown SKU','Miscellaneous','Auto','Éclairage');
    candidate.commercial_taxonomy_review={status:'CONFIRMED',
      category:'Tech',subcategory:'Inactive'};
    const q={query:jest.fn().mockResolvedValue({rows:[]})};
    await expect(createDraftProductFromSourcingCandidate(q,{candidate,initialPrice:null}))
      .rejects.toThrow('BOUTIQUE_TAXONOMY_INVALID');
    expect(q.query.mock.calls.every(([sql])=>sql.trim().startsWith('SELECT'))).toBe(true);
  });
});

describe('progressive commercial tree placement',()=>{
  const {resolveCommercialTaxonomyVerdict,createDraftProductFromSourcingCandidate}
    =require('../../services/catalog-candidate-product-service');
  test('supplier corroborated object gets CATEGORY_CLASSIFIED; no mandatory leaf',async()=>{
    const candidate={
      product_name:'Fashion Open Ring',supplier_name:'CJdropshipping',
      supplier_category:'Jewelry & Watches > Fashion Jewelry > Rings',
      raw_payload:{discovery:{target_category:'Bricolage',target_subcategory:'Sécurité'}},
    };
    const q={query:jest.fn(async sql=>{
      if(sql.includes('SELECT key FROM boutique_categories'))return {rows:[{key:'Mode & Beauté'}]};
      return {rows:[]};
    })};
    const verdict=await resolveCommercialTaxonomyVerdict(q,candidate);
    expect(verdict).toMatchObject({status:'CATEGORY_CLASSIFIED',
      category:'Mode & Beauté',subcategory:null,level:'CATEGORY'});
  });
  test('inactive category cannot create catalog draft even when source/product corroborate',async()=>{
    const candidate={
      product_name:'Fashion Ring',supplier_name:'CJdropshipping',
      supplier_category:'Jewelry & Watches > Fashion Jewelry > Rings',
      raw_payload:{discovery:{target_category:'Mode & Beauté',target_subcategory:'Femme'}}
    };
    const q={query:jest.fn().mockResolvedValue({rows:[]})};
    await expect(createDraftProductFromSourcingCandidate(q,{candidate,initialPrice:null}))
      .rejects.toThrow('BOUTIQUE_TAXONOMY_UNRESOLVED');
    expect(q.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO products'))).toBe(false);
  });
  test('unknown object stays suggestion, cannot enter draft via Discovery',async()=>{
    const candidate={
      product_name:'Unknown Mystery SKU',supplier_name:'CJdropshipping',
      supplier_category:'Generic > Product',
      raw_payload:{discovery:{target_category:'Tech',target_subcategory:'Audio'}}};
    const q={query:jest.fn().mockResolvedValue({rows:[]})};
    await expect(resolveCommercialTaxonomyVerdict(q,candidate)).resolves.toMatchObject({
      status:'REVIEW_REQUIRED',source:'DISCOVERY_PRIOR',category:null,subcategory:null});
    await expect(createDraftProductFromSourcingCandidate(q,{candidate,initialPrice:null}))
      .rejects.toThrow('BOUTIQUE_TAXONOMY_UNRESOLVED');
  });
});
