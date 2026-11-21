/** @komerce-arch-lite
 * @role g6-canonical-stage-n38-resume-dry-run
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N38: reprise documentaire en dry run (aucune émission).
 * @impact-areas staging-only
 */
'use strict';
const id="N38_RESUME_DRY_RUN";
const requires=Object.freeze(["CLIENT_PICKUP"]);
const produces=Object.freeze(["n38_resume_dry_run"]);
const roles=Object.freeze(["admin"]);
async function run(ctx){
 if(!ctx || typeof ctx.runCertifiedStage!=='function')throw Error('G6_STAGE_EXECUTOR_NOT_BOUND_'+id);
 return ctx.runCertifiedStage(id);
}
function validate(ctx,proof){
 if(!ctx || typeof ctx.validateCertifiedStage!=='function')throw Error('G6_STAGE_VALIDATOR_NOT_BOUND_'+id);
 return ctx.validateCertifiedStage(id,proof);
}
module.exports=Object.freeze({id,requires,produces,roles,run,validate});
