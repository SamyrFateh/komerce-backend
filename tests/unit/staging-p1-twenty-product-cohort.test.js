/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @purpose Contract proof for P1 twenty actual source products and exact public visibility.
 */
'use strict';
const {classifyEvidence,reduceReadiness,readBuyerProducts,checkTarget,EXPECTED_COUNT}=
  require('../../scripts/recette/p1-20-cohort-inventory');
const {allowedRequest,ORIGIN}=
  require('../staging-p1-20/write-policy');

function row(n,{certified=true,visible=true,linked=true,priced=true}={}){
  return classifyEvidence({
    candidate_id:'candidate-'+n,
    supplier_product_id:'supplier-'+n,
    candidate_ref:'KSC-'+String(n).padStart(6,'0'),
    sourcing:{sourcing_certified:certified,outcome_valid:true},
    global:{product_id:linked?'product-'+n:null,
      product_ref:linked?'KPR-'+String(n).padStart(6,'0'):null,
      is_active:visible,is_available:visible,lifecycle_status:'active'},
    market:{code:'KM',commercial_exposure:visible?'ENABLED':'DISABLED',
      price_status:priced?'LOCAL_ACTIVE':'LOCAL_MARKET_DECISION'},
    buyer:{listed:visible}
  });
}
test('20 exactly and only 20 DISTINCT fully proven public products may be GO',()=>{
  const success=Array.from({length:20},(_,i)=>row(i+1));
  expect(EXPECTED_COUNT).toBe(20);
  expect(reduceReadiness(success)).toMatchObject({
    source_total:20,source_distinct:20,
    sourcing_certified:20,global_linked:20,
    market_exposed:20,local_price_active:20,buyer_listed:20,
    fully_proved_sellable:20,verdict:'GO_20_CANONICAL_PUBLIC_PRODUCTS'
  });
  expect(reduceReadiness(success.slice(0,19)).verdict)
    .toBe('NOT_YET_20_CANONICAL_PUBLIC_PRODUCTS');
});
test('a WATCH product can never become saleable by the e2e ledger',()=>{
  const items=Array.from({length:20},(_,i)=>row(i+1));
  items[2]=row(3,{certified:false});
  const result=reduceReadiness(items);
  expect(result.verdict).toBe('NOT_YET_20_CANONICAL_PUBLIC_PRODUCTS');
  expect(items[2].gate.blockers).toContain('SOURCING_NOT_CERTIFIED');
  expect(result.fully_proved_sellable).toBe(19);
});
test('source batch twenty does not equal twenty buyer items',()=>{
  const items=Array.from({length:20},(_,i)=>
    row(i+1,i<9?{visible:false}:{linked:false,visible:false,priced:false}));
  const result=reduceReadiness(items);
  expect(result.source_total).toBe(20);
  expect(result.fully_proved_sellable).toBe(0);
  expect(result.verdict).toBe('NOT_YET_20_CANONICAL_PUBLIC_PRODUCTS');
});
test('one duplicate supplier identity cannot pass twenty unique products',()=>{
  const items=Array.from({length:20},(_,i)=>row(i+1));
  items[19].supplier_product_id=items[0].supplier_product_id;
  expect(reduceReadiness(items).source_distinct).toBe(19);
  expect(reduceReadiness(items).verdict).toBe('NOT_YET_20_CANONICAL_PUBLIC_PRODUCTS');
});
test('a local price not active, hidden exposure or draft remains blocked',()=>{
  const items=[
    row(1,{priced:false}),
    row(2,{visible:false}),
    row(3,{linked:false})
  ];
  expect(items[0].gate.blockers).toContain('LOCAL_PRICE_NOT_ACTIVE');
  expect(items[1].gate.blockers).toContain('MARKET_EXPOSURE_NOT_ENABLED');
  expect(items[2].gate.blockers).toContain('NOT_HANDED_TO_CATALOG');
});
test('staging target fingerprint cannot be replaced by another deployment',()=>{
  expect(()=>checkTarget({KOMERCE_ENV:'staging',NODE_ENV:'test',
    STAGING_BASE_URL:ORIGIN,E2E_STAGING_BASE_URL:ORIGIN})).not.toThrow();
  expect(()=>checkTarget({KOMERCE_ENV:'production',NODE_ENV:'production',
    STAGING_BASE_URL:ORIGIN,E2E_STAGING_BASE_URL:ORIGIN})).toThrow('P1_20_STAGING_TARGET_REQUIRED');
  expect(()=>checkTarget({KOMERCE_ENV:'staging',NODE_ENV:'test',
    STAGING_BASE_URL:'https://komerce.co',E2E_STAGING_BASE_URL:ORIGIN}))
    .toThrow('P1_20_STAGING_TARGET_REQUIRED');
});
test('public buyer API receives real product list, not an invented pass',async()=>{
  const fetcher=jest.fn(async()=>({status:200,json:async()=>({
    products:[{id:'id-a',product_ref:'KPR-000084'}],total:1
  })}));
  const result=await readBuyerProducts(fetcher);
  expect(result.status).toBe('BUYER_API_200');
  expect(result.ids.has('id-a')).toBe(true);
  expect(result.total).toBe(1);
  expect(fetcher.mock.calls[0][0]).toBe(ORIGIN+'/api/products?market=KM&limit=1000');
});
test('human P1 curation is scoped to source, catalogue or exact KM pricing only',()=>{
  const p=(url,method,area,humanApproved=true)=>
    allowedRequest({url:ORIGIN+url,method,area,humanApproved});
  expect(p('/api/admin/workspaces/sourcing/candidates/KSC-000009/promote','POST','sourcing').allowed).toBe(true);
  expect(p('/api/admin/workspaces/catalog/approval/KPR-000084/approve','POST','catalog').allowed).toBe(true);
  expect(p('/api/admin/workspaces/pricing/market/KM/products/KPR-000084/local-price/activate','POST','pricing').allowed).toBe(true);
  expect(p('/api/admin/workspaces/sourcing/candidates/KSC-000009/promote','POST','sourcing',false).allowed).toBe(false);
  expect(p('/api/admin/workspaces/pricing/market/CM/products/KPR-000084/local-price/activate','POST','pricing').allowed).toBe(false);
  expect(p('/api/admin/workspaces/pricing/market/KM/products/KPR-000084/local-price/activate','POST','sourcing').allowed).toBe(false);
  expect(p('/api/orders','POST','sourcing').allowed).toBe(false);
  expect(p('/api/checkout','POST','buyer').allowed).toBe(false);
  expect(p('/api/auth/admin-reset','POST','catalog').allowed).toBe(false);
  expect(allowedRequest({url:'https://evil.example/api/checkout',method:'POST',area:'catalog',humanApproved:true}).allowed).toBe(false);
});
