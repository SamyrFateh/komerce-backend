/** @komerce-arch-lite
 * @role g6-canonical-stage-n23-security-oracle
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N23: oracle PG lecture seule, aucune remise, compteur de sécurité de l'agent.
 * @impact-areas staging-only
 */
'use strict';
const id="N23_SECURITY_ORACLE";
const requires=Object.freeze(["N23_WITHDRAWAL_ATTEMPTS"]);
const produces=Object.freeze(["n23_security_oracle"]);
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
