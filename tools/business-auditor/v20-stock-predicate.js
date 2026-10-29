'use strict';
const {compareSchedules}=require('./v20-serial-kernel');
const {resultFingerprint}=require('./v19-serializability-predicate');
function stockFingerprint(s){
 if(!s||!Number.isSafeInteger(s.stock))
  throw Error('TOOL_ERROR: malformed SQL stock observation');
 return JSON.stringify({stock:s.stock});
}
function inspect(raw){
 if(raw?.contract!=='komerce-opus-stock-negative-control-raw/v20'||
  ![1,2].includes(raw.openingStock)||
  raw.allClonesDropped!==true||raw.noExternalPayments!==true||
  raw.productionIncidentConfirmed!==false||
  raw.dbIsolation!=='LOCAL_CANONICAL_TEMPLATE_CLONES'||
  !Array.isArray(raw.cases)||raw.cases.length!==4)
  throw Error('TOOL_ERROR: stock evidence incomplete');
 for(const c of raw.cases){
  if(!c.cloneDropped||c.before?.stock!==raw.openingStock||
   !Number.isSafeInteger(c.after?.stock)||c.after.stock<0)
   throw Error('TOOL_ERROR: physical stock fixture invalid or leaked');
  if(!Array.isArray(c.outcomes)||c.outcomes.length!==2)
   throw Error('TOOL_ERROR: stock owner outcomes absent');
 }
 const result=compareSchedules(raw.cases,{
  fingerprint:stockFingerprint,resultFingerprint,retryPolicy:null
 });
 const accepted=['NO_CONFLICT','SERIALIZED_BY_LOCK'];
 return {contract:'komerce-opus-negative-stock-oracle/v20',
  ...result,
  negativeControlPassed:accepted.includes(result.verdict),
  expectedGuardCode:'23514',
  atomicStockNeverNegative:raw.cases.every(c=>c.after.stock>=0),
  falsePositiveDetected:!accepted.includes(result.verdict),
  noProductionIncidentConfirmed:true};
}
module.exports={stockFingerprint,inspect};
