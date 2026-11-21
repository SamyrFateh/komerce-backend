/** @komerce-arch-lite
 * @role g6-canonical-stage-n19-local-transport-delay-loss
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N19: retard puis perte du transport local, réception relais à quantité nulle par l écran.
 * @impact-areas staging-only
 */
'use strict';
const id="N19_LOCAL_TRANSPORT_DELAY_LOSS";
const requires=Object.freeze(["CUSTOMS"]);
const produces=Object.freeze(["n19_local_transport_delay_loss"]);
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
