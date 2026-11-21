/** @komerce-arch-lite
 * @role g6-canonical-stage-n14-receiving-qty-attempts
 * @domain purchasing
 * @layer test
 * @owner backend-core
 * @purpose N14: réception Hub en excès, négative ou nulle refusée, puis réception exacte par l'écran.
 * @impact-areas staging-only
 */
'use strict';
const id="N14_RECEIVING_QTY_ATTEMPTS";
const requires=Object.freeze(["HUB_VENDOR_SIMULATION"]);
const produces=Object.freeze(["n14_receiving_qty_attempts"]);
const roles=Object.freeze(["agent_hub"]);
async function run(ctx){
 if(!ctx || typeof ctx.runCertifiedStage!=='function')throw Error('G6_STAGE_EXECUTOR_NOT_BOUND_'+id);
 return ctx.runCertifiedStage(id);
}
function validate(ctx,proof){
 if(!ctx || typeof ctx.validateCertifiedStage!=='function')throw Error('G6_STAGE_VALIDATOR_NOT_BOUND_'+id);
 return ctx.validateCertifiedStage(id,proof);
}
module.exports=Object.freeze({id,requires,produces,roles,run,validate});
