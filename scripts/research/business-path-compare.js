#!/usr/bin/env node
'use strict';

/**
 * Business Path Fingerprint — R&D ECO, pure evaluator.
 *
 * Not a business-rule engine. It compares already observed effects from two
 * semantically equivalent paths, under an explicitly supplied comparison oracle.
 * Results are HYPOTHESES until the intent equivalence is approved by the owner.
 *
 * Traces come from independent real-DB test execution, never parsed from log prose.
 * Keep branch-specific physical implementation details in trace.metadata, not
 * in the normalized decision/effect classes.
 */
function summarizePath(trace) {
  if (!trace || typeof trace !== 'object') throw new TypeError('Path trace object required');
  if (!trace.path || !trace.intent) throw new TypeError('Path and intent are required');
  if (!['ACCEPT','QUARANTINE','REJECT'].includes(trace.decision)) {
    throw new TypeError('Unknown canonical decision in path trace');
  }
  if (!Number.isInteger(trace.persistedAllocations) || trace.persistedAllocations < 0) {
    throw new TypeError('Independent persistedAllocations count required');
  }
  return {
    path: trace.path,
    intent: trace.intent,
    decision: trace.decision,
    reason: trace.decision === 'ACCEPT' ? null : String(trace.reason || ''),
    economicAllocationEffect: trace.persistedAllocations === 0 ? 'NONE' : 'PERSISTED',
  };
}

function compareEquivalentPaths({pairId,contractRefs=[],oracleApproval='UNAPPROVED',
  cases,comparedFields=['decision','reason','economicAllocationEffect']}) {
  if (!pairId || !Array.isArray(cases) || !cases.length) throw new TypeError('Nonempty pair and cases required');
  const results=[];
  for (const pair of cases) {
    const left=summarizePath(pair.left),right=summarizePath(pair.right);
    if (left.intent!==right.intent) throw new Error('Cannot compare different business intents');
    const differences=[];
    for (const field of comparedFields) {
      if (!['decision','reason','economicAllocationEffect'].includes(field)) {
        throw new TypeError('Unsupported comparison field: '+field);
      }
      if (left[field]!==right[field]) {
        differences.push({field,left:left[field],right:right[field]});
      }
    }
    results.push({
      intent:left.intent,
      left,right,differences,
      outcome:differences.length?'PATH_ASYMMETRY_HYPOTHESIS':'NO_PATH_ASYMMETRY_OBSERVED',
      rawEvidence:{left:pair.left,right:pair.right},
    });
  }
  return {
    schema:'komerce-business-path-fingerprint/v1',
    pairId,contractRefs,oracleApproval,
    evidenceType:'INPUT_NORMALIZED_REAL_DB_OBSERVATION',
    pathCount:2,caseCount:results.length,
    mismatchCount:results.filter(x=>x.differences.length).length,
    verdict:results.some(x=>x.differences.length)
      ? 'PATH_ASYMMETRY_HYPOTHESIS'
      : 'NO_PATH_ASYMMETRY_OBSERVED',
    results,
    limitations:[
      'A comparison assumes equivalence of intents, not automatic approval of that equivalence.',
      'This is the observed service segment, not end-to-end HTTP/custody/finance certification.',
      'Database effect classes are checked independently of response fields.',
    ],
  };
}
module.exports={summarizePath,compareEquivalentPaths};
