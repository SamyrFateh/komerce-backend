'use strict';
/**
 * V3.4 registry of reviewed physical proof adapters.
 * This is NOT a generated-test registry: a writer pair is never runnable
 * until its owner, executable fixture and independent oracle are reviewed.
 * Static discovery stays V2.9; physical gate bodies are unchanged.
 */
const DOMAINS=Object.freeze(['sourcing','pricing','catalogue','orders',
  'finance','inventory','logistics','authorization']);
const ADAPTERS=Object.freeze([
  Object.freeze({
    id:'inventory',module:'./v30-inventory-gate',
    reportKey:'inventoryProof',sourceHashKey:'sourceHash',preflightMethod:'sourceAnchor',
    preflightInjectionKey:'sourceAnchor',domains:Object.freeze(['inventory']),
    modes:Object.freeze(['NOMINAL','FOREIGN_ORDER']),
    verdicts:Object.freeze(['PASS_WITH_EVIDENCE','PASS_WITH_EVIDENCE']),
    requiredNegative:Object.freeze([null,'INV1_CANONICAL_ORDER_IDENTITY_BROKEN']),
    caseIds:Object.freeze(['INV-RECEIVE-NOMINAL','INV-RECEIVE-FOREIGN_ORDER'])
  }),
  Object.freeze({
    id:'fx-market',module:'./v31-fx-market-gate',
    reportKey:'fxMarketProof',sourceHashKey:'hash',preflightMethod:'sourceAnchor',
    preflightInjectionKey:'anchor',domains:Object.freeze(['pricing']),
    modes:Object.freeze(['FX','MARKET']),
    verdicts:Object.freeze(['PASS_WITH_EVIDENCE','PASS_WITH_EVIDENCE']),
    requiredNegative:Object.freeze(['FX1_PIVOT_RESULT_OR_ROUNDING_MISMATCH',
      'MK2_MARKET_OPERATION_POLICY_VIOLATION']),
    caseIds:Object.freeze(['FX-FIXED-PIVOT','MARKET-LIFECYCLE-GUARD'])
  }),
  Object.freeze({
    id:'catalog-authorization',module:'./v32-catalog-auth-gate',
    reportKey:'catalogAuthorizationProof',sourceHashKey:'hash',
    preflightMethod:'sourceAnchor',preflightInjectionKey:'anchor',
    domains:Object.freeze(['catalogue','authorization']),
    modes:Object.freeze(['CATALOG','AUTH']),
    verdicts:Object.freeze(['PASS_WITH_EVIDENCE','PASS_WITH_EVIDENCE']),
    requiredNegative:Object.freeze(['CAT2_EXPOSURE_LEAKED_TO_ANOTHER_MARKET',
      'AUTH2_MARKET_OR_MEMBERSHIP_ISOLATION_BROKEN']),
    caseIds:Object.freeze(['CATALOG-MARKET-EXPOSURE','AUTH-MARKET-MEMBERSHIP'])
  }),
  Object.freeze({
    id:'orders-sourcing',module:'./v33-orders-sourcing-gate',
    reportKey:'ordersSourcingProof',sourceHashKey:'hash',
    preflightMethod:'anchor',preflightInjectionKey:'anchor',
    domains:Object.freeze(['orders','sourcing']),
    modes:Object.freeze(['ORDER','SOURCING']),
    verdicts:Object.freeze(['PASS_WITH_EVIDENCE','BUSINESS_VIOLATION']),
    requiredNegative:Object.freeze(['ORD3_IDEMPOTENT_REPLAY_OR_BACKWARD_SCAN_CHANGED_STATE',
      'SRC1_FULL_SNAPSHOT_ARCHIVE_PROTECTION_BROKEN']),
    caseIds:Object.freeze(['ORDER-CONFIRMED-TO-ORDERED','SOURCING-FULL-SNAPSHOT-ARCHIVE']),
    knownViolation:'SRC3_ARCHIVE_EVENT_OLD_STATE_LOST',
    knownViolationIssue:3127
  })
]);
function fail(reason){throw Error('V34_REGISTRY_TOOL_ERROR: '+reason)}
function hashFrom(adapter,anchor){
 return anchor?.[adapter.sourceHashKey]||null;
}
function validate(){
 const names=new Set(),fields=new Set();
 for(const a of ADAPTERS){
  if(names.has(a.id)||fields.has(a.reportKey))fail('duplicate adapter/field '+a.id);
  names.add(a.id);fields.add(a.reportKey);
  if(!a.id||!a.module.startsWith('./v')||!a.reportKey||!a.sourceHashKey||
   a.modes.length!==a.verdicts.length||a.caseIds.length!==a.modes.length||
   a.requiredNegative.length!==a.modes.length||
   new Set(a.modes).size!==a.modes.length||
   a.domains.some(d=>!DOMAINS.includes(d))||
   !['anchor','sourceAnchor'].includes(a.preflightInjectionKey))
    fail('invalid reviewed adapter contract '+a.id);
 }
 const domains=new Set(['finance','logistics',...ADAPTERS.flatMap(a=>a.domains)]);
 if(domains.size!==8)fail('missing domain contract');
 return true;
}
function getRunner(adapter){
 const gate=require(adapter.module);
 if(typeof gate[adapter.preflightMethod]!=='function'||
  typeof gate.run!=='function')fail('real gate entrypoint missing '+adapter.id);
 return {anchor:()=>gate[adapter.preflightMethod](),run:gate.run};
}
function assertProof(adapter,proof,anchor){
 if(!proof||proof.allClonesDropped!==true||
  !Array.isArray(proof.cases)||proof.cases.length!==adapter.modes.length||
  !/^[a-f0-9]{64}$/.test(hashFrom(adapter,anchor)||'')||
  hashFrom(adapter,proof.source)!==hashFrom(adapter,anchor))
  fail('clone/source provenance incomplete '+adapter.id);
 for(let i=0;i<adapter.modes.length;i++){
  const c=proof.cases[i],negative=adapter.requiredNegative[i];
  if(!c||c.mode!==adapter.modes[i]||c.verdict!==adapter.verdicts[i]||
   !c.oracle||!Array.isArray(c.oracle.signals)||
   c.cloneDropped!==true||c.authenticatedHttpRouteTested===true)
    fail('reviewed physical case missing or changed '+adapter.id+':'+i);
  if(adapter.knownViolation&&i===1){
   if(c.oracle.signals.join('|')!==adapter.knownViolation||
    c.negativeControl?.correctedContractWouldPass!==true||
    !c.negativeControl?.forgedSignals?.includes(negative))
    fail('known sourcing violation or independent counterfactual missing');
  }else if(c.oracle.violation!==false||c.oracle.signals.length!==0||
   (negative&&!c.negativeControl?.signals?.includes(negative)))
    fail('nominal or negative control missing '+adapter.id+':'+i);
 }
 return true;
}
function physicalDescriptors(base,proofs){
 const rows=(base?.physical?.cases||[]).map(c=>({
  id:c.id,domain:c.domain,verdict:c.result,origin:'legacy_calibrated',
  independentOracle:true,cloneDropped:c.cloneDropped===true}));
 for(const a of ADAPTERS){
  const p=proofs[a.reportKey];
  for(let i=0;i<(p?.cases.length||0);i++)
   rows.push({id:a.caseIds[i],domain:a.domains.length===1?a.domains[0]:
    a.modes[i]==='CATALOG'?'catalogue':
    a.modes[i]==='AUTH'?'authorization':
    a.modes[i]==='ORDER'?'orders':'sourcing',
    verdict:p.cases[i].verdict,origin:'reviewed_adapter',
    independentOracle:true,cloneDropped:p.cases[i].cloneDropped===true});
 }
 if(new Set(rows.map(x=>x.id)).size!==rows.length)
  fail('duplicate physical case identity');
 return rows;
}
validate();
module.exports={DOMAINS,ADAPTERS,hashFrom,validate,getRunner,assertProof,physicalDescriptors};
