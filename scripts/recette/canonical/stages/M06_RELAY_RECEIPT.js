/** @komerce-arch-lite
 * @role g6-canonical-stage-m06-relay-receipt
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose Declarative M06 final-mile contract reusing the guarded Chromium operation and its independent PostgreSQL readback.
 * @impact-areas staging-only
 */
'use strict';
const id="M06_RELAY_RECEIPT";
const requires=Object.freeze(["M06_CUSTOMS"]);
const produces=Object.freeze(["m06_relay_receipt"]);
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
