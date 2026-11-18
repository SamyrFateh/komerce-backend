/** @komerce-arch-lite
 * @role g6-canonical-cadence-gate
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose G0c staging request cadence; reject early instead of hiding 429 as a PASS.
 * @impact-areas staging-only
 */
'use strict';
const MIN_GAPS=Object.freeze({order:12000,pickup:20000,cash:30000});
class CadenceGate{
 constructor(){this.last=new Map()}
 reserve(kind,at=Date.now()){
  if(!Object.prototype.hasOwnProperty.call(MIN_GAPS,kind)||!Number.isFinite(at))
   throw Error('G6_CADENCE_EVENT_INVALID');
  const last=this.last.get(kind);
  if(last!==undefined&&at-last<MIN_GAPS[kind])
   throw Error('G6_CADENCE_NOT_READY_'+kind);
  this.last.set(kind,at);
  return{event:kind,at,minimum_gap_ms:MIN_GAPS[kind]};
 }
 assertResponse(status){
  if(status===429)throw Error('G6_RATE_LIMIT_429_NOT_PROVEN');
  if(!Number.isInteger(status)||status<100||status>599)throw Error('G6_HTTP_STATUS_INVALID');
 }
}
module.exports={CadenceGate,MIN_GAPS};
