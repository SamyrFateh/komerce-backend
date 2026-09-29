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
  expect(lot.closure).toEqual({
    eligible:true,
    decided_products:2,
    total_products:2,
    awaiting_catalogue_promotion:0,
    remaining_products:0,
  });
  expect(lot.decisions).toMatchObject({ approved_for_sale:1, not_retained:1, catalogue:0, commercial:0, exceptions:0 });
});

test('un RUNNING déjà comptabilisé est immédiatement re-projeté comme import terminé', () => {
  const lot = buildLot(run({
    status:'RUNNING',
    source_total:20,
    intake:{
      recorded_at:'2026-09-29T19:00:00Z',
      ready_for_refinery:12,
      duplicates:0,
      rejected:1,
      deferred:7,
      quarantined:0,
      certification_blocked:0,
    },
  }), [], [], 1);
  expect(lot.technical_status).toBe('COMPLETED');
  expect(lot.business_status).toBe(BUSINESS_STATUS.ACTION_REQUIRED);
  expect(lot.closure).toMatchObject({
    eligible:false,
    awaiting_catalogue_promotion:12,
    remaining_products:12,
  });
});

test('import terminé reste action requise tant que des certifiés attendent la promotion Catalogue', () => {
  const lot = buildLot(run({
    source_total:20,
    intake:{
      ready_for_refinery:12,
      quarantined:0,
      certification_blocked:0,
    },
  }), [], [], 1);
  expect(lot.business_status).toBe(BUSINESS_STATUS.ACTION_REQUIRED);
  expect(lot.closure).toMatchObject({
    eligible:false,
    awaiting_catalogue_promotion:12,
    remaining_products:12,
  });
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



test('un passage fournisseur vide reste visible comme Sans résultat', () => {
  const lot = buildLot(run({
    run_ref:'KIR-000005',
    status:'FAILED',
    source_total:0,
    failure_reason:'supplier_source_empty',
    intake:{ quarantined:0, certification_blocked:0 },
  }), [], [], 1);
  expect(lot.business_status).toBe(BUSINESS_STATUS.NO_RESULT);
  expect(lot.failure_reason).toBe('supplier_source_empty');
  expect(lot.closure.remaining_products).toBe(0);
});

test('les anciens no_valid_product sans empreinte restent aussi visibles', () => {
  const lot = buildLot(run({
    run_ref:'KIR-000006',
    status:'FAILED',
    source_total:0,
    failure_reason:'no_valid_product',
    intake:{ quarantined:0, certification_blocked:0 },
  }), [], [], 1);
  expect(lot.business_status).toBe(BUSINESS_STATUS.NO_RESULT);
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

test('ancien pipeline_partial_blocked reste une action de lot et non un blocage métier', () => {
  const lot = buildLot(run({
    run_ref:'KIR-000008',
    status:'FAILED',
    source_total:20,
    failure_reason:'pipeline_partial_blocked',
    intake:{
      accepted:19,
      rejected:1,
      deferred:7,
      ready_for_refinery:12,
      quarantined:0,
      certification_blocked:0,
    },
  }), [], [], 1);
  expect(lot.business_status).toBe(BUSINESS_STATUS.ACTION_REQUIRED);
  expect(lot.technical_status).toBe('RUNNING');
  expect(lot.failure_reason).toBeNull();
  expect(lot.provider_runtime_blocked).toBe(true);
});

test('un échec connecteur sans produit reste visible comme bloqué', () => {
  const lot = buildLot(run({
    run_ref:'KIR-000007',
    status:'FAILED',
    source_total:0,
    failure_reason:'connector_failed: [AliExpress] Api access frequency exceeds the limit',
    intake:{ quarantined:0, certification_blocked:0 },
  }), [], [], 1);
  expect(lot.business_status).toBe(BUSINESS_STATUS.BLOCKED);
  expect(lot.failure_reason).toMatch(/frequency exceeds/);
});

test('run FAILED avec empreinte métier reste réellement à débloquer', () => {
  const lot = buildLot(run({ status:'FAILED', source_total:1 }), [product('A')], [], 1);
  expect(lot.business_status).toBe(BUSINESS_STATUS.BLOCKED);
});
