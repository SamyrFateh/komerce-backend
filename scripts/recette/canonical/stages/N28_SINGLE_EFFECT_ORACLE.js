/** @komerce-arch-lite
 * @role g6-canonical-stage-n28-single-effect-oracle
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N28: oracle PG lecture seule, une seule remise.
 * @impact-areas staging-only
 */
'use strict';
const id="N28_SINGLE_EFFECT_ORACLE";
const requires=Object.freeze(["N28_NETWORK_FAILURE_RETRY"]);
const produces=Object.freeze(["n28_single_effect_oracle"]);
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
