/** @komerce-arch-lite
 * @role g6-canonical-stage-n24-parallel-handoff
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N24: deux remises simultanées (deux onglets du même relais) de la même commande.
 * @impact-areas staging-only
 */
'use strict';
const id="N24_PARALLEL_HANDOFF";
const requires=Object.freeze(["LOCAL_RELAY_AVAILABLE"]);
const produces=Object.freeze(["n24_parallel_handoff"]);
const roles=Object.freeze(["client", "agent_relais"]);
async function run(ctx){
 if(!ctx || typeof ctx.runCertifiedStage!=='function')throw Error('G6_STAGE_EXECUTOR_NOT_BOUND_'+id);
 return ctx.runCertifiedStage(id);
}
function validate(ctx,proof){
 if(!ctx || typeof ctx.validateCertifiedStage!=='function')throw Error('G6_STAGE_VALIDATOR_NOT_BOUND_'+id);
 return ctx.validateCertifiedStage(id,proof);
}
module.exports=Object.freeze({id,requires,produces,roles,run,validate});
