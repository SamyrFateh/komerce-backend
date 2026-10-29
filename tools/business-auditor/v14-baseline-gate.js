'use strict';
/**
 * Explicitly-reviewed outcome baseline. A known defect becoming fixed is
 * desirable, but its disappearance is not silently auto-certified.
 */
function compare(baseline,verdict){
 if(baseline?.contract!=='komerce-business-exploration-baseline/v14'||
   verdict?.contract!=='komerce-business-sequence-exploration-verdict/v14')
  throw Error('TOOL_ERROR: missing exploratory contract');
 const expected=baseline.expected||{};
 const actual={plannedCases:verdict.plannedCases,evaluatedSteps:verdict.evaluatedSteps,
  knownFamilySignals:verdict.knownFamilySignals,
  candidateNewFamilySignals:verdict.candidateNewFamilySignals,
  exceptions:verdict.exceptions?.length,
  signalCounts:verdict.signalCounts};
 const changed=[];
 for(const key of ['plannedCases','evaluatedSteps','knownFamilySignals','candidateNewFamilySignals','exceptions']){
  if(actual[key]!==expected[key])changed.push({key,old:expected[key],new:actual[key]});
 }
 const keys=[...new Set([...Object.keys(expected.signalCounts||{}),...Object.keys(actual.signalCounts||{})])].sort();
 for(const key of keys)if((expected.signalCounts?.[key]||0)!==(actual.signalCounts?.[key]||0))
  changed.push({key:'rule:'+key,old:expected.signalCounts?.[key]||0,new:actual.signalCounts?.[key]||0});
 return {contract:'komerce-business-exploration-baseline-gate/v14',
  verdict:changed.length?'REVIEW_REQUIRED':'NO_BASELINE_DRIFT',
  changes:changed,productionIncidentConfirmed:false,
  note:'Baseline stability is not evidence of absence of unknown defects'};
}
module.exports={compare};
