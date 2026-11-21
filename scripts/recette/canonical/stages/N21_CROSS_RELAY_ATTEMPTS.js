/** @komerce-arch-lite
 * @role g6-canonical-stage-n21-cross-relay-attempts
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N21: agent d'un autre relais du même marché, lecture et écriture de la commande refusées.
 * @impact-areas staging-only
 */
'use strict';
const id="N21_CROSS_RELAY_ATTEMPTS";
const requires=Object.freeze(["LOCAL_RELAY_AVAILABLE"]);
const produces=Object.freeze(["n21_cross_relay_attempts"]);
const roles=Object.freeze(["client", "agent_relais", "admin"]);
async function run(ctx){
 if(!ctx || typeof ctx.runCertifiedStage!=='function')throw Error('G6_STAGE_EXECUTOR_NOT_BOUND_'+id);
 return ctx.runCertifiedStage(id);
}
function validate(ctx,proof){
 if(!ctx || typeof ctx.validateCertifiedStage!=='function')throw Error('G6_STAGE_VALIDATOR_NOT_BOUND_'+id);
 return ctx.validateCertifiedStage(id,proof);
}
module.exports=Object.freeze({id,requires,produces,roles,run,validate});
