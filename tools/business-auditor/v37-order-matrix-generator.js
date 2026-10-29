'use strict';
/**
 * G3b pilot: policy declared independently of the service under test.
 * The generator is blind to mutation controls, source code and observed results.
 */
const crypto=require('node:crypto');
const POLICY=Object.freeze({
 contract:'komerce-independent-order-patch-policy/v37',
 sourceStatus:'confirmed',
 roles:Object.freeze(['admin','agent_hub','agent_relais','client']),
 targets:Object.freeze(['ordered','preparation','shipped','available','refunded','pending']),
 allowedTargetsByRole:Object.freeze({
  admin:Object.freeze(['ordered']),
  agent_hub:Object.freeze(['ordered']),
  agent_relais:Object.freeze([]),
  client:Object.freeze([])
 }),
 blockedEffects:'status_and_history_unchanged',
 sourceNotDerivedFromApplicationCode:true
});
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function fail(m){throw Error('V37_GENERATOR_TOOL_ERROR: '+m)}
function generate(seed='case-1',policy=POLICY){
 if(typeof seed!=='string'||seed.length>128||!seed.length)fail('invalid deterministic seed');
 if(policy.contract!==POLICY.contract||policy.sourceStatus!=='confirmed'||
  !Array.isArray(policy.roles)||!Array.isArray(policy.targets))
  fail('policy shape/source not certified');
 const cases=[];
 for(const role of policy.roles)
  for(const target of policy.targets){
   const id='ORD-PATCH-'+hash({role,target,seed}).slice(0,14);
   cases.push({id,sourceStatus:policy.sourceStatus,target,role,source:'patch',
    expected:policy.allowedTargetsByRole[role]?.includes(target)?'TRANSITION':'REJECT'});
  }
 if(cases.length<12||new Set(cases.map(x=>x.id)).size!==cases.length)fail('matrix incomplete');
 // Stable seeded ordering, no random I/O or fixture-specific handpicking.
 cases.sort((a,b)=>hash(seed+'|'+a.id).localeCompare(hash(seed+'|'+b.id)));
 const plan={contract:'komerce-order-patch-generated-matrix/v37',
  seed,policyHash:hash(policy),cases,
  safety:{newOwnerFixturePerCase:true,untrustedCodeNotExecuted:true,
   noPspOrNetwork:true,testDbRequired:true},
  sourceMutantKnownToGenerator:false};
 return {...plan,selectionHash:hash(plan)};
}
function evaluate(plan,rows){
 if(plan?.contract!=='komerce-order-patch-generated-matrix/v37'||
  !/^[a-f0-9]{64}$/.test(plan.selectionHash||'')||
  !Array.isArray(rows)||rows.length!==plan.cases.length)
  fail('missing evidence or plan shape');
 const byId=new Map(rows.map(x=>[x.id,x]));
 if(byId.size!==rows.length)fail('duplicate observed scenario');
 const signals=[],results=[];
 for(const c of plan.cases){
  const actual=byId.get(c.id);
  if(!actual||actual.sourceStatus!==c.sourceStatus||actual.target!==c.target||
   actual.role!==c.role||actual.initialStatus!=='confirmed'||
   actual.initialHistory!==0||typeof actual.ownerSuccess!=='boolean')
   fail('scenario provenance missing '+c.id);
  const shouldPass=c.expected==='TRANSITION';
  const expectedState=shouldPass?'ordered':'confirmed';
  const expectedHistory=shouldPass?1:0;
  const statusOk=actual.finalStatus===expectedState;
  const auditOk=actual.finalHistory===expectedHistory&&
   (shouldPass?actual.finalHistoryStatus==='ordered':actual.finalHistoryStatus===null);
  const timestampOk=shouldPass?actual.orderedTimestampPresent===true:
   actual.orderedTimestampPresent===false;
  const ownerOk=actual.ownerSuccess===shouldPass;
  const codes=[];
  if(!statusOk)codes.push('ORDG1_UNAUTHORIZED_OR_MISSING_STATUS_TRANSITION');
  if(!auditOk)codes.push('ORDG2_AUDIT_HISTORY_MISMATCH');
  if(!timestampOk)codes.push('ORDG3_TIMESTAMP_INCONSISTENT');
  if(!ownerOk)codes.push('ORDG4_OWNER_RESPONSE_DIFFERS_FROM_POLICY');
  if(codes.length)signals.push({scenarioId:c.id,role:c.role,target:c.target,codes});
  results.push({scenarioId:c.id,role:c.role,target:c.target,expected:c.expected,
   observed:actual.finalStatus,signals:codes});
 }
 return {contract:'komerce-independent-generated-order-oracle/v37',
  scenarios:plan.cases.length,violations:signals,violation:signals.length>0,
  accepted:results.filter(x=>x.expected==='TRANSITION').length,
  rejected:results.filter(x=>x.expected==='REJECT').length,
  results,policyHash:plan.policyHash,
  independentOfOwnerImplementation:true};
}
module.exports={POLICY,generate,evaluate};
