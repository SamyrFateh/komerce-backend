/** @komerce-arch-lite
 * @role g6-canonical-stage-m06-receiving
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Declarative partial M06 stage contract; operator-evidenced Chromium actions remain in the guarded M06 adapters.
 * @impact-areas staging-only
 */
'use strict';
const id="M06_RECEIVING";
const requires=Object.freeze(["M06_PAYMENT_AUTHORIZATION"]);
const produces=Object.freeze(["m06_hub_receipt"]);
const roles=Object.freeze(["agent_hub"]);
async function run(ctx){
 if(!ctx || typeof ctx.runCertifiedStage!=='function')throw Error('G6_STAGE_EXECUTOR_NOT_BOUND_'+id);
 return ctx.runCertifiedStage(id);
}
function validate(ctx,proof){
 if(!ctx || typeof ctx.validateCertifiedStage!=='function')throw Error('G6_STAGE_VALIDATOR_NOT_BOUND_'+id);
 return ctx.validateCertifiedStage(id,proof);
}
module.exports=Object.freeze({id,requires,produces,roles,run,validate});
