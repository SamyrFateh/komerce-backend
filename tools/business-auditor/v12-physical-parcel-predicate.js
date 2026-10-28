'use strict';
/** Independent verdict over raw SQL witness, not test-authored Boolean claims. */
function assertInteger(x,name){
 if(!Number.isSafeInteger(x)||x<0)throw Error('TOOL_ERROR: nonnegative integer required: '+name);
}
function interpret(raw){
 if(raw?.contract!=='komerce-raw-pg-membership-witness/v12' ||
    raw.method!=='REAL_SERVICE_PG_TEMP_WRITES_WITH_STUBBED_LOOKUPS' ||
    raw.database!=='DISPOSABLE_LOCAL_POSTGRES_ONLY' ||
    raw.fullCanonicalSchemaStateProven!==false ||
    raw.multiSessionConcurrentProof!==false ||
    raw.productionIncidentConfirmed!==false ||
    !Array.isArray(raw.cases)||raw.cases.length!==2)
  throw Error('TOOL_ERROR: raw physical witness contract missing');
 const byId=Object.fromEntries(raw.cases.map(c=>[c.caseId,c]));
 if(Object.keys(byId).length!==2)throw Error('TOOL_ERROR: duplicate physical cases');
 const nominal=byId.NOMINAL_NEW_MEMBERSHIP,adverse=byId.CONFLICT_EXISTING_CANCELLED_MEMBERSHIP;
 if(!nominal||!adverse||nominal.preseed!==false||adverse.preseed!==true)
  throw Error('TOOL_ERROR: incorrect controlled scenarios');
 for(const c of [nominal,adverse]){
  for(const k of ['before','after','created','inTarget','reported'])assertInteger(c[k],k);
  if(!Array.isArray(c.affectedRows)||c.affectedRows.length!==1||
    !c.affectedRows.every(Number.isSafeInteger)||
    !Array.isArray(c.sqlKinds)||c.sqlKinds.length!==1||
    c.sqlKinds[0]!=='INSERT_MEMBERSHIP_CONFLICT_TOLERANT'||
    c.after-c.before!==c.created ||
    c.affectedRows[0]!==c.created ||
    c.inTarget!==c.created ||
    c.serviceSuccess!==true||c.transactionRolledBack!==true)
    throw Error('TOOL_ERROR: SQL witness is inconsistent or missing');
 }
 if(nominal.before!==0||adverse.before!==1||
    adverse.after!==1||adverse.created!==0||
    nominal.inTarget!==1||nominal.created!==1)
  throw Error('TOOL_ERROR: PG nominal/adversarial fixture calibration failed');
 const issues=[];
 if(nominal.reported!==nominal.created)issues.push({
  scenario:nominal.caseId,expected:nominal.created,observed:nominal.reported});
 if(adverse.reported!==adverse.created)issues.push({
  scenario:adverse.caseId,expected:adverse.created,observed:adverse.reported});
 return {contract:'komerce-physical-membership-oracle/v12',
  verdict:nominal.reported!==nominal.created?'NOMINAL_REGRESSION':
   issues.length?'REPRODUCED_PHYSICAL_PG_TEMP_INVARIANT_VIOLATION':'CONTROLLED_PHYSICAL_PG_TEMP_INVARIANT_SATISFIED',
  nominal:{physicalInserts:nominal.created,reported:nominal.reported},
  adverse:{physicalInserts:adverse.created,reported:adverse.reported},
  mismatches:issues,
  evidenceScope:'REAL_SERVICE_REAL_PG_TEMP_INSERT_STUBBED_OWNER_READS',
  actualCancellationTransitionExecuted:false,
  fullCanonicalSchemaStateProven:false,productionIncidentConfirmed:false};
}
module.exports={interpret};
