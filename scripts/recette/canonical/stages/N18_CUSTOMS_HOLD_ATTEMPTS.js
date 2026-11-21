/** @komerce-arch-lite
 * @role g6-canonical-stage-n18-customs-hold-attempts
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N18: douane retenue avec motif, étapes refusées sous retenue, mainlevée puis étapes autorisées, par l ecran.
 * @impact-areas staging-only
 */
'use strict';
const id="N18_CUSTOMS_HOLD_ATTEMPTS";
const requires=Object.freeze(["FORWARDER"]);
const produces=Object.freeze(["n18_customs_hold_attempts"]);
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
