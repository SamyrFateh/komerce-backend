'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../../services/supplier-catalog-scanner', () => ({
  convertToKMF: jest.fn(),
  scanCandidate: jest.fn(),
}));
jest.mock('../../services/pricing-engine', () => ({ loadGlobalConfig: jest.fn() }));
jest.mock('../../services/catalog-enrichment', () => ({ enrichAndApply: jest.fn() }));
jest.mock('../../services/catalog-candidate-product-service', () => ({
  createDraftProductFromSourcingCandidate: jest.fn(),
  resolveCommercialTaxonomyVerdict: jest.fn(async (_q,candidate) =>
    candidate.supplier_category === 'Phones > Mobile Phone Accessories'
      ? {status:'AUTO_CLASSIFIED',category:'Tech',subcategory:'Phones'}
      : candidate.supplier_category === 'Jewelry & Watches > Fashion Jewelry > Rings'
      ? {status:'CATEGORY_CLASSIFIED',level:'CATEGORY',
        category:'Mode & Beauté',subcategory:null,source:'SOURCE_AND_OBJECT_ROOT_CORROBORATED'}
      : {status:'REVIEW_REQUIRED',category:null,subcategory:null}),
}));
jest.mock('../../services/catalog-promotion', () => ({ promoteCatalog: jest.fn() }));

const {
  SourcingCandidateActionError,
  requireCandidate,
  updateCandidate,
  watchlistCandidate,
  rejectCandidate,
  confirmCandidateBoutiqueCategory,
} = require('../../services/sourcing-candidate-actions');
const candidateProductService = jest.requireActual('../../services/catalog-candidate-product-service');

describe('sourcing-candidate-actions', () => {
  it('refuse une devise hors whitelist avant toute lecture ou écriture', async () => {
    const q = { query: jest.fn() };
    await expect(updateCandidate('candidate-1', { currency: 'BTC' }, 'admin-1', q))
      .rejects.toMatchObject({ name: 'SourcingCandidateActionError', status: 400, code: 'candidate_currency_invalid' });
    expect(q.query).not.toHaveBeenCalled();
  });

  it('requireCandidate expose une erreur métier stable quand le candidat n’existe pas', async () => {
    const q = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await expect(requireCandidate('missing', q))
      .rejects.toMatchObject({ status: 404, code: 'candidate_not_found' });
  });

  it('watchlist écrit l’état puis journalise la transition avec l’acteur', async () => {
    const q = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'candidate-1', state: 'scanned' }] })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 }),
    };

    await expect(watchlistCandidate('candidate-1', 'admin-1', q))
      .resolves.toEqual({ state: 'watchlist' });

    expect(q.query.mock.calls[1][0]).toContain("SET state='watchlist'");
    expect(q.query.mock.calls[1][1]).toEqual(['admin-1', 'candidate-1']);
    expect(q.query.mock.calls[2][0]).toContain("'state_change'");
    expect(q.query.mock.calls[2][1]).toEqual(['candidate-1', 'scanned', 'admin-1']);
  });

  it('reject journalise la raison et conserve la transition d’état', async () => {
    const q = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'candidate-1', state: 'scanned' }] })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 }),
    };

    const result = await rejectCandidate('candidate-1', 'Douane', 'admin-1', q);
    expect(result).toEqual({ state: 'rejected', rejected_reason: 'Douane' });
    expect(q.query.mock.calls[1][1]).toEqual(['Douane', 'admin-1', 'candidate-1']);
    expect(q.query.mock.calls[2][1]).toEqual(['candidate-1', 'scanned', 'Douane', 'admin-1']);
  });

  it('exporte une classe d’erreur typée pour les façades HTTP', () => {
    const err = new SourcingCandidateActionError(409, 'Conflict', 'candidate_conflict');
    expect(err).toMatchObject({ name: 'SourcingCandidateActionError', status: 409, code: 'candidate_conflict' });
  });
});

