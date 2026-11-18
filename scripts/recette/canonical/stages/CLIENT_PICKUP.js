/** @komerce-arch-lite
 * @role g6-canonical-stage-client-pickup
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Declarative stage contract for original Golden M01; business execution stays in the certified legacy runner until explicitly migrated.
 * @impact-areas staging-only
 */
'use strict';
const id="CLIENT_PICKUP";
const requires=Object.freeze(["RELAY_RECEIPT"]);
const produces=Object.freeze(["pickup_scan"]);
const roles=Object.freeze(["client","agent_relais"]);
async function run(ctx){
 if(!ctx || typeof ctx.runCertifiedStage!=='function')throw Error('G6_STAGE_EXECUTOR_NOT_BOUND_'+id);
 return ctx.runCertifiedStage(id);
}
function validate(ctx,proof){
 if(!ctx || typeof ctx.validateCertifiedStage!=='function')throw Error('G6_STAGE_VALIDATOR_NOT_BOUND_'+id);
 return ctx.validateCertifiedStage(id,proof);
}
module.exports=Object.freeze({id,requires,produces,roles,run,validate});
