/** @komerce-arch-lite
 * @role g6-canonical-stage-n39f1-client-cancel-attempt
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N39F1: annulation par le client depuis Mon Komerce (F1 avant achat).
 * @impact-areas staging-only
 */
'use strict';
const id="N39F1_CLIENT_CANCEL_ATTEMPT";
const requires=Object.freeze(["RELAY_CASH"]);
const produces=Object.freeze(["n39f1_client_cancel_attempt"]);
const roles=Object.freeze(["client"]);
async function run(ctx){
 if(!ctx || typeof ctx.runCertifiedStage!=='function')throw Error('G6_STAGE_EXECUTOR_NOT_BOUND_'+id);
 return ctx.runCertifiedStage(id);
}
function validate(ctx,proof){
 if(!ctx || typeof ctx.validateCertifiedStage!=='function')throw Error('G6_STAGE_VALIDATOR_NOT_BOUND_'+id);
 return ctx.validateCertifiedStage(id,proof);
}
module.exports=Object.freeze({id,requires,produces,roles,run,validate});
