/** @komerce-arch-lite
 * @role g6-canonical-stage-n20-relay-discrepancy
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N20: réception relais d'une quantité constatée inférieure à l'expédié, par l'écran de réception.
 * @impact-areas staging-only
 */
'use strict';
const id="N20_RELAY_DISCREPANCY";
const requires=Object.freeze(["CUSTOMS"]);
const produces=Object.freeze(["n20_relay_discrepancy"]);
const roles=Object.freeze(["agent_relais"]);
async function run(ctx){
 if(!ctx || typeof ctx.runCertifiedStage!=='function')throw Error('G6_STAGE_EXECUTOR_NOT_BOUND_'+id);
 return ctx.runCertifiedStage(id);
}
function validate(ctx,proof){
 if(!ctx || typeof ctx.validateCertifiedStage!=='function')throw Error('G6_STAGE_VALIDATOR_NOT_BOUND_'+id);
 return ctx.validateCertifiedStage(id,proof);
}
module.exports=Object.freeze({id,requires,produces,roles,run,validate});
