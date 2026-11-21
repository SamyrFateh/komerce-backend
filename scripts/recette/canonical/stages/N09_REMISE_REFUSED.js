/** @komerce-arch-lite
 * @role g6-canonical-stage-n09-remise-refused
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N09: tentative de remise par l'écran Remises sans cash encaissé (RELAY_CASH sauté), refus attendu.
 * @impact-areas staging-only
 */
'use strict';
const id="N09_REMISE_REFUSED";
const requires=Object.freeze(["BUYER"]);
const produces=Object.freeze(["n09_remise_refused"]);
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
