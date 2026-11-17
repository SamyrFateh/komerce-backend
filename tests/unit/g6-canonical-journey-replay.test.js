/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const {
  business,canonicalScenario,resolveCanonicalReplay,resolveRelayCashRefs
}=require('../../scripts/recette/g6-canonical-journey-binding');
const {
  validateGuard,validateBuyerProof,validateCashProof
}=require('../../scripts/recette/g6-canonical-replay');

const sha='a'.repeat(40);
const env={
  G6_CANONICAL_SCENARIO:'M01',G6_TARGET_MARKET:'KM',
  GITHUB_EVENT_NAME:'issues',GITHUB_ACTOR:'SamyrFateh',GITHUB_REPOSITORY_OWNER:'SamyrFateh',
  GITHUB_REPOSITORY:'SamyrFateh/komerce-backend',
  NODE_ENV:'test',KOMERCE_ENV:'staging',KOMERCE_TARGET_ENV:'staging',
  EXPECTED_RAILWAY_ENVIRONMENT:'staging',
  STAGING_BASE_URL:'https://komerce-backend-production.up.railway.app',
  E2E_EXPECTED_DEPLOY_SHA:sha,
  DATABASE_URL:'postgres://test-unconnected',E2E_ADMIN_EMAIL:'test@example.invalid',
  E2E_ADMIN_PASSWORD:'dummy-not-used',G6_CANONICAL_ACCEPT_PARTIAL_REPLAY:'1'
};
const scope={id:'M01',market:'KM',source_version:business.version};
const buyer={
  verdict:'G6_P2_REAL_OTP_CHROMIUM_ORDER_CREATED_NO_EXTERNAL_EFFECTS',
  market:'KM',runtime_sha:sha,db_fingerprint:'staging-fingerprint',
  blocked_requests:[],payment_real:false,supplier_order_real:false,
  order:{id:'550e8400-e29b-41d4-a716-446655440000',reference:'K123456',
    status:'pending',payment_status:'pending',payment_mode:'cash_relais',scope:'G6-BUYER',market:'KM'}
};
const cash={
  verdict:'G6_A_RELAY_UI_ASSIGNMENT_AND_CASH_CHROMIUM_PG_PASS_NOT_PICKUP_GO',
  sha,db_fingerprint:'staging-fingerprint',real_external_payment:false,
  steps:[
    {name:'PRECHECK_TARGET_CASH_ORDERS',references:{KM:'K123456'}},
    {name:'CASH_UI_PAID',market:'KM',reference:'K123456',http:200,
      payment_status:'paid',cash_collection_count:1,cash_control_confirmed_count:1}
  ]
};

describe('G6 canonical journey — same order, original matrix, real staging guard',()=>{
  test('le catalogue de référence reste le seul propriétaire des 46 scénarios',()=>{
    expect(business.scenarios).toHaveLength(46);
    expect(canonicalScenario('M01','KM').id).toBe('M01');
    expect(canonicalScenario('M04','CM').id).toBe('M04');
    expect(canonicalScenario('M05','CG').id).toBe('M05');
    expect(()=>canonicalScenario('M04','KM')).toThrow('G6_MARKET_OUTSIDE_SCENARIO');
    expect(()=>canonicalScenario('M99','KM')).toThrow('G6_SCENARIO_ID_INVALID');
  });
  test('réutilise M01/M04/M05 sans prétendre supporter les autres branches',()=>{
    expect(resolveCanonicalReplay(env)).toMatchObject({id:'M01',market:'KM'});
    expect(resolveCanonicalReplay({...env,G6_CANONICAL_SCENARIO:'M04',G6_TARGET_MARKET:'CM'}).market).toBe('CM');
    expect(()=>resolveCanonicalReplay({...env,G6_CANONICAL_SCENARIO:'M02'})).toThrow();
    expect(()=>resolveCanonicalReplay({...env,G6_CANONICAL_SCENARIO:'M06'})).toThrow();
  });
  test('pas de régression pour les 3 références historiques',()=>{
    expect(resolveRelayCashRefs({})).toEqual({KM:'K18SFYN',CM:'KW34OBY',CG:'KSJWLND'});
  });
  test('la caisse cible une SEULE commande issue du checkout',()=>{
    expect(resolveRelayCashRefs({G6_CANONICAL_SCENARIO:'M01',G6_CANONICAL_MARKET:'KM',
      G6_CANONICAL_ORDER_REFERENCE:'K123456'})).toEqual({KM:'K123456'});
    expect(()=>resolveRelayCashRefs({G6_CANONICAL_SCENARIO:'M01',G6_CANONICAL_MARKET:'KM'}))
      .toThrow('G6_CANONICAL_CASH_BINDING_INCOMPLETE');
    expect(()=>resolveRelayCashRefs({G6_CANONICAL_SCENARIO:'M01',G6_CANONICAL_MARKET:'CM',
      G6_CANONICAL_ORDER_REFERENCE:'K123456'})).toThrow('G6_MARKET_OUTSIDE_SCENARIO');
  });
  test('refuse exécution hors staging propriétaire, sans pin, sans DB',()=>{
    expect(validateGuard(env)).toMatchObject({id:'M01',market:'KM'});
    for(const edit of [{GITHUB_ACTOR:'other'},{KOMERCE_ENV:'production'},
      {STAGING_BASE_URL:'https://komerce.co'},{E2E_EXPECTED_DEPLOY_SHA:'?'},
      {DATABASE_URL:''},{G6_CANONICAL_ACCEPT_PARTIAL_REPLAY:'0'}]){
      expect(()=>validateGuard({...env,...edit})).toThrow('G6_CANONICAL_OWNER_STAGING_GUARD');
    }
  });
  test('une preuve client doit être réelle et sur la même commande pending',()=>{
    expect(validateBuyerProof(buyer,scope,env)).toMatchObject({reference:'K123456',market:'KM'});
    expect(()=>validateBuyerProof({...buyer,market:'CM'},scope,env)).toThrow();
    expect(()=>validateBuyerProof({...buyer,order:{...buyer.order,payment_status:'paid'}},scope,env)).toThrow();
    expect(()=>validateBuyerProof({...buyer,runtime_sha:'b'.repeat(40)},scope,env)).toThrow();
    expect(()=>validateBuyerProof({...buyer,blocked_requests:[{method:'POST'}]},scope,env)).toThrow();
  });
  test('refuse cash sur un autre ordre, une autre DB, ou un état financier incomplet',()=>{
    expect(validateCashProof(cash,buyer,scope,env)).toMatchObject({reference:'K123456',paid:true});
    expect(()=>validateCashProof({...cash,db_fingerprint:'other-db'},buyer,scope,env)).toThrow();
    expect(()=>validateCashProof({...cash,steps:cash.steps.map(s=>s.name==='CASH_UI_PAID'?{...s,reference:'OTHER-REF'}:s)},buyer,scope,env)).toThrow();
    expect(()=>validateCashProof({...cash,steps:cash.steps.map(s=>s.name==='CASH_UI_PAID'?{...s,cash_collection_count:0}:s)},buyer,scope,env)).toThrow();
    expect(()=>validateCashProof({...cash,sha:'b'.repeat(40)},buyer,scope,env)).toThrow();
  });
});
