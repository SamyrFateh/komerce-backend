/** @komerce-arch-lite
 * @role g6-canonical-stage-n12-no-payment-oracle
 * @domain purchasing
 * @layer test
 * @owner backend-core
 * @purpose N12: oracle PG en lecture seule, aucune autorisation de paiement ni paiement fournisseur.
 * @impact-areas staging-only
 */
'use strict';
const id="N12_NO_PAYMENT_ORACLE";
const requires=Object.freeze(["N12_PAYMENT_SINGLE_VALIDATOR"]);
const produces=Object.freeze(["n12_no_payment_oracle"]);
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
