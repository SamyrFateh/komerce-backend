/** @komerce-arch-lite
 * @role g6-canonical-stage-n15-no-closure-oracle
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose N15: oracle PG en lecture seule, ni sac fermé, ni carton rempli, ni expédition non conforme.
 * @impact-areas staging-only
 */
'use strict';
const id="N15_NO_CLOSURE_ORACLE";
const requires=Object.freeze(["N15_BAG_BOX_INCOMPLETE"]);
const produces=Object.freeze(["n15_no_closure_oracle"]);
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
