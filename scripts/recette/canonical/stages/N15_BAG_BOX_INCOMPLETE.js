/** @komerce-arch-lite
 * @role g6-canonical-stage-n15-bag-box-incomplete
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose N15: fermeture du sac et de la KOM-BOX avec une ligne manquante, puis départ non conforme, par l'écran Hub.
 * @impact-areas staging-only
 */
'use strict';
const id="N15_BAG_BOX_INCOMPLETE";
const requires=Object.freeze(["HUB_RECEIVING_READBACK"]);
const produces=Object.freeze(["n15_bag_box_incomplete"]);
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
