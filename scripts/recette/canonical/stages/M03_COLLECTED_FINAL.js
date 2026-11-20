/** @komerce-arch-lite
 * @role g6-canonical-stage-m03-collected-final
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose M03 final oracle (read-only PG): the order becomes collected only after the import lines are handed over.
 * @impact-areas staging-only
 */
'use strict';
const id="M03_COLLECTED_FINAL";
const requires=Object.freeze(["CLIENT_PICKUP","M03_NOT_COLLECTED"]);
const produces=Object.freeze(["m03_collected_final_oracle"]);
const roles=Object.freeze(["system_readonly"]);
async function run(ctx){
 if(!ctx || typeof ctx.runCertifiedStage!=='function')throw Error('G6_STAGE_EXECUTOR_NOT_BOUND_'+id);
 return ctx.runCertifiedStage(id);
}
function validate(ctx,proof){
 if(!ctx || typeof ctx.validateCertifiedStage!=='function')throw Error('G6_STAGE_VALIDATOR_NOT_BOUND_'+id);
 return ctx.validateCertifiedStage(id,proof);
}
module.exports=Object.freeze({id,requires,produces,roles,run,validate});
