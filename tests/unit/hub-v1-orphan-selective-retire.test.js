'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {assertExecution,digest,assertOwnership,assertNoLinks,scanFreeform,
  assertUnrelatedUntouched}=require('../../scripts/recette/hub-v1-orphan-selective-retire');
const host='https://komerce-backend-production.up.railway.app';
const hash='439fb559dca1400209ac71ed7c4251e297c6c37c21fb0787dd44fd32b0aaf1b0';
const env={
  KOMERCE_ENV:'staging',KOMERCE_TARGET_ENV:'staging',NODE_ENV:'test',
  EXPECTED_RAILWAY_ENVIRONMENT:'staging',STAGING_BASE_URL:host,
  E2E_EXPECTED_DEPLOY_SHA:'f'.repeat(40),
  HUB_V1_ORPHAN_EXPECTED_MANIFEST:hash,
};
test('dry-run autorisé avec staging confirmé, mauvais environnement ou SHA refusé',()=>{
  expect(()=>assertExecution('dry-run',env)).not.toThrow();
  expect(()=>assertExecution('execute',env)).toThrow('HUB_V1_RETIRE_OWNER_CONFIRMATION_REQUIRED');
  expect(()=>assertExecution('bad',env)).toThrow('HUB_V1_RETIRE_MODE_INVALID');
  expect(()=>assertExecution('dry-run',{...env,KOMERCE_ENV:'production'})).toThrow();
  expect(()=>assertExecution('dry-run',{...env,E2E_EXPECTED_DEPLOY_SHA:''})).toThrow();
  expect(()=>assertExecution('dry-run',{...env,HUB_V1_ORPHAN_EXPECTED_MANIFEST:''}))
    .toThrow('HUB_V1_RETIRE_MANIFEST_PIN_REQUIRED');
});
test('execute ne marche que depuis issue exacte du propriétaire, sans délégation',()=>{
  const own={...env,HUB_V1_ORPHAN_CLEANUP_ACK:'RETIRE-EXACT-51-ORPHANED-E2E',
    GITHUB_EVENT_NAME:'issues',GITHUB_REPOSITORY:'SamyrFateh/komerce-backend',
    GITHUB_ACTOR:'SamyrFateh',GITHUB_REPOSITORY_OWNER:'SamyrFateh',
    GITHUB_ISSUE_TITLE:'[staging-op] hub-v1-orphan-selective-retire-51'};
  expect(()=>assertExecution('execute',own)).not.toThrow();
  for(const wrong of [
    {GITHUB_ISSUE_TITLE:'[staging-op] hub-v1-orphan-selective-retire-52'},
    {GITHUB_ACTOR:'other'}, {GITHUB_REPOSITORY:'other/repo'},
    {GITHUB_EVENT_NAME:'workflow_dispatch'},
    {HUB_V1_ORPHAN_CLEANUP_ACK:'WRONG'},
  ])expect(()=>assertExecution('execute',{...own,...wrong})).toThrow();
});
test('le manifest est épinglé et aucune fixture étrangère ne peut entrer',()=>{
  const owned={counts:[],supplierIds:[],sourceIds:[]};
  expect(digest(owned)).toMatch(/^[0-9a-f]{64}$/);
  expect(()=>assertOwnership(owned)).toThrow('HUB_V1_RETIRE_OWNERSHIP_OR_MANIFEST_CHANGED');
});
test('la moindre FK, trigger, opacité ou régression de couverture arrête le retrait',()=>{
  const good={refs:[],opaque:[],trigger_tables:[],fk_edges_checked:11,columns_scanned:151};
  expect(()=>assertNoLinks(good)).not.toThrow();
  for(const override of [
    {refs:[{table:'purchase_lines'}]},{opaque:[{table:'x'}]},
    {trigger_tables:['suppliers']},{fk_edges_checked:10},{columns_scanned:150},
  ]) expect(()=>assertNoLinks({...good,...override})).toThrow();
});
test('tout changement des commandes, produits, utilisateurs et relais arrête la transaction',()=>{
  const before={orders:10,products:4,users:12,relais:5};
  expect(()=>assertUnrelatedUntouched(before,{...before})).not.toThrow();
  for(const key of Object.keys(before))
    expect(()=>assertUnrelatedUntouched(before,{...before,[key]:before[key]+1})).toThrow();
});
test('texte libre et JSON non FK entraînent un HOLD si une identité E2E est contenue',async()=>{
  const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const ids=Array.from({length:34},(_,i)=>id(i+1));
  const owned={supplierIds:ids,sourceIds:['api:whatsapp:E2E-HUB-V1-71B671EB']};
  async function verify(withMatch){
    const q={query:jest.fn(async(sql)=>{
      if(sql.includes('FROM public.suppliers WHERE'))return{rows:ids.map((id,i)=>({
        id,name:'E2E-HUB-V1-71B671EB-SUP-'+String(i).padStart(2,'0')}))};
      if(sql.includes('FROM information_schema.columns c'))return{rows:[
        {table_name:'order_status_history',column_name:'metadata',udt_name:'jsonb'},
      ]};
      if(sql.includes('FROM public."order_status_history"'))return{rows:withMatch?[{one:1}]:[]};
      throw Error('UNEXPECTED:'+sql);
    })};
    return{data:await scanFreeform(q,owned),queries:q.query.mock.calls.map(x=>x[0])};
  }
  const clean=await verify(false);
  expect(clean.data).toEqual({scanned:1,hits:[]});
  const linked=await verify(true);
  expect(linked.data.hits).toEqual([{table:'order_status_history',column:'metadata'}]);
  expect(linked.queries.every(x=>/^SELECT\b/.test(x))).toBe(true);
});
