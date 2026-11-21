/** @komerce-arch-lite
 * @role g6-canonical-stage-n25-single-intake-oracle
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N25: oracle PG lecture seule, une reprise, aucune compensation, stock inchangé.
 * @impact-areas staging-only
 */
'use strict';
const id="N25_SINGLE_INTAKE_ORACLE";
const requires=Object.freeze(["N25_SAV_DOUBLE_INTAKE"]);
const produces=Object.freeze(["n25_single_intake_oracle"]);
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