describe('catalog candidate draft source locale', () => {
  it('préserve la locale du contrat normalisé pour la traduction FR', async () => {
    const q = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'product-1' }] }) };
    const candidate = {
      product_name: 'Kabel USB',
      description: 'Przewód USB do ładowania',
      purchase_price_kmf: 1500,
      komerce_category: 'electronique',
      normalized_source_contract: { source_locale: 'pl-PL' },
    };

    await expect(candidateProductService.createDraftProductFromSourcingCandidate(q, {
      candidate,
      initialPrice: null,
    })).resolves.toBe('product-1');

    expect(q.query.mock.calls.find(call => call[0].includes('INSERT INTO products'))[0]).toContain("FALSE, FALSE, 'candidate'");
    expect(q.query.mock.calls.find(call => call[0].includes('INSERT INTO products'))[1][5]).toBeNull();
    expect(q.query.mock.calls.find(call => call[0].includes('INSERT INTO products'))[1][11]).toBe('pl-PL');
    expect(candidateProductService.sourceLocaleFromCandidate(candidate)).toBe('pl-PL');
    expect(candidateProductService.sourceLocaleFromCandidate({})).toBe('en');
  });
});

describe('commercial review before inactive catalogue draft', () => {
  test('requires commercial review if no economic category is available', async () => {
    const db=require('../../db');
    const create=require('../../services/catalog-candidate-product-service').createDraftProductFromSourcingCandidate;
    const {promoteCandidate}=require('../../services/sourcing-candidate-actions');
    const client={query:jest.fn()
      .mockResolvedValueOnce({rows:[]}) // BEGIN
      .mockResolvedValueOnce({rows:[{
        id:'candidate-1',state:'scanned',komerce_category:null,
        data_sources:{category:'default'},scan_result:{customs_review:{status:'REQUIRED'}},
      }]})
      .mockResolvedValueOnce({rows:[]})}; // ROLLBACK
    db.getClient.mockResolvedValueOnce({...client,release:jest.fn()});
    await expect(promoteCandidate('candidate-1',{},'admin-1')).rejects.toMatchObject({
      code:'candidate_commercial_category_review_required',status:409,
    });
    expect(create).not.toHaveBeenCalled();
  });
});

test('supplier corroborated category-only promotes a real sourcing candidate to an inactive catalogue draft',async()=>{
  jest.clearAllMocks();
  const db=require('../../db');
  const catalog=require('../../services/catalog-candidate-product-service');
  const {promoteCandidate}=require('../../services/sourcing-candidate-actions');
  const promotion=require('../../services/catalog-promotion');
  const candidate={
    id:'ring-1',state:'scanned',supplier_name:'CJdropshipping',
    supplier_category:'Jewelry & Watches > Fashion Jewelry > Rings',
    product_name:'Fashion Ring',komerce_category:null,
    data_sources:{category:'default'},scan_result:{customs_review:{status:'REQUIRED'}},
    raw_payload:{discovery:{target_category:'Bricolage',target_subcategory:'Sécurité'}}
  };
  const client={query:jest.fn(async sql=>sql.includes('SELECT * FROM sourcing_candidates')
    ?{rows:[candidate]}:{rows:[]}),release:jest.fn()};
  db.getClient.mockResolvedValueOnce(client);
  catalog.createDraftProductFromSourcingCandidate.mockResolvedValueOnce('category-only-draft');
  promotion.promoteCatalog.mockResolvedValueOnce({promoted:true});
  const result=await promoteCandidate('ring-1',{},'admin-1',{syncRuntime:false});
  expect(result.product_id).toBe('category-only-draft');
  expect(catalog.createDraftProductFromSourcingCandidate).toHaveBeenCalledWith(
    client,{candidate,initialPrice:null});
  expect(client.query.mock.calls.some(([sql])=>sql==='COMMIT')).toBe(true);
});

test('confirmed boutique review allows an inactive draft despite unresolved customs',async()=>{
  const db=require('../../db');
  const catalog=require('../../services/catalog-candidate-product-service');
  const {promoteCandidate}=require('../../services/sourcing-candidate-actions');
  const promotion=require('../../services/catalog-promotion');
  const candidate={
    id:'candidate-2', state:'scanned', komerce_category:null,
    data_sources:{category:'default'}, scan_result:{customs_review:{status:'REQUIRED'}},
    commercial_taxonomy_review:{status:'CONFIRMED',category:'Tech',subcategory:'Phones'},
  };
  const client={query:jest.fn().mockImplementation(sql=>Promise.resolve(
    sql.includes('SELECT * FROM sourcing_candidates')?{rows:[candidate]}:{rows:[]})),
    release:jest.fn()};
  db.getClient.mockResolvedValueOnce(client);
  catalog.createDraftProductFromSourcingCandidate.mockResolvedValueOnce('prod-draft-2');
  promotion.promoteCatalog.mockResolvedValueOnce({promoted:true});
  const result=await promoteCandidate('candidate-2',{},'admin-1',{syncRuntime:false});
  expect(result.product_id).toBe('prod-draft-2');
  expect(result.price_decision).toBe('DEFERRED_TO_PUBLICATION');
  expect(catalog.createDraftProductFromSourcingCandidate).toHaveBeenCalledWith(
    client,{candidate,initialPrice:null});
  expect(client.query.mock.calls.some(call=>call[0]==='COMMIT')).toBe(true);
});

