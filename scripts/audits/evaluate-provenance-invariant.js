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
function evaluateAuthorityTrace({
  entity, field, sourceField, scanField = null, scanSemantics = 'unclassified',
  manualMarker = 'manual', preservedThrough = 'supplier_reimport',
  sequence, expectedAuthority = 'manual',
}) {
  if (!entity || !field || !sourceField || !Array.isArray(sequence)) {
    return { verdict:'INSUFFICIENT_EVIDENCE', violations:[], observations:[],
      reason:'Entity, field, sourceField and sequence required' };
  }
  if (scanSemantics !== 'unclassified' && scanSemantics !== 'effective') {
    return { verdict:'INSUFFICIENT_EVIDENCE', violations:[], observations:[],
      reason:'scanSemantics must be unclassified or effective' };
  }
  let pinned, manualAssertion = false;
  const violations = [], observations = [];
  for (let i = 0; i < sequence.length; i++) {
    const event = sequence[i], now = event.snapshot, at = event.id ?? i;
    if (event.action === 'human_override') {
      if (!now || now[sourceField] !== manualMarker) {
        observations.push({kind:'HUMAN_EDIT_WITHOUT_MANUAL_PROVENANCE',at});
        continue;
      }
      pinned = now[field];
      manualAssertion = true;
      if (pinned === undefined || pinned === null) {
        return {entity,field,verdict:'INSUFFICIENT_EVIDENCE',violations,observations,
          reason:'Manual value not available after latest human edit'};
      }
      continue; // A later human edit legitimately supersedes an earlier edit.
    }
    if (!manualAssertion || event.action !== preservedThrough) continue;
    if (!now) {
      violations.push({kind:'MISSING_POST_ACTION_EVIDENCE',at});
      continue;
    }
    if (!util.isDeepStrictEqual(now[sourceField], expectedAuthority)) {
      violations.push({kind:'AUTHORITY_MARKER_OVERWRITTEN',at,
        expected:expectedAuthority,actual:now[sourceField]});
    }
    if (!util.isDeepStrictEqual(now[field], pinned)) {
      violations.push({kind:'MANUAL_VALUE_OVERWRITTEN',at,
        expected:pinned,actual:now[field]});
    }
    if (scanField && now[scanField] != null
      && !util.isDeepStrictEqual(now[scanField],now[field])) {
      const difference = {at,expected:now[field],actual:now[scanField]};
      // A snapshot of the raw supplier observation is ALLOWED to differ from
      // an effective/manual candidate value. It is only an invariant failure
      // when the governance contract declares the scan field "effective".
      if (scanSemantics === 'effective') {
        violations.push({kind:'DERIVED_SCAN_DISAGREES_WITH_PERSISTED_FIELD',...difference});
      } else {
        observations.push({kind:'SOURCE_SCAN_DIFFERS_FROM_EFFECTIVE_VALUE',
          classification:'REVIEW_REQUIRED',...difference});
      }
    }
  }
  if (!manualAssertion) {
    return {entity,field,verdict:'NO_MANUAL_ASSERTION',violations:[],observations,
      reason:'No explicit authoritative human edit; supplier refresh is allowed'};
  }
  return {entity,field,sourceField,manualMarker,expectedAuthority,manualValue:pinned,
    verdict:violations.length?'CONTRADICTION_OBSERVED':'INVARIANT_OBSERVED',
    firstViolation:violations[0]||null,violations,observations};
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
