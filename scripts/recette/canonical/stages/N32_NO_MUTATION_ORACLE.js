/** @komerce-arch-lite
 * @role g6-canonical-stage-n32-no-mutation-oracle
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N32: oracle PG lecture seule, aucune mutation inter-marché ni inter-rôle.
 * @impact-areas staging-only
 */
'use strict';
const id="N32_NO_MUTATION_ORACLE";
const requires=Object.freeze(["N32_CROSS_MARKET_ROLES"]);
const produces=Object.freeze(["n32_no_mutation_oracle"]);
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
