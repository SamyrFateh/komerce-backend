/** @komerce-arch-lite
 * @role g6-canonical-stage-n34-explicit-source
 * @domain sourcing
 * @layer test
 * @owner backend-core
 * @purpose N34 actual independent browser/API/PG proof; no alias to M01 or synthetic success.
 * @impact-areas staging-only
 */
'use strict';
const id="N34_EXPLICIT_SOURCE";
const requires=Object.freeze(["N34_CENTRAL_IMMUTABILITY"]);
const produces=Object.freeze(["n34b_source_proof"]);
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
