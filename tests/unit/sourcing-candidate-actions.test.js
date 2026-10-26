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
}));
jest.mock('../../services/catalog-promotion', () => ({ promoteCatalog: jest.fn() }));

const {
  SourcingCandidateActionError,
  requireCandidate,
  updateCandidate,
  watchlistCandidate,
  rejectCandidate,
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
