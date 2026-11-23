/** @komerce-arch-lite
 * @role g6-m06-staging-rehearsal-fixture
 * @domain purchasing
 * @layer test
 * @owner backend-core
 * @purpose Generate traceable synthetic-only values for the separate M06 staging rehearsal, never real supplier evidence.
 * @impact-areas staging-only
 * @db-read none
 * @db-write none
 */
'use strict';
const fs=require('node:fs');
const crypto=require('node:crypto');
const RUN=/^[0-9]{8,20}$/;
const TITLE='[staging-op] g6-m06-rehearsal-KM';
const MODE='STAGING_REHEARSAL';
const INPUT_KEYS=Object.freeze([
 'G6_M06_ACTUAL_PURCHASE_CAPTURE','G6_M06_PAYMENT_AUTHORIZATION_PROOF',
 'G6_M06_RECEIPT_PROOF_REF','G6_M06_COMBOX_PROOF_REF',
 'G6_M06_FORWARDER_NAME','G6_M06_TRANSPORT_MODE','G6_M06_HANDOVER_PROOF_REF'
]);
const fail=code=>{throw Error(code)};
const marker=runId=>'SIMULATED-STAGING-M06-RUN-'+runId;

function buildM06RehearsalInputs(runId){
 const run=String(runId||'');
 if(!RUN.test(run))fail('G6_M06_REHEARSAL_RUN_ID_INVALID');
 const prefix=marker(run);
 const payload={
  evidence_origin:'STAGING_REHEARSAL_SIMULATED_NOT_REAL',
  purchase_proof_ref:prefix+'-PURCHASE-NO_REAL_RECEIPT',
  allocations:[
   {seller_label:prefix+'-SELLER_A_NOT_REAL',channel:'other',quantity:1,amount:10,
    currency:'EUR',proof_ref:prefix+'-ALLOCATION_A_NO_REAL_RECEIPT'},
   {seller_label:prefix+'-SELLER_B_NOT_REAL',channel:'other',quantity:2,amount:20,
    currency:'EUR',proof_ref:prefix+'-ALLOCATION_B_NO_REAL_RECEIPT'}
  ]
 };
 return Object.freeze({
  G6_M06_INPUT_MODE:MODE,
  G6_M06_ACTUAL_PURCHASE_CAPTURE:JSON.stringify(payload),
  G6_M06_PAYMENT_AUTHORIZATION_PROOF:prefix+'-PAYMENT_AUTH_ONLY_NO_DEBIT',
  G6_M06_RECEIPT_PROOF_REF:prefix+'-RECEIPT_NO_PHYSICAL_EVENT',
  G6_M06_COMBOX_PROOF_REF:prefix+'-COMBOX_NO_PHYSICAL_EVENT',
  G6_M06_FORWARDER_NAME:'SIMULATED-STAGING-NO_REAL_FORWARDER',
  G6_M06_TRANSPORT_MODE:'sea',
  G6_M06_HANDOVER_PROOF_REF:prefix+'-HANDOVER_NO_REAL_FORWARDER'
 });
}
function readIssueEvent(env){
 const eventPath=String(env.GITHUB_EVENT_PATH||'');
 if(!eventPath)fail('G6_M06_REHEARSAL_ISSUE_EVENT_MISSING');
 try{return JSON.parse(fs.readFileSync(eventPath,'utf8'))}
 catch(_){fail('G6_M06_REHEARSAL_ISSUE_EVENT_INVALID')}
}
function assertRehearsalContext(env=process.env,event=readIssueEvent(env)){
 if(env.GITHUB_REPOSITORY!=='SamyrFateh/komerce-backend'||
    !env.GITHUB_REPOSITORY_OWNER||env.GITHUB_ACTOR!==env.GITHUB_REPOSITORY_OWNER||
    env.GITHUB_EVENT_NAME!=='issues'||env.KOMERCE_ENV!=='staging'||
    env.KOMERCE_TARGET_ENV!=='staging'||env.NODE_ENV!=='test'||
    env.G6_CANONICAL_SCENARIO!=='M06'||env.G6_TARGET_MARKET!=='KM'||
    env.EXPECTED_RAILWAY_ENVIRONMENT!=='staging'||!RUN.test(String(env.GITHUB_RUN_ID||''))||
    event?.action!=='opened'||event.issue?.title!==TITLE||
    event.issue?.user?.login!==env.GITHUB_REPOSITORY_OWNER)
  fail('G6_M06_REHEARSAL_OWNER_STAGING_GUARD');
 return true;
}
function assertRehearsalInputs(env=process.env,event){
 assertRehearsalContext(env,event===undefined?readIssueEvent(env):event);
 const generated=buildM06RehearsalInputs(env.GITHUB_RUN_ID);
 for(const [key,value] of Object.entries(generated)){
  if(env[key]!==value)fail('G6_M06_REHEARSAL_FACTS_DRIFT_'+key);
 }
 return Object.freeze({mode:MODE,run_id:String(env.GITHUB_RUN_ID),
  simulation_only:true,real_seller_evidence:false,real_purchase:false,real_physical_handover:false});
}
function emitRehearsalInputs(env=process.env,event){
 assertRehearsalContext(env,event===undefined?readIssueEvent(env):event);
 if(!env.GITHUB_ENV)fail('G6_M06_REHEARSAL_GITHUB_ENV_REQUIRED');
 // Never replace supplied real operator evidence, even on a separate staging trigger.
 for(const key of INPUT_KEYS)if(String(env[key]||'').trim())
  fail('G6_M06_REHEARSAL_OPERATOR_INPUT_CONFLICT_'+key);
 const generated=buildM06RehearsalInputs(env.GITHUB_RUN_ID);
 const delimiter='G6_M06_'+crypto.randomBytes(12).toString('hex');
 let output='';
 for(const [key,value] of Object.entries(generated)){
  if(value.includes('\n')||value.includes(delimiter))fail('G6_M06_REHEARSAL_ENV_VALUE_INVALID');
  output+=key+'<<'+delimiter+'\n'+value+'\n'+delimiter+'\n';
 }
 fs.appendFileSync(env.GITHUB_ENV,output,{encoding:'utf8',flag:'a'});
 return {mode:MODE,run_id:String(env.GITHUB_RUN_ID),simulation_only:true,
  variables:Object.keys(generated).length,values_redacted:true};
}
if(require.main===module){
 try{console.log(JSON.stringify(emitRehearsalInputs()))}
 catch(e){console.error(e.message);process.exitCode=1;}
}
module.exports={MODE,TITLE,INPUT_KEYS,buildM06RehearsalInputs,assertRehearsalContext,
 assertRehearsalInputs,emitRehearsalInputs};
