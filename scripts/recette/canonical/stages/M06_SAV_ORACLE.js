/** @komerce-arch-lite
 * @role g6-canonical-stage-m06-sav-ui-oracle
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose Read-only Chromium and PostgreSQL SAV eligibility oracle after M06 pickup.
 * @impact-areas staging-only
 */
'use strict';
const id="M06_SAV_ORACLE";
const requires=Object.freeze(["M06_CLIENT_PICKUP"]);
const produces=Object.freeze(["m06_sav_ui_oracles"]);
const roles=Object.freeze(["agent_relais","admin"]);
async function run(ctx){
 if(!ctx || typeof ctx.runCertifiedStage!=='function')throw Error('G6_STAGE_EXECUTOR_NOT_BOUND_'+id);
 return ctx.runCertifiedStage(id);
}
function validate(ctx,proof){
 if(!ctx || typeof ctx.validateCertifiedStage!=='function')throw Error('G6_STAGE_VALIDATOR_NOT_BOUND_'+id);
 return ctx.validateCertifiedStage(id,proof);
}
module.exports=Object.freeze({id,requires,produces,roles,run,validate});