test('commercial confirmation never bypasses explicit exclusion',async()=>{
  jest.clearAllMocks();
  const db=require('../../db');
  const {promoteCandidate}=require('../../services/sourcing-candidate-actions');
  const catalog=require('../../services/catalog-candidate-product-service');
  const candidate={ id:'excluded',state:'scanned',
    scan_result:{sourcing_decision:'EXCLUDED'},
    commercial_taxonomy_review:{status:'CONFIRMED',category:'Tech',subcategory:'Phones'} };
  const client={query:jest.fn().mockImplementation(sql=>Promise.resolve(
    sql.includes('SELECT * FROM sourcing_candidates')?{rows:[candidate]}:{rows:[]})),
    release:jest.fn()};
  db.getClient.mockResolvedValueOnce(client);
  await expect(promoteCandidate('excluded',{},'admin-1',{syncRuntime:false}))
    .rejects.toMatchObject({code:'candidate_excluded',status:409});
  expect(catalog.createDraftProductFromSourcingCandidate).not.toHaveBeenCalled();
});

test('commercial confirmation saves supplier mapping and candidate review then creates inactive draft',async()=>{
  jest.clearAllMocks();
  const db=require('../../db');
  const catalog=require('../../services/catalog-candidate-product-service');
  const candidate={id:'c-1',candidate_ref:'KSC-000051',supplier_name:'AliExpress',
    supplier_category:'Phones > Mobile Phone Accessories',state:'scanned',
    scan_result:{sourcing_decision:'WATCH'}};
  const client={query:jest.fn()
    .mockResolvedValueOnce({rows:[]}) // BEGIN
    .mockResolvedValueOnce({rows:[candidate]}) // locked candidate
    .mockResolvedValueOnce({rows:[{category:'Tech',subcategory:'Phones'}]}) // active pair
    .mockResolvedValueOnce({rows:[{status:'CONFIRMED'}]}) // upsert
    .mockResolvedValueOnce({rows:[]}) // update review
    .mockResolvedValueOnce({rows:[]}) // audit
    .mockResolvedValueOnce({rows:[]}),release:jest.fn()}; // COMMIT
  db.getClient.mockResolvedValueOnce(client);
  // The follow-up promotion uses its own transaction; we model its existing seam.
  const followUp={query:jest.fn().mockImplementation(sql=>Promise.resolve(
    sql.includes('SELECT * FROM sourcing_candidates')
      ? {rows:[{...candidate,commercial_taxonomy_review:{
          status:'CONFIRMED',category:'Tech',subcategory:'Phones'
        },komerce_category:null}]}
      : {rows:[]})),release:jest.fn()};
  db.getClient.mockResolvedValueOnce(followUp);
  catalog.createDraftProductFromSourcingCandidate.mockResolvedValueOnce('draft-1');
  require('../../services/catalog-promotion').promoteCatalog.mockResolvedValueOnce({});
  const result=await confirmCandidateBoutiqueCategory('KSC-000051',
    {category:'Tech',subcategory:'Phones'},'admin-1');
  expect(result).toMatchObject({confirmed:true,draft_created:true,price_decision:'DEFERRED_TO_PUBLICATION'});
  const stored=client.query.mock.calls.find(call=>String(call[0]).includes('commercial_taxonomy_review='));
  expect(JSON.parse(stored[1][0])).toMatchObject({status:'CONFIRMED',category:'Tech',subcategory:'Phones'});
  expect(client.query.mock.calls.some(call=>call[0]==='COMMIT')).toBe(true);
  expect(followUp.query.mock.calls.some(call=>call[0]==='COMMIT')).toBe(true);
});

