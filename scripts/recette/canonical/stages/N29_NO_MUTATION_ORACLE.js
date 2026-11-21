/** @komerce-arch-lite
 * @role g6-canonical-stage-n29-no-mutation-oracle
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N29: oracle PG lecture seule, aucune mutation.
 * @impact-areas staging-only
 */
'use strict';
const id="N29_NO_MUTATION_ORACLE";
const requires=Object.freeze(["N29_SESSION_ROLE_ATTEMPTS"]);
const produces=Object.freeze(["n29_no_mutation_oracle"]);
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
