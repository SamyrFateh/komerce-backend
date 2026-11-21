/** @komerce-arch-lite
 * @role g6-canonical-stage-n18-hold-release-oracle
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N18: oracle PG lecture seule, aucun transit entre retenue et mainlevée.
 * @impact-areas staging-only
 */
'use strict';
const id="N18_HOLD_RELEASE_ORACLE";
const requires=Object.freeze(["N18_CUSTOMS_HOLD_ATTEMPTS"]);
const produces=Object.freeze(["n18_hold_release_oracle"]);
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
