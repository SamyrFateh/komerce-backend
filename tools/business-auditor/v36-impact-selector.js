'use strict';
/**
 * G3 selection pilot. Pure selector: returns hypotheses, never execution.
 * No recipe is synthesized from an unreviewed writer pair.
 */
const crypto=require('node:crypto');
const {DOMAINS,ADAPTERS}=require('./v34-experiment-registry');
const {domainForTable}=require('./v29-metadata-selector');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const normalizeFile=p=>String(p).replace(/\\/g,'/').replace(/^\.\/+/,'');
function discoverImpact(paths,discovery,census){
 if(!Array.isArray(paths)||!paths.length)throw Error('G3_SELECTOR_TOOL_ERROR: explicit impacted files required');
 if(discovery?.contract!=='komerce-metadata-driven-selection/v29'||
   !Array.isArray(discovery?.pairs?.reviewQueue)||
   !Array.isArray(census?.all))throw Error('G3_SELECTOR_TOOL_ERROR: grounded source discovery and census required');
 const files=[...new Set(paths.map(normalizeFile))].sort();
 if(files.some(f=>f.startsWith('../')||f.includes('/../')||!f||
  /[\0\r\n]/.test(f)))throw Error('G3_SELECTOR_TOOL_ERROR: invalid source path');
 const pairs=discovery.pairs.reviewQueue;
 const candidates=pairs.map(p=>{
  const sources=[p.ownerSource,...(p.actorSources||[])].filter(Boolean).map(normalizeFile);
  const sourceHits=sources.filter(s=>files.includes(s));
  const tableHits=files.filter(f=>f.includes(p.table)&&f.endsWith('.js'));
  const selected=sourceHits.length>0||tableHits.length>0;
  return {pairId:p.id,table:p.table,domain:p.domain||domainForTable(p.table,'',[]),
   priority:p.rankScore,selectionReason:sourceHits.length?'EXACT_WRITER_SOURCE_MATCH':
    tableHits.length?'TABLE_TOKEN_HEURISTIC':'NO_IMPACT_EVIDENCE',
   sourceHits,tableHits,selected,physicalStatus:'NOT_RUN',
   runtimeReachabilityProven:false,confirmedBug:false,
   fixtureAvailable:false};
 }).filter(c=>c.selected).sort((a,b)=>b.priority-a.priority||a.pairId.localeCompare(b.pairId));
 const impactedCards=census.all.filter(x=>files.includes(x.source));
 const impactedDomains=[...new Set([...candidates.map(c=>c.domain),...impactedCards.map(x=>x.domain)])]
   .filter(d=>DOMAINS.includes(d)).sort();
 return {files,candidates,impactedDomains,impactedCardInvariants:impactedCards.map(x=>x.id),
  unknownFiles:files.filter(f=>!pairs.some(p=>[p.ownerSource,...(p.actorSources||[])].includes(f))&&
   !census.all.some(x=>x.source===f))};
}
function plan({paths,discovery,census,budget=4}){
 if(!Number.isInteger(budget)||budget<1||budget>20)
  throw Error('G3_SELECTOR_TOOL_ERROR: budget must be 1..20');
 const impact=discoverImpact(paths,discovery,census);
 const selected=impact.candidates.slice(0,budget).map(c=>({
  ...c,decision:'REVIEW_REQUIRED',
  physicalExecutionAuthorized:false,
  missing:['CANONICAL_FIXTURE','INDEPENDENT_ORACLE','RUNTIME_REACHABILITY_PROOF']
 }));
 const omitted=impact.candidates.slice(budget).map(c=>({pairId:c.pairId,
  reason:'BUDGET_EXHAUSTED_NOT_COVERED'}));
 const compatible=ADAPTERS.filter(a=>a.domains.some(d=>impact.impactedDomains.includes(d)))
  .map(a=>({id:a.id,domains:a.domains,
   mode:'EXISTING_REVIEWED_ADAPTER_ELIGIBLE',
   automaticallySelectedForExecution:false}));
 const output={contract:'komerce-impacted-risk-plan/v36',
  sourceSha:discovery.sha,sourceSelectionHash:discovery.selectionHash,
  budget,impact,
  selected,omitted,compatibleReviewedAdapters:compatible,
  physicalExecutions:0,newGeneratedExperiments:0,
  allCandidatesRequireReview:true,
  invariantCoveragePercent:null,
  verdict:'STATIC_TRIAGE_ONLY',
  limits:'Source paths and writer names are not a runtime reachability or a valid independent oracle'};
 output.planHash=hash({sha:output.sourceSha,selectionHash:output.sourceSelectionHash,
  paths:impact.files,budget,selected:selected.map(x=>x.pairId),omitted:omitted.map(x=>x.pairId)});
 return output;
}
module.exports={discoverImpact,plan};
