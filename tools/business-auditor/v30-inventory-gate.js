#!/usr/bin/env node
'use strict';
/**
 * V3.0 source-grounded inventory receipt qualification:
 * - actual receiveItem, two real orders, two isolated PG clones;
 * - nominal reception, foreign order rejection and no phantom rows;
 * - independent control counterfeits the classic bug after a fabricated 409.
 */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {withClone}=require('./v16-cloned-database');
const {assertLocalTestTarget}=require('./cli');
const {buildWriterInventory,trackedJs}=require('./writer-inventory');
const {assess,forgeAfterRejection}=require('./v30-inventory-oracle');
const ROOT=path.resolve(__dirname,'../..'),child=path.join(__dirname,'v30-inventory-physical-child.js');
const required=(x,m)=>{if(!x)throw Error('V30_GATE_TOOL_ERROR: '+m)};
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function sourceAnchor(root=ROOT){
 const files=trackedJs(root);
 const inv=buildWriterInventory(root,{paths:files});
 const owner='services/inventory-service.js';
 const hits=inv.writes.filter(x=>x.file===owner&&x.table==='inventory_items'&&
  x.physicalTableDeclared);
 const text=fs.readFileSync(path.join(root,owner),'utf8');
 const route=fs.readFileSync(path.join(root,'routes/inventory-api.js'),'utf8');
 required(hits.length>0,'inventory owner no longer writes canonical inventory_items');
 required(/async function receiveItem\s*\(/.test(text)&&
  /INSERT INTO inventory_items\s*\(/i.test(text)&&
  /SELECT oi\.id, oi\.order_id/.test(text)&&
  /INVENTORY_ORDER_MISMATCH/.test(text),'canonical receiveItem owner signature drifted');
 required(/inv\.receiveItem\(req\.body\)/.test(route)&&
  /requireRole\(\['admin', 'agent_hub'\]\)/.test(route),
  'route source ownership/middleware declaration drifted');
 const signature=hash(text+'\n'+route+
  hits.map(x=>x.table+'|'+x.file+'|'+x.line).join('\n'));
 return {contract:'komerce-inventory-owner-source-anchor/v30',
  service:owner,route:'routes/inventory-api.js',table:'inventory_items',
  sourceHash:signature,writerLines:hits.map(x=>x.line),
  physicalTableDeclared:true,ownerExecutedInGate:true,
  httpAuthenticatedExecutionProven:false,
  justification:'SOURCE_BOUND_CALL_AND_CANONICAL_SQL_WRITER_NOT_RUNTIME_ROUTE_PROOF'};
}
async function run(env=process.env,opts={},deps={}){
 assertLocalTestTarget(env);
 const max=opts.maxCases??2;
 required(max===2,'fixed V3.0 inventory nominal+foreign pair required (2 clones)');
 const anchor=deps.sourceAnchor?await deps.sourceAnchor():sourceAnchor();
 required(anchor?.contract==='komerce-inventory-owner-source-anchor/v30'&&
  /^[0-9a-f]{64}$/.test(anchor.sourceHash||'')&&
  anchor.table==='inventory_items'&&anchor.physicalTableDeclared,
  'source evidence missing');
 const selected=['NOMINAL','FOREIGN_ORDER'];
 const seal=hash(anchor.sourceHash+'|'+selected.join('|'));
 const execute=deps.execute||((url,mode)=>{
  const output=cp.execFileSync(process.execPath,[child,mode],{
   cwd:ROOT,encoding:'utf8',timeout:35000,maxBuffer:1024*1024,
   stdio:['ignore','pipe','pipe'],
   env:{...env,DATABASE_URL:url,NODE_ENV:'test',KOMERCE_DISABLE_CRONS:'true',
    KBA_V23_MUTANT:'',KBA_V24_MUTANT:'',KBA_V25_FAULT:''}});
  const line=output.split('\n').find(s=>s.startsWith('BUSINESS_AUDIT_V30_INVENTORY '));
  required(Boolean(line),'real canonical owner produced no physical evidence '+mode);
  return JSON.parse(line.slice('BUSINESS_AUDIT_V30_INVENTORY '.length));
 });
 const cases=[];
 for(const mode of selected){
  const c=await (deps.withClone||withClone)(env,url=>execute(url,mode));
  required(c.cloneDroppedAfterExecution===true,'disposable clone not dropped '+mode);
  const observed=assess(c.result);
  required(observed.mode===mode&&!observed.violation,
   'current Inventory.receiveItem violates canonical owner invariant '+mode+
   ' '+JSON.stringify(observed.signals));
  let negative=null;
  if(mode==='FOREIGN_ORDER'){
   const bogus=forgeAfterRejection(c.result);
   const verdict=assess(bogus);
   required(verdict.violation&&
    ['INV1_CANONICAL_ORDER_IDENTITY_BROKEN',
     'INV3_FOREIGN_ORDER_COMPLETION_CHANGED',
     'INV7_REJECTED_REQUEST_LEFT_PHYSICAL_WRITES'].every(s=>verdict.signals.includes(s)),
    'oracle blindly accepted a forged 409 with cross-order writes');
   negative={name:'FORGED_409_WITH_FOREIGN_RECEIPT_AND_COMPLETION',
    signals:verdict.signals,onlyMutatesObservation:true,
    didNotExecuteServiceMutation:true};
  }
  cases.push({mode,source:anchor.service,sourceHash:anchor.sourceHash,
   verdict:'PASS_WITH_EVIDENCE',oracle:observed,
   negativeControl:negative,cloneDropped:true,
   realHttpAuthProven:false,productionIncidentConfirmed:false});
 }
 const result={contract:'komerce-inventory-receipt-cross-order-gate/v30',
  sha:env.GITHUB_SHA||null,runId:env.GITHUB_RUN_ID||null,
  selectionHash:seal,source:anchor,selected,cases,allClonesDropped:true,
  calibratedDomain:'inventory',
  canonicalOwnershipFixConfirmedInClone:true,
  productionFixProven:false,
  absentOldBugInTheseFixtures:true,
  limitations:'Direct service only, no authenticated HTTP or arbitrary races. The forged 409 after foreign receipt is an oracle mutation of observations, not a production service mutant.'};
 console.log('BUSINESS_AUDIT_V30_INVENTORY_GATE '+JSON.stringify({
  source:anchor.service,selectionHash:seal,
  cases:cases.map(x=>({mode:x.mode,signals:x.oracle.signals,
   received:x.oracle.insertedRows,foreignCompletion:x.oracle.orderBCompletionAfter,
   negativeSignals:x.negativeControl?.signals||[]})),
  allClonesDropped:true}));
 return result;
}
if(require.main===module){
 run().then(x=>{
  if(process.argv[2]){
   const out=path.resolve(process.argv[2]);
   fs.mkdirSync(out,{recursive:true});
   fs.writeFileSync(path.join(out,'v30-inventory-gate.json'),JSON.stringify(x,null,2)+'\n');
  }
 }).catch(e=>{console.error('BUSINESS_AUDIT_V30_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2});
}
module.exports={sourceAnchor,run};
