/** @komerce-arch-lite
 * @role g6-canonical-stage-n22-two-relays-attempts
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N22: relais A et B du même marché, mêmes assertions que N21 dans les deux sens.
 * @impact-areas staging-only
 */
'use strict';
const id="N22_TWO_RELAYS_ATTEMPTS";
const requires=Object.freeze(["LOCAL_RELAY_AVAILABLE"]);
const produces=Object.freeze(["n22_two_relays_attempts"]);
const roles=Object.freeze(["client", "agent_relais", "admin"]);
async function run(ctx){
 if(!ctx || typeof ctx.runCertifiedStage!=='function')throw Error('G6_STAGE_EXECUTOR_NOT_BOUND_'+id);
 return ctx.runCertifiedStage(id);
}
function validate(ctx,proof){
 if(!ctx || typeof ctx.validateCertifiedStage!=='function')throw Error('G6_STAGE_VALIDATOR_NOT_BOUND_'+id);
 return ctx.validateCertifiedStage(id,proof);
}
module.exports=Object.freeze({id,requires,produces,roles,run,validate});
