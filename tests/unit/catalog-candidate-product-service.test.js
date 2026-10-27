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
        product_name: 'Silky Light Fog Lip Gloss',
        supplier_category: 'Health, Beauty & Hair > Makeup > Lipstick',
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
  test('a lip gloss cannot be classified as Auto lighting by a Discovery keyword',async()=>{
    const candidate=cj('Silky Light Fog Lip Gloss',
      'Health, Beauty & Hair > Makeup > Lipstick','Auto','Éclairage');
    const q={query:jest.fn().mockResolvedValue({rows:[]})};
    const verdict=await resolveCommercialTaxonomyVerdict(q,candidate);
    expect(verdict).toEqual({status:'REVIEW_REQUIRED',source:'DISCOVERY_PRIOR',
      category:null,subcategory:null,proposal:{category:'Auto',subcategory:'Éclairage'}});
    expect(q.query.mock.calls.map(([sql])=>sql).join(' ')).toContain('object_classification_terms');
    await expect(createDraftProductFromSourcingCandidate(q,{candidate,initialPrice:null}))
      .rejects.toThrow('BOUTIQUE_TAXONOMY_UNRESOLVED');
    expect(q.query.mock.calls.some(([sql])=>/INSERT INTO products/i.test(sql))).toBe(false);
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


describe('progressive taxonomy — certified parent vs unverified Discovery',()=>{
  const {resolveCommercialTaxonomyVerdict,
    createDraftProductFromSourcingCandidate}=require('../../services/catalog-candidate-product-service');
  const qFor=(rows,insert=true)=>({
    query:jest.fn(async (sql)=>{
      if(sql.includes('FROM supplier_commercial_category_mappings'))return {rows:[]};
      if(sql.includes('object_classification_terms'))return {rows};
      if(sql.includes('FROM boutique_categories WHERE key='))return {rows:[{key:'Maison'}]};
      if(sql.includes('INSERT INTO products'))return {rows:insert?[{id:'draft-parent'}]:[]};
      return {rows:[]};
    }),
  });
  const candidate={supplier_name:'CJdropshipping',
    product_name:'Storage Cube Organizer',supplier_category:'Unmapped > Unclear Objects',
    raw_payload:{discovery:{target_category:'Tech',target_subcategory:'Phones'}}};
  test('two equally strong object matches within one parent resolve CATEGORY, never a fictitious leaf',async()=>{
    const q=qFor([
      {category:'Maison',subcategory:'Cuisine',terms:{'storage cube':12}},
      {category:'Maison',subcategory:'Déco',terms:{'storage cube':12}},
    ]);
    expect(await resolveCommercialTaxonomyVerdict(q,candidate)).toMatchObject({
      status:'CATEGORY_CLASSIFIED',level:'CATEGORY',category:'Maison',
      subcategory:null,source:'OBJECT_TERM_COMMON_PARENT'});
    await expect(createDraftProductFromSourcingCandidate(q,{candidate,initialPrice:null}))
      .resolves.toBe('draft-parent');
    const insert=q.query.mock.calls.find(([sql])=>sql.includes('INSERT INTO products'));
    expect(insert[1].slice(2,4)).toEqual(['Maison',null]);
    expect(insert[1][5]).toBeNull();
    expect(insert[0]).toContain("FALSE, FALSE, 'candidate'");
  });
  test('equally strong terms across root categories are not promoted to a parent',async()=>{
    const q=qFor([
      {category:'Maison',subcategory:'Déco',terms:{'storage cube':12}},
      {category:'Tech',subcategory:'Audio',terms:{'storage cube':12}},
    ]);
    await expect(resolveCommercialTaxonomyVerdict(q,candidate)).resolves.toMatchObject({
      status:'REVIEW_REQUIRED',source:'DISCOVERY_PRIOR',category:null,subcategory:null});
    await expect(createDraftProductFromSourcingCandidate(q,{candidate,initialPrice:null}))
      .rejects.toThrow('BOUTIQUE_TAXONOMY_UNRESOLVED');
    expect(q.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO products'))).toBe(false);
  });
  test('a parent absent from active boutique categories cannot be drafted',async()=>{
    const q=qFor([
      {category:'Maison',subcategory:'Cuisine',terms:{'storage cube':12}},
      {category:'Maison',subcategory:'Déco',terms:{'storage cube':12}},
    ]);
    q.query.mockImplementation(async sql=>{
      if(sql.includes('FROM supplier_commercial_category_mappings'))return {rows:[]};
      if(sql.includes('object_classification_terms'))return {rows:[
        {category:'Maison',subcategory:'Cuisine',terms:{'storage cube':12}},
        {category:'Maison',subcategory:'Déco',terms:{'storage cube':12}}]};
      return {rows:[]};
    });
    await expect(createDraftProductFromSourcingCandidate(q,{candidate,initialPrice:null}))
      .rejects.toThrow('BOUTIQUE_CATEGORY_INACTIVE');
  });
});


describe('supplier path + actual object corroborate category without inventing a leaf',()=>{
  const {categoryCorroboratedByObject}=require('../../services/catalog-commercial-category-evidence');
  const {resolveCommercialTaxonomyVerdict,
    createDraftProductFromSourcingCandidate}=require('../../services/catalog-candidate-product-service');
  const candidate=(product_name,supplier_category,discoveryCategory='Auto')=>({
    supplier_name:'CJdropshipping',product_name,supplier_category,
    raw_payload:{discovery:{target_category:discoveryCategory,
      target_subcategory:'Éclairage'}},
  });
  const qFor=(active=true)=>({query:jest.fn(async (sql)=>{
    if(sql.includes('FROM supplier_commercial_category_mappings'))return {rows:[]};
    if(sql.includes('object_classification_terms'))return {rows:[]};
    if(sql.includes('FROM boutique_categories WHERE key='))return {rows:active?[{key:'Maison'}]:[]};
    if(sql.includes('INSERT INTO products'))return {rows:[{id:'inactive-only'}]};
    return {rows:[]};
  })});

  test.each([
    ['High Heels Catwalk Shoes Far Shoes Women',"Bags & Shoes > Women's Shoes > Slippers",'Mode & Beauté'],
    ['Portable Makeup Brush Beauty Tools','Health, Beauty & Hair > Makeup > Makeup Brushes','Mode & Beauté'],
    ['Diatomaceous Earth Sink Tray Kitchen Organizer','Home, Garden & Furniture > Home Storage > Office Storage','Maison'],
    ['Ceramic Bedside Table Lamp','Home Improvement > Indoor Lighting > Night Lights','Maison'],
    ['Cabin Air Filter fit for Sprinter','Automobiles & Motorcycles > Auto Replacement Parts > Other','Auto'],
    ['Bluetooth Wireless Headphones','Consumer Electronics > Portable Audio & Video > Headphones','Tech'],
    ['Type C Mobile Phone Charging Cable','Phones & Accessories > Mobile Accessories > Cables','Tech'],
    ['Ratchet Screwdriver With Drill Bits','Home Improvement > Tools > Tool Sets','Bricolage'],
  ])('category-only corroboration: %s', (name,path,expected)=>{
    expect(categoryCorroboratedByObject(candidate(name,path))).toMatchObject({
      category:expected,subcategory:null,level:'CATEGORY',source:'SUPPLIER_PATH_AND_OBJECT',
    });
  });

  test.each([
    ['Wireless Bluetooth Earbuds','Jewelry & Watches > Fashion Jewelry > Keychains'],
    ['USB-C Wall Charger 45W','Home, Garden & Furniture > Home Storage > Home Office Storage'],
    ['Ceramic Table Lamp','Home Improvement > Tools > Garden Tools'],
    ['Car Phone Charger Bluetooth Wireless','Automobiles & Motorcycles > Car Electronics > Audio'],
    ['Makeup Storage Box With LED Light','Home, Garden & Furniture > Home Storage > Office'],
    ['Professional Portable Electric Nail Drill','Health, Beauty & Hair > Beauty Tools > Manicure'],

  ])('no unjustified parent: %s', (name,path)=>{
    expect(categoryCorroboratedByObject(candidate(name,path))).toBeNull();
  });
  test('Discovery can propose a competing category but never reverse the dual evidence',async()=>{
    const c=candidate('Mobile Phone Holder','Phones & Accessories > Mobile Accessories > Holders','Maison');
    const q=qFor();
    await expect(resolveCommercialTaxonomyVerdict(q,c)).resolves.toMatchObject({
      status:'CATEGORY_CLASSIFIED',category:'Tech',subcategory:null,
      source:'SUPPLIER_PATH_AND_OBJECT',
    });
    expect(q.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO products'))).toBe(false);
  });
  test('inactive parent rejected before draft INSERT',async()=>{
    const c=candidate('Metal Shoe Rack Storage Shelf',
      'Home, Garden & Furniture > Home Storage > Furniture','Tech');
    // "shoe" (fashion) and "storage" (home) are competing title universes:
    // corroboration must refuse a seemingly convenient parent.
    expect(categoryCorroboratedByObject(c)).toBeNull();
    const safe=candidate('Kitchen Cooking Utensil',
      'Home, Garden & Furniture > Kitchen, Dining & Bar > Cooking Tools','Tech');
    const q=qFor(false);
    await expect(resolveCommercialTaxonomyVerdict(q,safe)).resolves.toMatchObject({
      status:'REVIEW_REQUIRED',source:'CORROBORATED_CATEGORY_INACTIVE',category:null,
    });
    await expect(createDraftProductFromSourcingCandidate(q,{candidate:safe,initialPrice:null}))
      .rejects.toThrow('BOUTIQUE_TAXONOMY_UNRESOLVED');
    expect(q.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO products'))).toBe(false);
  });
  test('category-only handoff creates an inactive unpriced draft, no publication',async()=>{
    const c=candidate('Kitchen Cooking Utensil',
      'Home, Garden & Furniture > Kitchen, Dining & Bar > Cooking Tools','Tech');
    const q=qFor(true);
    await expect(createDraftProductFromSourcingCandidate(q,{candidate:c,initialPrice:12999}))
      .resolves.toBe('inactive-only');
    const insert=q.query.mock.calls.find(([sql])=>sql.includes('INSERT INTO products'));
    expect(insert[1].slice(2,4)).toEqual(['Maison',null]);
    expect(insert[1][5]).toBeNull();
    expect(insert[0]).toContain("FALSE, FALSE, 'candidate'");
  });
});


describe('corroborated object protects reusable supplier mappings',()=>{
  const {resolveCommercialTaxonomyVerdict,
    createDraftProductFromSourcingCandidate}=require('../../services/catalog-candidate-product-service');
  const candidate={supplier_name:'CJdropshipping',
    product_name:'Kitchen Cooking Utensil',
    supplier_category:'Home, Garden & Furniture > Home Storage > Home Office Storage',
    raw_payload:{discovery:{target_category:'Tech',target_subcategory:'Phones'}}};
  test('polluted generic path mapped to Tech cannot override a kitchen object',async()=>{
    const q={query:jest.fn().mockResolvedValue({
      rows:[{category:'Tech',subcategory:'Phones'}]})};
    await expect(resolveCommercialTaxonomyVerdict(q,candidate)).resolves.toMatchObject({
      status:'REVIEW_REQUIRED',category:null,subcategory:null,
      source:'CONFIRMED_MAPPING_OBJECT_CONFLICT',
      evidence:{mapping_category:'Tech',object_category:'Maison'},
    });
    await expect(createDraftProductFromSourcingCandidate(q,{candidate,initialPrice:null}))
      .rejects.toThrow('BOUTIQUE_TAXONOMY_UNRESOLVED');
    expect(q.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO products'))).toBe(false);
  });
  test('compatible confirmed mapping keeps its pair (not downgraded)',async()=>{
    const q={query:jest.fn().mockResolvedValue({
      rows:[{category:'Maison',subcategory:'Cuisine'}]})};
    await expect(resolveCommercialTaxonomyVerdict(q,candidate)).resolves.toMatchObject({
      status:'AUTO_CLASSIFIED',category:'Maison',subcategory:'Cuisine',
      source:'CONFIRMED_SUPPLIER_PATH',
    });
  });
});


describe('CJ real-world evidence generalization: no token-property confusion',()=>{
  const {categoryCorroboratedByObject}=require('../../services/catalog-commercial-category-evidence');
  const c=(product_name,supplier_category)=>({product_name,supplier_category});
  test.each([
    ['A17 Pro Max Smartphone, 256GB Storage, 72MP Camera',
      'Phones & Accessories > Mobile Phones > Dual SIM Card','Tech'],
    ['Silicone Kitchenware Set',
      'Home, Garden & Furniture > Kitchen, Dining & Bar > Cooking Tools','Maison'],
    ['Electric Hot Pot with Cooking Tools',
      'Home, Garden & Furniture > Kitchen, Dining & Bar > Cooking Tools','Maison'],
    ['Solar Wall Light Outdoor Wireless Lamps',
      'Home Improvement > Outdoor Lighting > Solar Lamps','Maison'],
    ['Solar Street Path Light Outdoor',
      'Home Improvement > Outdoor Lighting > Solar Lamps','Maison'],
    ['NM-B Wire 14AWG Copper Core Cable 50 Ft Electrical Wire With Ground',
      'Home Improvement > Tools > Tool Sets','Bricolage'],
    ['Solar Panel Extension Wire Female and Male Connectors',
      'Home Improvement > Tools > Tool Sets','Bricolage'],
    ['Cable Dispenser Mounted Portable For Electrical Industrial',
      'Home Improvement > Tools > Tool Sets','Bricolage'],
    ['Solar Connector Crimper Tool with Cable Storage Box',
      'Home Improvement > Tools > Tool Sets','Bricolage'],
  ])('two-source category proof %s', (product_name,supplier_category,category)=>{
    expect(categoryCorroboratedByObject(c(product_name,supplier_category)))
      .toMatchObject({category,subcategory:null,source:'SUPPLIER_PATH_AND_OBJECT'});
  });
  test.each([
    ['Smartphone with 256GB Storage','Home, Garden & Furniture > Home Storage > Office'],
    ['USB-C Charger with Storage','Home, Garden & Furniture > Home Storage > Office'],
    ['Car Interior LED Lamp','Home Improvement > Outdoor Lighting > Solar Lamps'],
    ['USB-C Cable','Home Improvement > Tools > Tool Sets'],
    ['Audio Cable','Home Improvement > Tools > Tool Sets'],
    ['Garden Toy with Solar Panel Wire','Home Improvement > Tools > Tool Sets'],
    ['Solar Cable Organizer Cabinet','Home Improvement > Tools > Tool Sets'],
  ])('adversarial conflict/unproved object stays review: %s',(product_name,supplier_category)=>{
    expect(categoryCorroboratedByObject(c(product_name,supplier_category))).toBeNull();
  });
});


describe('Object identity counter-audit: material is not an object and kits have multiple purposes',()=>{
  const {categoryCorroboratedByObject}=require('../../services/catalog-commercial-category-evidence');
  const {resolveCommercialTaxonomyVerdict}=require('../../services/catalog-candidate-product-service');
  const toyPath='Toys, Kids & Babies > Toys & Hobbies > Action & Toy Figures';
  const homePath='Home, Garden & Furniture > Kitchen, Dining & Bar > Cooking Tools';
  test.each([
    ['ins dinosaur children plush backpack',toyPath],
    ['Plush Foam Cushion',toyPath],
    ['Velvet Plush Baby Blanket',toyPath],
    ['Tumbler Heat Press Machine And Sublimation Tumblers With Mug Press Cup Press',homePath],
    ['Mug Press Machine + 8 Ceramic Mugs',homePath],
  ])('rejects an object that a misleading secondary noun would put in Maison: %s',(product_name,supplier_category)=>{
    expect(categoryCorroboratedByObject({product_name,supplier_category})).toBeNull();
  });
  test.each([
    ['Plush Bunny Toy',toyPath],
    ['Large Plush Teddy Bear',toyPath],
    ['Plush Toy Doll',toyPath],
    ['Baby Stroller Bag Organizer','Toys, Kids & Babies > Baby & Mother > Activity & Gear'],
    ['Heat Resistant Ceramic Coffee Mug',homePath],
    ['Dishwashing Mug Storage Cabinet',homePath],
  ])('retains evidence for true item identity: %s',(product_name,supplier_category)=>{
    expect(categoryCorroboratedByObject({product_name,supplier_category}))
      .toMatchObject({category:'Maison',level:'CATEGORY'});
  });
  test.each([
    ['ins dinosaur children plush backpack',toyPath],
    ['Tumbler Heat Press Machine And Sublimation Tumblers With Mug Press Cup Press',homePath],
  ])('uncertainty remains review and never becomes an authoritative draft: %s',
    async(product_name,supplier_category)=>{
      const q={query:jest.fn(async sql=>{
        if(sql.includes('object_classification_terms'))return {rows:[]};
        if(sql.includes('FROM supplier_commercial_category_mappings'))return {rows:[]};
        return {rows:[]};
      })};
      const verdict=await resolveCommercialTaxonomyVerdict(q,{
        supplier_name:'CJdropshipping',product_name,supplier_category,
        raw_payload:{discovery:{target_category:'Maison',target_subcategory:'Enfants'}}});
      expect(verdict).toMatchObject({status:'REVIEW_REQUIRED',category:null,subcategory:null,
        source:'DISCOVERY_PRIOR'});
    });
});


describe('toy vehicle is not an automotive part (frozen CJ object identities)',()=>{
  const {categoryCorroboratedByObject}=require('../../services/catalog-commercial-category-evidence');
  const {resolveCommercialTaxonomyVerdict}=require('../../services/catalog-candidate-product-service');
  const toy='Toys, Kids & Babies > Toys & Hobbies > Action & Toy Figures';
  test.each([
    ['Remote Control Toy Car F1 Racing Style With Music And Light',toy],
    ['Ride On Motorcycle 6V Ride on Bubble Car 3 Wheeled Electric Motorcycle for Kids',
      'Toys, Kids & Babies > Toys & Hobbies > Blocks'],
    ['Pink 6V Kids 3-Wheel Electric Ride On Motorcycle for Children',toy],
  ])('explicit toy vehicle under actual toy breadcrumb proves Maison parent: %s',
    async(product_name,supplier_category)=>{
      const c={product_name,supplier_category};
      expect(categoryCorroboratedByObject(c)).toMatchObject({
        category:'Maison',subcategory:null,source:'SUPPLIER_PATH_AND_OBJECT'});
      const q={query:jest.fn(async sql=>sql.includes('FROM boutique_categories WHERE key=')
        ? {rows:[{key:'Maison'}]} : {rows:[]})};
      await expect(resolveCommercialTaxonomyVerdict(q,{...c,
        supplier_name:'CJdropshipping',
        raw_payload:{discovery:{target_category:'Auto',target_subcategory:'Éclairage'}}}))
        .resolves.toMatchObject({status:'CATEGORY_CLASSIFIED',category:'Maison',
          subcategory:null,source:'SUPPLIER_PATH_AND_OBJECT'});
    });
  test.each([
    ['Adult Ride On Motorcycle Helmet',toy],
    ['Motorcycle Brake Rotor Spare Parts',toy],
    ['Remote Control Car Brake Assembly',toy],
    ['Toy Car Brake Rotor Repair Kit',toy],
    ['Kids Electric Ride On Car',
      'Home, Garden & Furniture > Home Storage > Furniture'],
  ])('an uncorroborated or contradictory vehicle stays unresolved: %s',
    (product_name,supplier_category)=>{
      expect(categoryCorroboratedByObject({product_name,supplier_category})).toBeNull();
    });
});
