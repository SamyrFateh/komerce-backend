'use strict';
/**
 * V2.8 portable physical adapters, registered BEFORE any database work.
 * The same existing independent oracles used by V2.2 and V2.7 are imported;
 * service responses must NEVER define their own expected values.
 * Each case gets a fresh full PostgreSQL clone with strict local guards.
 */
const cp=require('node:child_process'),path=require('node:path'),crypto=require('node:crypto');
const {withClone}=require('./v16-cloned-database');
const {assertLocalTestTarget}=require('./cli');
const {checkFinancialSchedule}=require('./v22-financial-invariants');
const {checkMembership}=require('./v27-logistics-oracle');
const ROOT=path.resolve(__dirname,'../..');
const REGISTRY=Object.freeze([
 Object.freeze({id:'FIN-REFUND-BA',domain:'finance',mode:'BA',fixture:'refund',
   service:'routes/orders/cancel.js + services/payment-paypal.js',expect:'PASS_WITH_EVIDENCE',
   businessRule:'Total economic payouts <= capture; PSP refunds traceable'}),
 Object.freeze({id:'LOG-PARCEL-NOMINAL',domain:'logistics',mode:'NOMINAL',fixture:'parcel',
   service:'services/auto-parcel.js',expect:'PASS_WITH_EVIDENCE',
   businessRule:'New membership returns one assigned item, active parcel exists'}),
 Object.freeze({id:'FIN-REFUND-AB',domain:'finance',mode:'AB',fixture:'refund',
   service:'routes/orders/cancel.js + services/payment-paypal.js',expect:'BUSINESS_VIOLATION',
   businessRule:'Cancel wallet followed by PSP refund must not pay twice'}),
 Object.freeze({id:'LOG-PARCEL-CANCELLED',domain:'logistics',mode:'CANCELLED_MEMBERSHIP',
   fixture:'parcel',service:'services/auto-parcel.js',expect:'BUSINESS_VIOLATION',
   businessRule:'Cancelled parcel membership never counts as active coverage'})
]);
function frozenSelection({maxCases=4,domains=['finance','logistics']}={}){
 if(!Number.isInteger(maxCases)||maxCases<1||maxCases>4)
  throw Error('V28_TOOL_ERROR: physical case budget must be 1..4');
 if(!Array.isArray(domains)||!domains.length||domains.some(d=>!['finance','logistics'].includes(d))||
  new Set(domains).size!==domains.length)
  throw Error('V28_TOOL_ERROR: unsupported domain selection');
 const eligible=REGISTRY.filter(r=>domains.includes(r.domain));
 const selected=eligible.slice(0,maxCases);
 const raw=selected.map(r=>r.id+'|'+r.domain+'|'+r.mode+'|'+r.expect).join('\n');
 return {selected,hash:crypto.createHash('sha256').update(raw).digest('hex'),
  considered:eligible.length,budget:maxCases,selectionKind:'FROZEN_CALIBRATION_REGISTRY_NOT_GENERAL_AUTO_DISCOVERY'};
}
function inspectCase(entry,raw){
 if(!entry||!raw||raw.mode!==entry.mode)
  throw Error('V28_TOOL_ERROR: case and physical evidence differ');
 const oracle=entry.fixture==='refund'?
  checkFinancialSchedule(raw):checkMembership(raw);
 if(entry.fixture==='refund'&&
  (raw.simulation!=='PAYPAL_FETCH_STRICT_NO_EXTERNAL_NETWORK'||
   raw.authMiddlewareExecuted!==false||raw.localCloneVerified!==true||
   raw.capture?.eur!==20||raw.capture?.kmf!==10000))
  throw Error('V28_TOOL_ERROR: refund evidence not strictly simulated');
 if(entry.fixture==='parcel'&&
  (!raw.realOwnerCalled||!raw.realCanonicalSchema||raw.sessionCount!==2||
   raw.authMiddlewareExecuted!==false||raw.noProductionTouch!==true||
   raw.ownerInsertCalls!==1||
   !raw.actualIndexes?.some(x=>x.name==='unique_order_item_per_parcel'&&
    x.definition.includes('(order_item_id)'))))
  throw Error('V28_TOOL_ERROR: canonical parcel fixture or uniqueness missing');
 // Expected failures are a PASS of the TEST only, NOT a healthy business result.
 const result=oracle.violation?'BUSINESS_VIOLATION':'PASS_WITH_EVIDENCE';
 if(entry.expect!==result)
  throw Error('V28_PROOF_DRIFT: expected '+entry.expect+' got '+result+' in '+entry.id+
   ': '+JSON.stringify(oracle.signals));
 if(entry.id==='FIN-REFUND-AB'&&
  !['I1_ECONOMIC_REFUNDS_EXCEED_CAPTURE',
   'I2_PSP_REFUND_MISSING_FROM_LEDGER',
   'I3_OWNER_SUCCESS_WITH_UNRECORDED_PSP_REFUND'].every(s=>oracle.signals.includes(s)))
  throw Error('V28_PROOF_DRIFT: original full economic counterexample absent');
 if(entry.id==='FIN-REFUND-BA'&&
  (oracle.totalRefundValueCents!==2000||oracle.capturedCents!==2000))
  throw Error('V28_PROOF_DRIFT: nominal capture/refund mismatch');
 if(entry.id==='LOG-PARCEL-NOMINAL'&&
  (raw.ownerInserted!==1||raw.after?.activeCount!==1||raw.response?.items_assigned!==1))
  throw Error('V28_PROOF_DRIFT: nominal physical membership missing');
 if(entry.id==='LOG-PARCEL-CANCELLED'&&
  (raw.ownerInserted!==0||raw.after?.activeCount!==0||
   !['L1_REPORTED_ASSIGNMENTS_DO_NOT_MATCH_OWNER_INSERTS',
     'L2_SUCCESS_WITHOUT_WRITE_OR_IDEMPOTENT_CLASSIFICATION',
     'L3_ORDER_NOT_IN_EXACTLY_ONE_ACTIVE_PARCEL',
     'L5_REPORTED_TARGET_MEMBERSHIP_MISSING'].every(s=>oracle.signals.includes(s))))
  throw Error('V28_PROOF_DRIFT: cancelled parcel counterexample absent');
 return {result,signals:oracle.signals,oracleContract:oracle.contract||oracle.authority,
  quantified:entry.fixture==='refund'?{
   capturedCents:oracle.capturedCents,economicOutflowCents:oracle.totalRefundValueCents
  }:{rowCount:raw.ownerInserted,reported:raw.response.items_assigned,
     activeMemberships:raw.after.activeCount}};
}
function rejectFakeFix(entry,raw){
 if(entry.id==='LOG-PARCEL-CANCELLED'){
  const fake=structuredClone(raw);
  fake.response.items_assigned=fake.ownerInserted;
  return {name:'COUNT_ONLY_MUTANT',signals:checkMembership(fake).signals};
 }
 if(entry.id==='FIN-REFUND-BA'){
  const fake=structuredClone(raw);
  fake.state.pspEvents.push({id:'FAKE-SECOND-REFUND',amountEur:20});
  return {name:'FORGED_SECOND_PSP_OUTFLOW',signals:checkFinancialSchedule(fake).signals};
 }
 return null;
}
async function physicalProof(env,options={},deps={}){
 assertLocalTestTarget(env); // before any subprocess or CREATE DATABASE.
 // V2.9 may supply a source-owner-grounded plan selected before any DB access.
 // A dynamic source hypothesis NEVER becomes an executable recipe unless its
 // exact ID/mode/fixture/expect matches the manually reviewed oracle registry.
 const plan=options.calibratedSelection;
 if(plan&&(
    plan.contract!=='komerce-owner-grounded-calibrated-recipe-selection/v29'||
    !/^[a-f0-9]{64}$/.test(plan.hash||'')||
    !Array.isArray(plan.selected)||plan.selected.length<1||
    plan.selected.length>4||
    plan.selected.some(x=>{
     const registered=REGISTRY.find(c=>c.id===x.id);
     return !registered||registered.domain!==x.domain||
       registered.mode!==x.mode||registered.fixture!==x.fixture||
       registered.expect!==x.expect||!x.ownerEvidence||
       !x.selectionReason;
    })||new Set(plan.selected.map(x=>x.id)).size!==plan.selected.length))
   throw Error('V29_SELECTION_TOOL_ERROR: unreviewed or malformed physical recipe');
 const selection=plan?{...plan,selectionKind:'SOURCE_OWNER_BOUND_REVIEWED_RECIPES'}:
  frozenSelection(options);
 const results=[];
 const execute=deps.execute||((args,environment)=>{
  const child=args.fixture==='refund'?'v22-refund-probe-child.js':'v27-logistics-physical-child.js';
  const out=cp.execFileSync(process.execPath,[path.join(__dirname,child),args.mode],{
   cwd:ROOT,encoding:'utf8',timeout:35000,maxBuffer:1024*1024,
   stdio:['ignore','pipe','pipe'],
   env:{...environment,DATABASE_URL:args.url,NODE_ENV:'test',KOMERCE_DISABLE_CRONS:'true',
    KBA_V23_MUTANT:'',KBA_V24_MUTANT:'',KBA_V25_FAULT:'',KBA_V26_CRASH_ALLOWED:''}});
  const marker=args.fixture==='refund'?
   'BUSINESS_AUDIT_V22_FINANCIAL_PROBE ':'BUSINESS_AUDIT_V27_PHYSICAL ';
  const line=out.split('\n').find(s=>s.startsWith(marker));
  if(!line)throw Error('V28_TOOL_ERROR: physical worker evidence missing '+args.id);
  return JSON.parse(line.slice(marker.length));
 });
 for(const entry of selection.selected){
  const cloned=await (deps.withClone||withClone)(env,
   url=>execute({...entry,url},env));
  if(cloned.cloneDroppedAfterExecution!==true)
   throw Error('V28_TOOL_ERROR: clone teardown not demonstrated');
  const raw=cloned.result;
  const verdict=inspectCase(entry,raw);
  const negative=rejectFakeFix(entry,raw);
  if(negative&&(
    (negative.name==='COUNT_ONLY_MUTANT'&&
     !negative.signals.includes('L3_ORDER_NOT_IN_EXACTLY_ONE_ACTIVE_PARCEL'))||
    (negative.name==='FORGED_SECOND_PSP_OUTFLOW'&&
     !negative.signals.includes('I1_ECONOMIC_REFUNDS_EXCEED_CAPTURE'))))
   throw Error('V28_TOOL_ERROR: falsified evidence bypassed independent oracle');
  results.push({id:entry.id,domain:entry.domain,mode:entry.mode,
   selectedBy:selection.selectionKind,businessRule:entry.businessRule,
   service:entry.service,expected:entry.expect,
   ...verdict,negativeControl:negative,cloneDropped:true,
   realHttpAuthProven:false,productionIncidentConfirmed:false});
 }
 return {contract:'komerce-physical-calibration/v28',selection:{...selection,selected:selection.selected.map(x=>x.id)},
  cases:results,allClonesDropped:results.every(x=>x.cloneDropped),
  scope:'REAL_OWNER_DISPOSABLE_CANONICAL_PG; FROZEN_MANUALLY_REVIEWED_CALIBRATIONS',
  productionFixProven:false,allBusinessDomainsCovered:false};
}
module.exports={REGISTRY,frozenSelection,inspectCase,rejectFakeFix,physicalProof};
