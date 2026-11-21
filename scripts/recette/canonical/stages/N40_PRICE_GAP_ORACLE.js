/** @komerce-arch-lite
 * @role g6-canonical-stage-n40-price-gap-oracle
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N40: oracle PG lecture seule, écart validé séparément, aucun paiement silencieux.
 * @impact-areas staging-only
 */
'use strict';
const id="N40_PRICE_GAP_ORACLE";
const requires=Object.freeze(["N40_SUPPLIER_PRICE_GAP"]);
const produces=Object.freeze(["n40_price_gap_oracle"]);
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