test('commercial category confirmation cannot modify an excluded candidate',async()=>{
  jest.clearAllMocks();
  const db=require('../../db');
  const candidate={id:'excluded',state:'scanned',
    scan_result:{sourcing_decision:'EXCLUDED'}};
  const client={query:jest.fn().mockResolvedValueOnce({rows:[]})
    .mockResolvedValueOnce({rows:[candidate]})
    .mockResolvedValueOnce({rows:[]}),release:jest.fn()};
  db.getClient.mockResolvedValueOnce(client);
  await expect(confirmCandidateBoutiqueCategory('KSC-000173',
    {category:'Tech',subcategory:'Phones'},'admin-1'))
    .rejects.toMatchObject({code:'candidate_not_classifiable',status:409});
  expect(client.query.mock.calls.some(call=>String(call[0]).includes('UPDATE sourcing_candidates'))).toBe(false);
  expect(client.query.mock.calls.some(call=>call[0]==='ROLLBACK')).toBe(true);
});


test('a previously confirmed supplier category auto-enters an inactive draft with zero new validation',async()=>{
  jest.clearAllMocks();
  const db=require('../../db');
  const mapping=require('../../services/supplier-commercial-category-mapping');
  const catalog=require('../../services/catalog-candidate-product-service');
  const promotion=require('../../services/catalog-promotion');
  const {promoteCandidate}=require('../../services/sourcing-candidate-actions');
  const candidate={id:'known-source',state:'scanned',supplier_name:'AliExpress',
    supplier_category:'Phones > Mobile Phone Accessories',
    normalized_source_contract:{supplier_name:'AliExpress'},
    komerce_category:null,data_sources:{category:'default'},
    scan_result:{sourcing_decision:'WATCH',customs_review:{status:'REQUIRED'}}};
  const client={query:jest.fn().mockImplementation(sql=>Promise.resolve(
    sql.includes('SELECT * FROM sourcing_candidates')?{rows:[candidate]}:
    sql.includes('FROM supplier_commercial_category_mappings')?
      {rows:[{category:'Tech',subcategory:'Phones'}]}:{rows:[]})),release:jest.fn()};
  db.getClient.mockResolvedValueOnce(client);
  catalog.createDraftProductFromSourcingCandidate.mockResolvedValueOnce('draft-known');
  promotion.promoteCatalog.mockResolvedValueOnce({promoted:true});
  const result=await promoteCandidate('known-source',{},null,{syncRuntime:false});
  expect(result).toMatchObject({product_id:'draft-known',price_decision:'DEFERRED_TO_PUBLICATION'});
  // The single commercial resolver is mocked in this unit seam.
  // An existing mapping requires no new mapping write or user validation.
  expect(require('../../services/catalog-candidate-product-service')
    .resolveCommercialTaxonomyVerdict).toHaveBeenCalledWith(client,candidate);
  expect(client.query.mock.calls.some(([sql])=>sql==='COMMIT')).toBe(true);
  expect(catalog.createDraftProductFromSourcingCandidate).toHaveBeenCalledWith(
    client,{candidate,initialPrice:null});
  // Mapping reuse is read-only, never a new human-confirmation write.
  expect(client.query.mock.calls.some(([sql])=>String(sql).includes('INSERT INTO supplier_commercial_category_mappings'))).toBe(false);
});

test('source category without a confirmed provider mapping still requires review',async()=>{
  jest.clearAllMocks();
  const db=require('../../db');
  const catalog=require('../../services/catalog-candidate-product-service');
  const {promoteCandidate}=require('../../services/sourcing-candidate-actions');
  const candidate={id:'unknown-source',state:'scanned',supplier_name:'AliExpress',
    supplier_category:'Phones > Ambiguous Items',komerce_category:null,
    data_sources:{category:'default'},scan_result:{customs_review:{status:'REQUIRED'}}};
  const client={query:jest.fn().mockImplementation(sql=>Promise.resolve(
    sql.includes('SELECT * FROM sourcing_candidates')?{rows:[candidate]}:{rows:[]})),release:jest.fn()};
  db.getClient.mockResolvedValueOnce(client);
  await expect(promoteCandidate('unknown-source',{},null,{syncRuntime:false}))
    .rejects.toMatchObject({code:'candidate_commercial_category_review_required',status:409});
  expect(catalog.createDraftProductFromSourcingCandidate).not.toHaveBeenCalled();
});
