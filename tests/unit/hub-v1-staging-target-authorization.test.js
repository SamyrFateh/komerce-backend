'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { assertApproval,authorizeOfficialStaging,checkSharedBaselines }=require('../../scripts/recette/hub-v1-staging-target-authorization');
const RUN='A1B2C3D4';
const env=()=>{
  return {
    HUB_V1_CERTIFICATION_RUN: RUN,
    KOMERCE_ENV:'staging', KOMERCE_TARGET_ENV:'staging',
    NODE_ENV:'test',HUB_V1_E2E_APPLY_MODE:'approved',
    KOMERCE_DISABLE_CRONS:'true',
    EXPECTED_RAILWAY_ENVIRONMENT:'staging',
    STAGING_BASE_URL:'https://komerce-backend-production.up.railway.app',
    E2E_EXPECTED_DEPLOY_SHA:'a'.repeat(40),
    DATABASE_URL:'postgres://u:password@railway.example:5432/railway',
  };
};
const checks=()=>[
  ...['MIGRATIONS_391_396','NEW_FIXTURE_REFERENCE_PREFIX_UNUSED','NO_DUPLICATE_SUPPLIER_PRIORITY',
  'HUB_AND_RELAY_ROLES_EXIST','DEDICATED_ATOMIC_CHECKOUT_SCOPE','SIMULATED_CHECKOUT_HAS_NO_EXTERNAL_HOOKS',
  'SIMULATED_PO_NO_PROVIDER_OR_NOTIFICATION','SIMULATED_CUSTOMER_PAYMENT_PROVIDER_BYPASS_VERIFIED']
    .map((id)=>({id,pass:true})),
  {id:'STAGING_FIXTURE_OWNERSHIP_AND_CLEANUP_CERTIFIED',pass:false},
  {id:'STAGING_E2E_CROSS_SERVICE_RUNNER_REVIEWED',pass:false}
];
test('refuse tout autre environnement, URL, SHA ou RUN8 avant connexion',()=>{
  assertApproval({run:RUN,env:env()});
  for (const [k,bad] of Object.entries({KOMERCE_ENV:'production',STAGING_BASE_URL:'https://example.com',
    HUB_V1_E2E_APPLY_MODE:'test',EXPECTED_RAILWAY_ENVIRONMENT:'production',
    E2E_EXPECTED_DEPLOY_SHA:'short',KOMERCE_DISABLE_CRONS:'false',HUB_V1_CERTIFICATION_RUN:'DIFFERENT'})) {
    expect(()=>assertApproval({run:RUN,env:{...env(),[k]:bad}})).toThrow();
  }
});
test('deux HOLD historiques acceptés seulement par le protocole explicite; toute autre anomalie bloque',async()=>{
  const db={getClient:jest.fn()};
  const base={mode:'READ_ONLY',verdict:'HOLD_NO_STAGING_WRITES',checks:checks()};
  const assessImpl=jest.fn(async()=>base);
  const baselineImpl=jest.fn(async()=>({approved_fx:true,delivery_attested:true}));
  expect(await authorizeOfficialStaging({db,run:RUN,env:env(),assessImpl,baselineImpl})).toMatchObject({mode:'STAGING_OFFICIAL'});
  expect(assessImpl).toHaveBeenCalledTimes(1);
  expect(baselineImpl).toHaveBeenCalledTimes(1);
  await expect(authorizeOfficialStaging({db,run:RUN,env:env(),assessImpl:async()=>({...base,
    checks:checks().map(c=>c.id==='MIGRATIONS_391_396'?{...c,pass:false}:c)}),baselineImpl})).rejects.toThrow('STAGING_PREFLIGHT_UNEXPECTED_FAILURE');
  expect(db.getClient).not.toHaveBeenCalled();
});
test('référentiels FX et livraison : autorité canonique, transaction READ ONLY, aucune valeur inventée',async()=>{
  const stm=[];const client={
    query:async(sql)=>{stm.push(sql);return {rows:sql.startsWith('SELECT id FROM markets')?[{id:'market-id'}]:[]};},
    release:()=>stm.push('RELEASE')
  };
  const db={getClient:async()=>client};
  const resolveFx=jest.fn(async()=>({id:'official-quote-id',source_label:'ECB official EUR/USD'}));
  const deliveryProof=jest.fn(async()=>({proven:true,basis:'HISTORY'}));
  expect(await checkSharedBaselines(db,{resolveFx,deliveryProof})).toMatchObject({
    fx_authority:'ECB official EUR/USD',delivery_basis:'HISTORY'});
  expect(resolveFx).toHaveBeenCalledWith({client});
  expect(deliveryProof).toHaveBeenCalledWith(client,'market-id');
  expect(stm[0]).toBe('BEGIN READ ONLY');
  expect(stm).toContain('ROLLBACK');
  expect(stm).toContain('RELEASE');
  await expect(checkSharedBaselines(db,{resolveFx,deliveryProof:async()=>({proven:false})}))
    .rejects.toThrow('STAGING_CANONICAL_BASELINE_NOT_PROVEN');
});
