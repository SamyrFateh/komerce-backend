/** @komerce-arch-lite
 * @role g6-canonical-stage-hub-shipment
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Declarative stage contract for original Golden M01; business execution stays in the certified legacy runner until explicitly migrated.
 * @impact-areas staging-only
 */
'use strict';
const id="HUB_SHIPMENT";
const requires=Object.freeze(["HUB_KOM_BOX"]);
const produces=Object.freeze(["shipment"]);
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
