/** @komerce-arch-lite
 * @role g6-canonical-stage-n23-withdrawal-attempts
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N23: retrait refusé sans code, avec 4 chiffres, avec codes erronés puis force brute au comptoir Remises.
 * @impact-areas staging-only
 */
'use strict';
const id="N23_WITHDRAWAL_ATTEMPTS";
const requires=Object.freeze(["LOCAL_RELAY_AVAILABLE"]);
const produces=Object.freeze(["n23_withdrawal_attempts"]);
const roles=Object.freeze(["client", "agent_relais"]);
async function run(ctx){
 if(!ctx || typeof ctx.runCertifiedStage!=='function')throw Error('G6_STAGE_EXECUTOR_NOT_BOUND_'+id);
 return ctx.runCertifiedStage(id);
}
function validate(ctx,proof){
 if(!ctx || typeof ctx.validateCertifiedStage!=='function')throw Error('G6_STAGE_VALIDATOR_NOT_BOUND_'+id);
 return ctx.validateCertifiedStage(id,proof);
}
module.exports=Object.freeze({id,requires,produces,roles,run,validate});
