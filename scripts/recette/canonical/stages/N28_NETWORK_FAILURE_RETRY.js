/** @komerce-arch-lite
 * @role g6-canonical-stage-n28-network-failure-retry
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N28: échec réseau ou 500 puis réessai par l écran, sans faux succès ni double mutation.
 * @impact-areas staging-only
 */
'use strict';
const id="N28_NETWORK_FAILURE_RETRY";
const requires=Object.freeze(["LOCAL_RELAY_AVAILABLE"]);
const produces=Object.freeze(["n28_network_failure_retry"]);
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
