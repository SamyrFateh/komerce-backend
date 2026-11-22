/** @komerce-arch-lite
 * @role g6-canonical-stage-n34-central-immutability
 * @domain sourcing
 * @layer test
 * @owner backend-core
 * @purpose N34 actual independent browser/API/PG proof; no alias to M01 or synthetic success.
 * @impact-areas staging-only
 */
'use strict';
const id="N34_CENTRAL_IMMUTABILITY";
const requires=Object.freeze([]);
const produces=Object.freeze(["n34a_negative_proof"]);
const roles=Object.freeze(["admin","system_readonly"]);
async function run(ctx){
 if(!ctx||typeof ctx.runCertifiedStage!=='function')throw Error('G6_STAGE_EXECUTOR_NOT_BOUND_'+id);
 return ctx.runCertifiedStage(id);
}
function validate(ctx,proof){
 if(!ctx||typeof ctx.validateCertifiedStage!=='function')throw Error('G6_STAGE_VALIDATOR_NOT_BOUND_'+id);
 return ctx.validateCertifiedStage(id,proof);
}
module.exports=Object.freeze({id,requires,produces,roles,run,validate});
