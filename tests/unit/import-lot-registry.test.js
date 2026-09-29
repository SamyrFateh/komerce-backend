'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../services/catalog-run-progress', () => ({
  productProgress: jest.fn(product => product.progress || { stage: 'ready', reason: null }),
}));
const { buildLot, classifyProduct, BUSINESS_STATUS } = require('../../services/import-lot-registry');

const run = overrides => ({
  run_ref:'KIR-000004',
  provider:'AliExpress',
  mode:'normal',
  status:'COMPLETED',
  source_total:19,
  intake:{ quarantined:0, certification_blocked:0 },
  ...overrides,
});

const product = (ref, overrides = {}) => ({
  state:'imported_to_catalog',
  product_id:'id-' + ref,
  product_ref:ref,
  product_name:'Produit ' + ref,
  lifecycle_status:'active',
  is_active:true,
  needs_review:false,
  content_source:'manual',
  active_media:1,
  progress:{ stage:'published', reason:null },
  ...overrides,
});

test('exposition sans prix LOCAL_ACTIVE ne vaut jamais approbation vente', () => {
  const item = classifyProduct(
    product('A'),
    [{ product_id:'id-A', market_id:'m1', exposure_enabled:true, exposure_disabled:false, price_active:false }],
    1
  );
  expect(item).toMatchObject({ state:'PENDING', action:'COMMERCIAL' });
});

test('prix actif + exposition sur un marché est une décision terminale positive', () => {
  const item = classifyProduct(
    product('A'),
    [{ product_id:'id-A', market_id:'m1', exposure_enabled:true, exposure_disabled:false, price_active:true }],
    1
  );
  expect(item).toMatchObject({ state:'APPROVED_FOR_SALE', action:null });
});

test('lot clos seulement lorsque chaque produit promu a une décision terminale et aucune exception', () => {
  const candidates = [product('A'), product('B')];
  const markets = [
    { product_id:'id-A', market_id:'m1', exposure_enabled:true, exposure_disabled:false, price_active:true },
    { product_id:'id-B', market_id:'m1', exposure_enabled:false, exposure_disabled:true, price_active:false },
  ];
  const lot = buildLot(run(), candidates, markets, 1);
  expect(lot.business_status).toBe(BUSINESS_STATUS.CLOSED);
  expect(lot.closure).toEqual({ eligible:true, decided_products:2, total_products:2, remaining_products:0 });
  expect(lot.decisions).toMatchObject({ approved_for_sale:1, not_retained:1, catalogue:0, commercial:0, exceptions:0 });
});

test('une quarantaine ou un produit encore à décider interdit la clôture', () => {
  const candidate = product('A');
  const pending = buildLot(run({ intake:{ quarantined:1, certification_blocked:0 } }), [candidate], [], 1);
  expect(pending.business_status).toBe(BUSINESS_STATUS.ACTION_REQUIRED);
  expect(pending.closure.eligible).toBe(false);
  expect(pending.decisions.exceptions).toBe(1);
  expect(pending.decisions.commercial).toBe(1);
});

test('un produit Catalogue à finaliser remonte comme action et non comme détail de raffinerie', () => {
  const candidate = product('A', {
    lifecycle_status:'candidate',
    is_active:false,
    progress:{ stage:'preparing', reason:'Préparer la fiche française' },
  });
  const lot = buildLot(run(), [candidate], [], 1);
  expect(lot.decisions.catalogue).toBe(1);
  expect(lot.products[0]).toMatchObject({ action:'CATALOGUE', reason:'Préparer la fiche française' });
  expect(lot.business_status).toBe(BUSINESS_STATUS.ACTION_REQUIRED);
});


test('ancien run FAILED sans donnée métier est archivé et ne devient pas une fausse action', () => {
  const lot = buildLot(run({
    run_ref:'KIR-000001',
    status:'FAILED',
    source_total:0,
    intake:{ quarantined:0, certification_blocked:0 },
  }), [], [], 1);
  expect(lot.business_status).toBe(BUSINESS_STATUS.ARCHIVED);
  expect(lot.decisions).toMatchObject({ catalogue:0, commercial:0, exceptions:0 });
  expect(lot.closure.remaining_products).toBe(0);
});

test('run FAILED avec empreinte métier reste réellement à débloquer', () => {
  const lot = buildLot(run({ status:'FAILED', source_total:1 }), [product('A')], [], 1);
  expect(lot.business_status).toBe(BUSINESS_STATUS.BLOCKED);
});
