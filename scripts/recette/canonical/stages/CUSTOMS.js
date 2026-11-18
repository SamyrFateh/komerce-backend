/** @komerce-arch-lite
 * @role g6-canonical-stage-customs
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Declarative stage contract for original Golden M01; business execution stays in the certified legacy runner until explicitly migrated.
 * @impact-areas staging-only
 */
'use strict';
const id="CUSTOMS";
const requires=Object.freeze(["FORWARDER"]);
const produces=Object.freeze(["customs_release","local_delivery"]);
const roles=Object.freeze(["responsable_marche","transitaire"]);
async function run(ctx){
 if(!ctx || typeof ctx.runCertifiedStage!=='function')throw Error('G6_STAGE_EXECUTOR_NOT_BOUND_'+id);
 return ctx.runCertifiedStage(id);
}
function validate(ctx,proof){
 if(!ctx || typeof ctx.validateCertifiedStage!=='function')throw Error('G6_STAGE_VALIDATOR_NOT_BOUND_'+id);
 return ctx.validateCertifiedStage(id,proof);
}
module.exports=Object.freeze({id,requires,produces,roles,run,validate});
