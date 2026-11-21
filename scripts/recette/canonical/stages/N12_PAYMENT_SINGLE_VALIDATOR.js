/** @komerce-arch-lite
 * @role g6-canonical-stage-n12-payment-single-validator
 * @domain purchasing
 * @layer test
 * @owner backend-core
 * @purpose N12: un seul validateur sans l'autorisation de paiement tente le paiement fournisseur, par l'écran.
 * @impact-areas staging-only
 */
'use strict';
const id="N12_PAYMENT_SINGLE_VALIDATOR";
const requires=Object.freeze(["HUB_VENDOR_SIMULATION"]);
const produces=Object.freeze(["n12_payment_single_validator"]);
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
