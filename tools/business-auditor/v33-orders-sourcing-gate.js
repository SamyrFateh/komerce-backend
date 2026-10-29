#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {assertLocalTestTarget}=require('./cli');
const {withClone}=require('./v16-cloned-database');
const {inspect,counterfeit}=require('./v33-orders-sourcing-oracle');
const ROOT=path.resolve(__dirname,'../..');
const files=['services/order-status-machine.js','services/sourcing-candidate-import-service.js'];
function anchor(){
 const sources=files.map(p=>fs.readFileSync(path.join(ROOT,p),'utf8'));
 if(!/async function transitionOrderStatus\s*\(/.test(sources[0])||
  !/order_status_history/.test(sources[0])||
  !/VALID_TRANSITIONS/.test(sources[0])||
  !/async function archiveMissingCandidatesFromCatalogImport\s*\(/.test(sources[1])||
  !/sourcing_candidate_events/.test(sources[1])||
  !/supplier_product_id <> ALL/.test(sources[1]))
  throw Error('V33_GATE_TOOL_ERROR: real owner or audit boundary changed');
 return {contract:'komerce-orders-sourcing-source-anchor/v33',
  owners:files,hash:crypto.createHash('sha256').update(sources.join('\n')).digest('hex'),
  realOwnerRequired:true};
}
async function run(env=process.env,opts={},deps={}){
 assertLocalTestTarget(env);
 const source=deps.anchor?deps.anchor():anchor();
 if(source?.contract!=='komerce-orders-sourcing-source-anchor/v33'||
  !source.realOwnerRequired||!/^[a-f0-9]{64}$/.test(source.hash||''))
  throw Error('V33_GATE_TOOL_ERROR: source anchor missing');
 const execute=deps.execute||((url,mode)=>{
  const output=cp.execFileSync(process.execPath,
   [path.join(__dirname,'v33-orders-sourcing-child.js'),mode],{
   cwd:ROOT,encoding:'utf8',timeout:45000,maxBuffer:1024*1024,
   stdio:['ignore','pipe','pipe'],
   env:{...env,NODE_ENV:'test',KOMERCE_DISABLE_CRONS:'true',DATABASE_URL:url}});
  const prefix='BUSINESS_AUDIT_V33_PHYSICAL ';
  const line=output.split('\n').find(x=>x.startsWith(prefix));
  if(!line)throw Error('V33_GATE_TOOL_ERROR: physical worker returned no evidence '+mode);
  return JSON.parse(line.slice(prefix.length));
 });
 const cases=[];
 for(const mode of ['ORDER','SOURCING']){
  const r=await (deps.withClone||withClone)(env,url=>execute(url,mode));
  if(!r.cloneDroppedAfterExecution)
   throw Error('V33_GATE_TOOL_ERROR: clone not torn down '+mode);
  const verdict=inspect(r.result),negative=counterfeit(r.result);
  if(mode==='ORDER'){
   if(verdict.violation||!negative.signals.includes('ORD3_IDEMPOTENT_REPLAY_OR_BACKWARD_SCAN_CHANGED_STATE'))
    throw Error('V33_GATE_TOOL_ERROR: order transition or control failed '+verdict.signals);
  }else{
   if(!verdict.violation||!verdict.signals.includes('SRC3_ARCHIVE_EVENT_OLD_STATE_LOST')||
    verdict.signals.some(x=>x!=='SRC3_ARCHIVE_EVENT_OLD_STATE_LOST')||
    !negative.correctedContractWouldPass||
    !negative.forgedSignals.includes('SRC1_FULL_SNAPSHOT_ARCHIVE_PROTECTION_BROKEN'))
    throw Error('V33_GATE_TOOL_ERROR: sourcing anomaly witness lost or new regression '+verdict.signals);
  }
  cases.push({mode,service:source.owners[mode==='ORDER'?0:1],
   verdict:verdict.violation?'BUSINESS_VIOLATION':'PASS_WITH_EVIDENCE',
   oracle:verdict,negativeControl:negative,cloneDropped:true,
   authenticatedHttpRouteTested:false,productionIncidentConfirmed:false});
 }
 const result={contract:'komerce-order-sourcing-physical-gate/v33',sha:env.GITHUB_SHA||null,
  source,cases,allClonesDropped:true,
  discoveredBugCandidate:{id:'SRC3_ARCHIVE_EVENT_OLD_STATE_LOST',
   service:'services/sourcing-candidate-import-service.js',
   mode:'SOURCING',status:'REPRODUCED_ON_DISPOSABLE_CANONICAL_PG',
   productPatchApplied:false,productionIncidentConfirmed:false,
   mechanism:'UPDATE sourcing_candidates RETURNING state after archive, then event old_state uses RETURNING state'},
  coverageScope:'ORDERS_ONE_STATUS_PATH; SOURCING_FULL_SNAPSHOT_ARCHIVE_ONLY',
  productionFixProven:false};
 console.log('BUSINESS_AUDIT_V33_OWNER_GATE '+JSON.stringify({
  modes:cases.map(x=>x.mode),verdicts:cases.map(x=>x.verdict),
  signals:cases.map(x=>x.oracle.signals),
  negative:cases.map(x=>x.negativeControl),allClonesDropped:true
 }));
 return result;
}
if(require.main===module)run().then(r=>{
 if(process.argv[2]){const out=path.resolve(process.argv[2]);
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'v33-orders-sourcing-gate.json'),JSON.stringify(r,null,2)+'\n')}
}).catch(e=>{console.error('BUSINESS_AUDIT_V33_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2});
module.exports={anchor,run};
