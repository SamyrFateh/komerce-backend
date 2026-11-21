/** @komerce-arch-lite
 * @role g6-canonical-stage-n26b-sav-compensation-decision
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N26b: après retrait, dossier SAV et reprise puis décision admin de compensation (écran recherché).
 * @impact-areas staging-only
 */
'use strict';
const id="N26B_SAV_COMPENSATION_DECISION";
const requires=Object.freeze(["LOCAL_CLIENT_PICKUP"]);
const produces=Object.freeze(["n26b_sav_compensation_decision"]);
const roles=Object.freeze(["admin"]);
async function run(ctx){
 if(!ctx || typeof ctx.runCertifiedStage!=='function')throw Error('G6_STAGE_EXECUTOR_NOT_BOUND_'+id);
 return ctx.runCertifiedStage(id);
}
function validate(ctx,proof){
 if(!ctx || typeof ctx.validateCertifiedStage!=='function')throw Error('G6_STAGE_VALIDATOR_NOT_BOUND_'+id);
 return ctx.validateCertifiedStage(id,proof);
}
module.exports=Object.freeze({id,requires,produces,roles,run,validate});
