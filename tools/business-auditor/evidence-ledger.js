'use strict';
/**
 * Independent, conservative evidence ledger. No application code or DB imports.
 * Lexical evidence can never promote itself into a confirmed runtime bug.
 */
const crypto=require('node:crypto');
const REVIEW=new Set(['DYNAMIC_TABLE_UNRESOLVED','NOT_IN_FEATURE_CARDS',
 'FEATURE_OWNER_NOT_EXPLICIT','CONFLICTING_EXPLICIT_OWNERS','CROSS_DOMAIN_WRITE_REVIEW']);
const SORT=(a,b)=>a.id.localeCompare(b.id);
function stableId(key){
 return 'KBA-W-'+crypto.createHash('sha256').update(key).digest('hex').slice(0,12);
}
function assessProof(proof){
 if(!proof)return {verdict:'UNVERIFIED_STATIC_SIGNAL',reason:'No paired independent evidence'};
 const a=proof.adversarial,n=proof.nominal;
 const valid=e=>e&&e.environment==='LOCAL_DISPOSABLE_TEST'&&
  typeof e.test==='string'&&e.test.trim().length>3&&
  /^[0-9a-f]{40}$/.test(e.commit||'')&&
  e.executed===true&&e.observation&&typeof e.observation==='string'&&
  e.expected&&typeof e.expected==='string'&&e.observed&&typeof e.observed==='string';
 if(!valid(n)||!valid(a))
  return {verdict:'UNVERIFIED_STATIC_SIGNAL',reason:'Paired executable local-test evidence incomplete'};
 if(n.expected!==n.observed)
  return {verdict:'ATTESTED_NOMINAL_CONTROL_MISMATCH',reason:'Claimed nominal behavior does not match; execution not independently verified'};
 if(a.expected===a.observed)
  return {verdict:'ATTESTED_COUNTEREXAMPLE_NOT_OBSERVED',reason:'Claimed adversarial observation matches expected invariant; not independently verified'};
 if(!proof.independentReview||proof.independentReview.approved!==true||
  !proof.independentReview.reviewer||!proof.independentReview.issue)
  return {verdict:'ATTESTED_DEVIATION_PENDING_REVIEW',reason:'Claimed adversarial deviation; independent evidence and owner review missing'};
 return {verdict:'ATTESTED_DEVIATION_PENDING_TRUSTED_CI',reason:'Self-reported proof cannot independently certify test execution'};
}
function makeEvidenceLedger(inventory,{proofs={}}={}){
 if(inventory?.contract!=='komerce-business-writer-inventory/v1'||!Array.isArray(inventory.writes))
  throw Error('Expected independently built writer inventory v1');
 if(!proofs||typeof proofs!=='object'||Array.isArray(proofs))throw Error('Invalid proof registry');
 const groups=new Map(),unresolved=new Map();
 for(const w of inventory.writes){

  if(!w.physicalTableDeclared){
   const key=[w.file,w.rawTarget||w.table||'<dynamic>'].join('|');
   if(!unresolved.has(key))unresolved.set(key,{file:w.file,
    rawTarget:w.rawTarget||null,table:w.table||null,
    schemaEvidence:w.schemaEvidence||'SCHEMA_TARGET_UNVERIFIED',occurrences:[]});
   unresolved.get(key).occurrences.push({line:w.line,action:w.action,binding:w.binding});
   continue;
  }
  // Identity is independent of governance/header classification and source line.
  const key=[w.file,w.table].join('|');
  if(!groups.has(key))groups.set(key,{key,file:w.file,table:w.table,
   declaredDomain:w.declaredDomain||null,ownerResolution:w.ownerResolution,
   explicitOwners:w.explicitOwners||[],occurrences:[],primaryGrainRules:new Set()});
  const row=groups.get(key);
  if(row.ownerResolution!==w.ownerResolution||row.declaredDomain!==(w.declaredDomain||null))
   throw Error('Conflicting owner classification within grouped file/table: '+key);
  row.occurrences.push({line:w.line,binding:w.binding,action:w.action,
   headerStatus:w.headerStatus});
  for(const rule of w.primaryGrainRules||[])row.primaryGrainRules.add(rule);
 }
 const entries=[...groups.values()].map(g=>{
  const id=stableId(g.key),proof=Object.prototype.hasOwnProperty.call(proofs,id)?proofs[id]:null;
  const assessment=assessProof(proof);
  return {id,file:g.file,table:g.table,declaredDomain:g.declaredDomain,
   declaredOwners:g.explicitOwners,ownerResolution:g.ownerResolution,
   occurrences:g.occurrences.sort((a,b)=>(a.line||0)-(b.line||0)),
   occurrenceCount:g.occurrences.length,primaryGrainRules:[...g.primaryGrainRules].sort(),
   reviewRequired:REVIEW.has(g.ownerResolution),
   risk:'STATIC_CANDIDATE_NOT_RUNTIME_PROOF',
   verdict:assessment.verdict,reason:assessment.reason,
   nextProof:!REVIEW.has(g.ownerResolution)?
    'Verify invariant behavior even for an apparent owner-domain match':
    'Resolve owner/delegation, trace active caller, then run paired nominal/adversarial tests',
   confirmedProductionIncident:false};
 }).sort(SORT);

 const unresolvedEntries=[...unresolved.entries()].map(([key,g])=>({
  id:'KBA-U-'+crypto.createHash('sha256').update(key).digest('hex').slice(0,12),
  file:g.file,table:g.table,rawTarget:g.rawTarget,schemaEvidence:g.schemaEvidence,
  occurrenceCount:g.occurrences.length,
  occurrences:g.occurrences.sort((a,b)=>(a.line||0)-(b.line||0)),
  verdict:'SCHEMA_TARGET_UNRESOLVED',reviewRequired:true,confirmedProductionIncident:false,
  nextProof:'Resolve SQL literal/identifier and compare target with checked-in and live test schemas',
 })).sort(SORT);
 const used=new Set(entries.map(x=>x.id)),unknown=Object.keys(proofs).filter(k=>!used.has(k));
 if(unknown.length)throw Error('Proofs refer to unknown finding IDs: '+unknown.join(','));
 return {contract:'komerce-business-evidence-ledger/v1',method:'GROUPED_STATIC_CANDIDATES_PLUS_EXPLICIT_PAIRED_PROOF',
  summary:{sourceOccurrences:inventory.writes.filter(w=>w.physicalTableDeclared).length,
   unresolvedOccurrences:inventory.writes.filter(w=>!w.physicalTableDeclared).length,
   allCandidateOccurrences:inventory.writes.length,
   distinctCases:entries.length,distinctUnresolvedCases:unresolvedEntries.length,
   reviewCases:entries.filter(x=>x.reviewRequired).length,
   confirmedTestCounterexamples:0,
   confirmedProductionIncidents:0,nonRuntimeCoverageCertified:false},
  entries,unresolvedEntries,limits:['Grouping removes repeated lexical occurrences, not semantic ambiguities',
   'Owner/domain matching is never proof of invariant correctness',
   'Proof metadata is attestational until CI independently validates test artifacts',
   'Test counterexample is not proof of production impact']};
}
module.exports={makeEvidenceLedger,assessProof,stableId};
