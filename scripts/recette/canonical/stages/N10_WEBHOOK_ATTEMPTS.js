/** @komerce-arch-lite
 * @role g6-canonical-stage-n10-webhook-attempts
 * @domain payment
 * @layer test
 * @owner backend-core
 * @purpose N10: webhooks PSP simulés non signés et dupliqués (sondes API signalées, Chromium NOT_APPLICABLE).
 * @impact-areas staging-only
 */
'use strict';
const id="N10_WEBHOOK_ATTEMPTS";
const requires=Object.freeze(["BUYER"]);
const produces=Object.freeze(["n10_webhook_attempts"]);
const roles=Object.freeze(["system_readonly"]);
async function run(ctx){
 if(!ctx || typeof ctx.runCertifiedStage!=='function')throw Error('G6_STAGE_EXECUTOR_NOT_BOUND_'+id);
 return ctx.runCertifiedStage(id);
}
function validate(ctx,proof){
 if(!ctx || typeof ctx.validateCertifiedStage!=='function')throw Error('G6_STAGE_VALIDATOR_NOT_BOUND_'+id);
 return ctx.validateCertifiedStage(id,proof);
}
module.exports=Object.freeze({id,requires,produces,roles,run,validate});
