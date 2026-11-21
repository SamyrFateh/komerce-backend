/** @komerce-arch-lite
 * @role g6-canonical-stage-n07-no-double-effect
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N07: oracle PG lecture seule après double clic Commander (1 commande max, aucun double paiement ni double réservation).
 * @impact-areas staging-only
 */
'use strict';
const id="N07_NO_DOUBLE_EFFECT";
const requires=Object.freeze(["BUYER"]);
const produces=Object.freeze(["n07_no_double_effect_oracle"]);
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
