/** @komerce-arch-lite
 * @role g6-canonical-stage-n30-truth-oracle
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N30: oracle PG, même vérité et fixtures hors KPI commerciaux.
 * @impact-areas staging-only
 */
'use strict';
const id="N30_TRUTH_ORACLE";
const requires=Object.freeze(["N30_TRUTH_COMPARE"]);
const produces=Object.freeze(["n30_truth_oracle"]);
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
