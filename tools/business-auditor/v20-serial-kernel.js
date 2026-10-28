'use strict';
/**
 * Domain-neutral serializability kernel. Adapter supplies two projections:
 * physical state and actor outcomes. Both must match ONE serial schedule.
 * A sequential replay must be stable before race classification is allowed.
 */
function compareSchedules(cases,{fingerprint,resultFingerprint,retryPolicy=null}){
 if(!Array.isArray(cases)||cases.length!==4||
  !['AB','AB_REPEAT','BA','PARALLEL'].every((m,i)=>cases[i]?.mode===m))
  throw Error('TOOL_ERROR: require AB, AB_REPEAT, BA, PARALLEL');
 if(typeof fingerprint!=='function'||typeof resultFingerprint!=='function')
  throw Error('TOOL_ERROR: missing explicit state and result projection');
 for(const c of cases)if(!Array.isArray(c.outcomes)||c.outcomes.length!==2||
  !c.after||!c.before)throw Error('TOOL_ERROR: incomplete schedule evidence');
 const signature=c=>JSON.stringify({
  state:fingerprint(c.after),outcomes:resultFingerprint(c.outcomes)
 });
 const [ab,abPrime,ba,parallel]=cases.map(signature);
 const deterministic=ab===abPrime;
 const matchAB=deterministic&&parallel===ab,matchBA=deterministic&&parallel===ba;
 const raceErrors=cases[3].outcomes.filter(x=>x.status==='rejected')
  .map(x=>x.code||'UNCLASSIFIED');
 const serialErrors=[...cases[0].outcomes,...cases[2].outcomes]
  .filter(x=>x.status==='rejected').map(x=>x.code||'UNCLASSIFIED');
 const declared=retryPolicy?.declared===true&&
  typeof retryPolicy.source==='string'&&retryPolicy.source.length>0&&
  Array.isArray(retryPolicy.codes)&&retryPolicy.codes.length>0;
 const replayable=declared&&raceErrors.length>0&&raceErrors.every(c=>
  ['40001','40P01'].includes(c)&&retryPolicy.codes.includes(c));
 const newFailure=raceErrors.length>0&&!matchAB&&!matchBA;
 const verdict=!deterministic?'NONDETERMINISTIC_FIXTURE':
  (matchAB||matchBA)?(cases[3].gate?.serialized?'SERIALIZED_BY_LOCK':'NO_CONFLICT'):
  newFailure?(replayable?'RETRYABLE':'NON_SERIALIZABLE_FAILURE'):
  'NON_SERIALIZABLE';
 return {verdict,deterministic,matchAB,matchBA,
  signatures:{AB:ab,AB_REPEAT:abPrime,BA:ba,parallel},
  lockObserved:cases[3].gate?.serialized===true,
  raceErrors,serialErrors,constrainedFailure:raceErrors.some(x=>/^23/.test(x)),
  retryPolicyDeclared:declared,retrySuggested:verdict==='RETRYABLE'};
}
module.exports={compareSchedules};
