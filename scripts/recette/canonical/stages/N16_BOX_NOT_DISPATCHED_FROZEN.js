/** @komerce-arch-lite
 * @role g6-canonical-stage-n16-box-not-dispatched-frozen
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose N16: remise d'un carton non DISPATCHED refusée, puis composition figée après expédition du Hub, par l'écran Hub.
 * @impact-areas staging-only
 */
'use strict';
const id="N16_BOX_NOT_DISPATCHED_FROZEN";
const requires=Object.freeze(["HUB_KOM_BOX"]);
const produces=Object.freeze(["n16_box_not_dispatched_frozen"]);
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
