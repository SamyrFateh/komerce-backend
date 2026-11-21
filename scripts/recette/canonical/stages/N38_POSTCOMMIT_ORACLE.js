/** @komerce-arch-lite
 * @role g6-canonical-stage-n38-postcommit-oracle
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N38: oracle PG lecture seule, événement conservé et reprise sans angle mort.
 * @impact-areas staging-only
 */
'use strict';
const id="N38_POSTCOMMIT_ORACLE";
const requires=Object.freeze(["N38_RESUME_DRY_RUN"]);
const produces=Object.freeze(["n38_postcommit_oracle"]);
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
