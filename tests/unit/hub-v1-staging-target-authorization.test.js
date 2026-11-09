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
test('les deux HOLD du préflight refusent tout staging apply avant même le contrôle marché',async()=>{
  const db={getClient:jest.fn()};
  const base={mode:'READ_ONLY',verdict:'HOLD_NO_STAGING_WRITES',checks:checks()};
  const assessImpl=jest.fn(async()=>base);
  const baselineImpl=jest.fn(async()=>({fx_authority:'ECB',delivery_condition:'ACTIVE_RELAIS_AT_CHECKOUT'}));
  await expect(authorizeOfficialStaging({db,run:RUN,env:env(),assessImpl,baselineImpl}))
    .rejects.toThrow('STAGING_PREFLIGHT_HOLD_BLOCKS_ALL_WRITES');
  expect(assessImpl).toHaveBeenCalledTimes(1);
  expect(baselineImpl).not.toHaveBeenCalled();
  expect(db.getClient).not.toHaveBeenCalled();
});
test('seulement dix gates PASS et verdict READY permettent de poursuivre la revue, jamais un faux GO',async()=>{
  const db={getClient:jest.fn()};
  const baselineImpl=jest.fn(async()=>({fx_authority:'ECB',delivery_condition:'ACTIVE_RELAIS_AT_CHECKOUT'}));
  const validChecks=checks().map(c=>({...c,pass:true}));
  const ready={mode:'READ_ONLY',verdict:'READY_FOR_EXPLICIT_APPLY_REVIEW',checks:validChecks};
  expect(await authorizeOfficialStaging({db,run:RUN,env:env(),assessImpl:async()=>ready,baselineImpl}))
    .toMatchObject({mode:'STAGING_OFFICIAL'});
  expect(baselineImpl).toHaveBeenCalledTimes(1);
  await expect(authorizeOfficialStaging({db,run:RUN,env:env(),assessImpl:async()=>({...ready,
    checks:validChecks.map(c=>c.id==='MIGRATIONS_391_396'?{...c,pass:false}:c)}),baselineImpl}))
    .rejects.toThrow('STAGING_PREFLIGHT_UNEXPECTED_FAILURE');
  await expect(authorizeOfficialStaging({db,run:RUN,env:env(),assessImpl:async()=>({...ready,
    checks:validChecks.map(c=>c.id==='STAGING_E2E_CROSS_SERVICE_RUNNER_REVIEWED'?{...c,id:'UNKNOWN_GATE'}:c)}),baselineImpl}))
    .rejects.toThrow('STAGING_PREFLIGHT_UNEXPECTED_FAILURE');
  expect(baselineImpl).toHaveBeenCalledTimes(1);
});
test('un verdict HOLD ne devient pas READY même si les flags mensongers sont true',async()=>{
  const db={getClient:jest.fn()};
  const baselineImpl=jest.fn();
  await expect(authorizeOfficialStaging({db,run:RUN,env:env(),assessImpl:async()=>({
    mode:'READ_ONLY',verdict:'HOLD_NO_STAGING_WRITES',checks:checks().map(c=>({...c,pass:true}))
  }),baselineImpl})).rejects.toThrow('STAGING_PREFLIGHT_HOLD_BLOCKS_ALL_WRITES');
  expect(baselineImpl).not.toHaveBeenCalled();
});
test('préflight staging : FX officiel + marché actif, relais vérifié au checkout',async()=>{
  const stm=[];const client={
    query:async(sql)=>{stm.push(sql);return {rows:sql.startsWith('SELECT id FROM markets')?[{id:'market-id'}]:[]};},
    release:()=>stm.push('RELEASE')
  };
  const db={getClient:async()=>client};
  const resolveFx=jest.fn(async()=>({id:'official-quote-id',source_label:'ECB official EUR/USD'}));
  expect(await checkSharedBaselines(db,{resolveFx})).toMatchObject({
    fx_authority:'ECB official EUR/USD',delivery_condition:'ACTIVE_RELAIS_AT_CHECKOUT'});
  expect(resolveFx).toHaveBeenCalledWith({client});
  expect(stm[0]).toBe('BEGIN READ ONLY');
  expect(stm).toContain('ROLLBACK');
  expect(stm).toContain('RELEASE');
  await expect(checkSharedBaselines(db,{resolveFx:async()=>({id:null})}))
    .rejects.toThrow('STAGING_FX_AUTHORITY_NOT_PROVEN');
});

test('workflow staging refuse toute écriture avant les 13 étapes si préflight HOLD',()=>{
  const fs=require('fs'),path=require('path');
  const yaml=fs.readFileSync(path.join(__dirname,'../../.github/workflows/hub-v1-official-staging-final.yml'),'utf8');
  const preflight=yaml.indexOf('run: node scripts/recette/hub-v1-staging-transactional-preflight.js');
  const dry=yaml.indexOf('First pass — strict fingerprint');
  const apply=yaml.indexOf('Official staging — execute real 13 steps');
  expect(yaml).toContain('fetch-depth: 0');
  expect(yaml).toContain('node scripts/recette/resolve-staging-deploy-pin.js');
  expect(preflight).toBeGreaterThan(0);
  expect(dry).toBeGreaterThan(preflight);
  expect(apply).toBeGreaterThan(dry);
  expect(yaml).not.toContain('E2E_EXPECTED_DEPLOY_SHA=$(git rev-parse HEAD)');
});
