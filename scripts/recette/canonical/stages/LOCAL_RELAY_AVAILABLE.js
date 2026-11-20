/** @komerce-arch-lite
 * @role g6-canonical-stage-local-relay-available
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Declarative stage contract for M02 (LOCAL_STOCK): relay makes the paid order available on its own screen, no Hub.
 * @impact-areas staging-only
 */
'use strict';
const id="LOCAL_RELAY_AVAILABLE";
const requires=Object.freeze(["RELAY_CASH"]);
const produces=Object.freeze(["local_relay_receipt"]);
const roles=Object.freeze(["agent_relais"]);
async function run(ctx){
 if(!ctx || typeof ctx.runCertifiedStage!=='function')throw Error('G6_STAGE_EXECUTOR_NOT_BOUND_'+id);
 return ctx.runCertifiedStage(id);
}
function validate(ctx,proof){
 if(!ctx || typeof ctx.validateCertifiedStage!=='function')throw Error('G6_STAGE_VALIDATOR_NOT_BOUND_'+id);
 return ctx.validateCertifiedStage(id,proof);
}
module.exports=Object.freeze({id,requires,produces,roles,run,validate});
