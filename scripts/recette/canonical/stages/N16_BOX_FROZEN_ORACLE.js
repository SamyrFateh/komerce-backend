/** @komerce-arch-lite
 * @role g6-canonical-stage-n16-box-frozen-oracle
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose N16: oracle PG en lecture seule, carton non remis, composition inchangée.
 * @impact-areas staging-only
 */
'use strict';
const id="N16_BOX_FROZEN_ORACLE";
const requires=Object.freeze(["N16_BOX_NOT_DISPATCHED_FROZEN"]);
const produces=Object.freeze(["n16_box_frozen_oracle"]);
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
