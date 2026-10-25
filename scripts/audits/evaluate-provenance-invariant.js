#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role          provenance-precedence-invariant-checker
 * @domain        infrastructure
 * @layer         tooling
 * @criticality   high
 * @inputs        observed snapshots from a disposable PostgreSQL test
 * @outputs       actionable first conflict (value, owner, provenance, scan)
 * @depends       none
 * @used-by       .github/workflows/governance-sourcing-reimport-poc.yml
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      do_not_invent_authority, preserve_manual_overrides, show_first_failure
 */
const fs = require('node:fs');
const util = require('node:util');

/** Pure evaluator: can check ANY manually owned field in ANY tracked entity.
 * No SQL heuristics, no hardcoded margin number, no product/supplier knowledge.
 *
 * The proof contract is external: snapshots reflect actual persisted facts.
 * By itself this helper cannot determine whether a manual field should be
 * immutable forever — caller MUST supply the governance authority contract.
 */
function evaluateAuthorityTrace({ entity, field, sourceField, scanField = null,
  manualMarker = 'manual', preservedThrough = 'supplier_reimport',
  sequence, expectedAuthority = 'manual' }) {
  if (!entity || !field || !sourceField || !Array.isArray(sequence)) {
    return { verdict:'INSUFFICIENT_EVIDENCE', violations:[], reason:'Entity, field, sourceField and sequence required' };
  }
  const manualIndex = sequence.findIndex(x => x.action === 'human_override'
    && x.snapshot && x.snapshot[sourceField] === manualMarker);
  if (manualIndex < 0) {
    return { entity, field, verdict:'NO_MANUAL_ASSERTION', violations:[],
      reason:'No explicit manual edit event: routine supplier refresh can update its own fields' };
  }
  const pinned = sequence[manualIndex].snapshot[field];
  if (pinned === undefined || pinned === null) {
    return { entity, field, verdict:'INSUFFICIENT_EVIDENCE', violations:[],
      reason:'Manual value was not observed in the source database' };
  }
  const violations=[];
  for(let i=manualIndex+1;i<sequence.length;i++){
    const event=sequence[i],now=event.snapshot;
    if(event.action==='human_override')continue; // A newer human edit may reauthor the value.
    if(event.action!==preservedThrough)continue; // Rule is scoped to supplier refresh only.
    if(!now){
      violations.push({kind:'MISSING_POST_ACTION_EVIDENCE',at:event.id||i});
      continue;
    }
    if(!util.isDeepStrictEqual(now[sourceField],expectedAuthority)){
      violations.push({kind:'AUTHORITY_MARKER_OVERWRITTEN',at:event.id||i,
        expected:expectedAuthority,actual:now[sourceField]});
    }
    if(!util.isDeepStrictEqual(now[field],pinned)){
      violations.push({kind:'MANUAL_VALUE_OVERWRITTEN',at:event.id||i,
        expected:pinned,actual:now[field]});
    }
    if(scanField && now[scanField]!=null && !util.isDeepStrictEqual(now[scanField],now[field])){
      violations.push({kind:'DERIVED_SCAN_DISAGREES_WITH_PERSISTED_FIELD',at:event.id||i,
        expected:now[field],actual:now[scanField]});
    }
  }
  return { entity,field,sourceField,manualMarker,expectedAuthority,manualValue:pinned,
    verdict:violations.length?'CONTRADICTION_OBSERVED':'INVARIANT_OBSERVED',
    firstViolation:violations[0]||null,violations };
}

function fromPocProof(p){
 const { before,manual,afterFirst,afterSecond }=p;
 if(!before||!manual||!afterFirst||!afterSecond)throw Error('Incomplete PostgreSQL proof');
 const snap=o=>({margin:o.margin,source:o.marginProvenance,scan:o.scanMargin});
 return evaluateAuthorityTrace({
  entity:manual.id,field:'margin',sourceField:'source',scanField:'scan',
  expectedAuthority:'manual',
  sequence:[
   {id:'supplier_initial',action:'supplier_reimport',snapshot:snap(before)},
   {id:'human_override',action:'human_override',snapshot:snap(manual)},
   {id:'first_reimport',action:'supplier_reimport',snapshot:snap(afterFirst)},
   {id:'second_reimport',action:'supplier_reimport',snapshot:snap(afterSecond)},
  ]
 });
}
function cli(){
 const [input,output]=process.argv.slice(2);
 if(!input||!output)throw Error('Usage: node evaluate-provenance-invariant.js <observed.json> <result.json>');
 const proof=JSON.parse(fs.readFileSync(input,'utf8')),result=fromPocProof(proof);
 fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
 console.log('GOV_POC_GENERIC_RULE',JSON.stringify(result));
 if(result.verdict!=='INVARIANT_OBSERVED')process.exitCode=1;
}
if(require.main===module)cli();
module.exports={evaluateAuthorityTrace,fromPocProof};
