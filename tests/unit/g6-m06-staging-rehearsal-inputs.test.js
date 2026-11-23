/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {MODE,TITLE,INPUT_KEYS,buildM06RehearsalInputs,
 assertRehearsalInputs,emitRehearsalInputs}=require('../../scripts/recette/canonical/m06-staging-rehearsal-inputs');
const {captureFromEnv}=require('../../scripts/recette/canonical/m06-manual-purchase-capture');
const {validateM06OperatorInputs}=require('../../scripts/recette/g6-m06-input-preflight');
const RUN='45127123456';
const event={action:'opened',issue:{title:TITLE,user:{login:'SamyrFateh'}}};
const owner={
 GITHUB_REPOSITORY:'SamyrFateh/komerce-backend',GITHUB_REPOSITORY_OWNER:'SamyrFateh',
 GITHUB_ACTOR:'SamyrFateh',GITHUB_EVENT_NAME:'issues',
 GITHUB_RUN_ID:RUN,KOMERCE_ENV:'staging',KOMERCE_TARGET_ENV:'staging',
 EXPECTED_RAILWAY_ENVIRONMENT:'staging',NODE_ENV:'test',
 G6_CANONICAL_SCENARIO:'M06',G6_TARGET_MARKET:'KM'
};
describe('owner-only M06 staging rehearsal facts, never real supplier evidence',()=>{
 test('generates all seven synthetic references and exactly two non-real sellers, three units / 30 EUR',()=>{
  const built=buildM06RehearsalInputs(RUN);
  expect(built.G6_M06_INPUT_MODE).toBe(MODE);
  for(const key of INPUT_KEYS)expect(built[key]).toBeTruthy();
  const p=JSON.parse(built.G6_M06_ACTUAL_PURCHASE_CAPTURE);
  expect(p.evidence_origin).toBe('STAGING_REHEARSAL_SIMULATED_NOT_REAL');
  expect(p.allocations).toHaveLength(2);
  expect(new Set(p.allocations.map(x=>x.seller_label)).size).toBe(2);
  expect(p.allocations.reduce((n,x)=>n+x.quantity,0)).toBe(3);
  expect(p.allocations.reduce((n,x)=>n+x.amount,0)).toBe(30);
  for(const allocation of p.allocations){
   expect(allocation.seller_label).toContain('NOT_REAL');
   expect(allocation.proof_ref).toContain('NO_REAL_RECEIPT');
   expect(allocation.channel).toBe('other');
  }
  for(const key of ['G6_M06_RECEIPT_PROOF_REF','G6_M06_COMBOX_PROOF_REF','G6_M06_HANDOVER_PROOF_REF'])
   expect(built[key]).toContain('NO_');
 });
 test('passes preflight and classifies any receipt as simulated only, not as an operator attestation',()=>{
  const env={...owner,...buildM06RehearsalInputs(RUN)};
  expect(assertRehearsalInputs(env,event)).toMatchObject({simulation_only:true,real_purchase:false});
  // The parser can validate a rehearsal through the strict owner event on disk.
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'g6-m06-test-'));
  try{
   const ev=path.join(dir,'event.json');fs.writeFileSync(ev,JSON.stringify(event));
   env.GITHUB_EVENT_PATH=ev;
   expect(captureFromEnv(env)).toMatchObject({confirmed_quantity:3,justified_total:30,
    source:'STAGING_REHEARSAL_SIMULATED_ONLY',simulation_only:true});
   const v=validateM06OperatorInputs(env);
   expect(v).toMatchObject({valid:true,allocation_count:2,values_redacted:true,
    simulation_only:true,evidence_class:'STAGING_REHEARSAL_SIMULATED_ONLY'});
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 });
 test('rejects context spoofing, production and a non-owner issue',()=>{
  const values=buildM06RehearsalInputs(RUN);
  for(const delta of [{GITHUB_ACTOR:'someone-else'},{KOMERCE_TARGET_ENV:'production'},
   {GITHUB_EVENT_NAME:'workflow_dispatch'},{G6_TARGET_MARKET:'CG'}]){
   expect(()=>assertRehearsalInputs({...owner,...values,...delta},event))
    .toThrow('G6_M06_REHEARSAL_OWNER_STAGING_GUARD');
  }
  expect(()=>assertRehearsalInputs({...owner,...values},
   {action:'opened',issue:{title:'[staging-op] g6-m06-certify-KM',user:{login:'SamyrFateh'}}}))
   .toThrow('G6_M06_REHEARSAL_OWNER_STAGING_GUARD');
 });
 test('rejects manipulated seller evidence and forbids synthetic proof as real operator capture',()=>{
  const env={...owner,...buildM06RehearsalInputs(RUN)};
  const p=JSON.parse(env.G6_M06_ACTUAL_PURCHASE_CAPTURE);
  p.allocations[0].seller_label='an-actual-merchant';
  env.G6_M06_ACTUAL_PURCHASE_CAPTURE=JSON.stringify(p);
  expect(()=>assertRehearsalInputs(env,event))
   .toThrow('G6_M06_REHEARSAL_FACTS_DRIFT_G6_M06_ACTUAL_PURCHASE_CAPTURE');
  const valid=buildM06RehearsalInputs(RUN);
  expect(()=>captureFromEnv({G6_M06_ACTUAL_PURCHASE_CAPTURE:valid.G6_M06_ACTUAL_PURCHASE_CAPTURE}))
   .toThrow('G6_M06_SYNTHETIC_PROVENANCE_MODE_MISMATCH');
 });
 test('writes ephemeral environment values without logging them and refuses to overwrite operator facts',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'g6-m06-env-'));
  try{
   const envFile=path.join(dir,'env');
   const result=emitRehearsalInputs({...owner,GITHUB_ENV:envFile},event);
   expect(result).toMatchObject({simulation_only:true,variables:8,values_redacted:true});
   expect(JSON.stringify(result)).not.toContain('SELLER_A');
   const written=fs.readFileSync(envFile,'utf8');
   for(const key of INPUT_KEYS)expect(written).toContain(key+'<<');
   expect(written).toContain('STAGING_REHEARSAL_SIMULATED_NOT_REAL');
   expect(()=>emitRehearsalInputs({...owner,GITHUB_ENV:envFile,
    G6_M06_ACTUAL_PURCHASE_CAPTURE:'REAL_OPERATOR_CAPTURE'},event))
    .toThrow('G6_M06_REHEARSAL_OPERATOR_INPUT_CONFLICT');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 });
});
