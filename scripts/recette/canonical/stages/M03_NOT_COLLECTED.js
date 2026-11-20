/** @komerce-arch-lite
 * @role g6-canonical-stage-m03-not-collected
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose M03 key oracle (read-only PG): after the local part is handed over the mixed order is NOT collected.
 * @impact-areas staging-only
 */
'use strict';
const id="M03_NOT_COLLECTED";
const requires=Object.freeze(["LOCAL_CLIENT_PICKUP"]);
const produces=Object.freeze(["m03_not_collected_oracle"]);
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
