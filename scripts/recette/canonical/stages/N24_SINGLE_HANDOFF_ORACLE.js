/** @komerce-arch-lite
 * @role g6-canonical-stage-n24-single-handoff-oracle
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N24: oracle PG lecture seule, une seule attestation de remise.
 * @impact-areas staging-only
 */
'use strict';
const id="N24_SINGLE_HANDOFF_ORACLE";
const requires=Object.freeze(["N24_PARALLEL_HANDOFF"]);
const produces=Object.freeze(["n24_single_handoff_oracle"]);
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
