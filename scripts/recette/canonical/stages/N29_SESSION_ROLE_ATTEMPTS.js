/** @komerce-arch-lite
 * @role g6-canonical-stage-n29-session-role-attempts
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N29: mutation avec session expirée (401) et geste réservé par un rôle non autorisé (403).
 * @impact-areas staging-only
 */
'use strict';
const id="N29_SESSION_ROLE_ATTEMPTS";
const requires=Object.freeze(["LOCAL_RELAY_AVAILABLE"]);
const produces=Object.freeze(["n29_session_role_attempts"]);
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
