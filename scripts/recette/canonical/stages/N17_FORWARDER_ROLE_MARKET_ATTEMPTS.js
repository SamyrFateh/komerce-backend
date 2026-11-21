/** @komerce-arch-lite
 * @role g6-canonical-stage-n17-forwarder-role-market-attempts
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N17: transitaire hors rôle ou hors marché, autres rôles, gestes refusés 403 sans transition.
 * @impact-areas staging-only
 */
'use strict';
const id="N17_FORWARDER_ROLE_MARKET_ATTEMPTS";
const requires=Object.freeze(["HUB_SHIPMENT"]);
const produces=Object.freeze(["n17_forwarder_role_market_attempts"]);
const roles=Object.freeze(["agent_transitaire"]);
async function run(ctx){
 if(!ctx || typeof ctx.runCertifiedStage!=='function')throw Error('G6_STAGE_EXECUTOR_NOT_BOUND_'+id);
 return ctx.runCertifiedStage(id);
}
function validate(ctx,proof){
 if(!ctx || typeof ctx.validateCertifiedStage!=='function')throw Error('G6_STAGE_VALIDATOR_NOT_BOUND_'+id);
 return ctx.validateCertifiedStage(id,proof);
}
module.exports=Object.freeze({id,requires,produces,roles,run,validate});
