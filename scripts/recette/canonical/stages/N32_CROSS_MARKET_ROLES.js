/** @komerce-arch-lite
 * @role g6-canonical-stage-n32-cross-market-roles
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N32: lectures et écritures croisées marché et rôle refusées (table R).
 * @impact-areas staging-only
 */
'use strict';
const id="N32_CROSS_MARKET_ROLES";
const requires=Object.freeze(["LOCAL_RELAY_AVAILABLE"]);
const produces=Object.freeze(["n32_cross_market_roles"]);
const roles=Object.freeze(["client", "agent_relais", "agent_hub"]);
async function run(ctx){
 if(!ctx || typeof ctx.runCertifiedStage!=='function')throw Error('G6_STAGE_EXECUTOR_NOT_BOUND_'+id);
 return ctx.runCertifiedStage(id);
}
function validate(ctx,proof){
 if(!ctx || typeof ctx.validateCertifiedStage!=='function')throw Error('G6_STAGE_VALIDATOR_NOT_BOUND_'+id);
 return ctx.validateCertifiedStage(id,proof);
}
module.exports=Object.freeze({id,requires,produces,roles,run,validate});
