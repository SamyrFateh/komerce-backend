/** @komerce-arch-lite
 * @role g6-canonical-stage-n40-supplier-price-gap
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N40: confirmation fournisseur à un prix différent du devis, par l ecran Achats fournisseurs.
 * @impact-areas staging-only
 */
'use strict';
const id="N40_SUPPLIER_PRICE_GAP";
const requires=Object.freeze(["HUB_VENDOR_READINESS"]);
const produces=Object.freeze(["n40_supplier_price_gap"]);
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
