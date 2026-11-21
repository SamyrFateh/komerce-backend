/** @komerce-arch-lite
 * @role g6-canonical-stage-n39f3-client-cancel-attempt
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N39F3: annulation par le client depuis Mon Komerce (F3 embarqué).
 * @impact-areas staging-only
 */
'use strict';
const id="N39F3_CLIENT_CANCEL_ATTEMPT";
const requires=Object.freeze(["HUB_SHIPMENT"]);
const produces=Object.freeze(["n39f3_client_cancel_attempt"]);
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
