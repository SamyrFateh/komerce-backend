/** @komerce-arch-lite
 * @role g6-canonical-stage-n04-qty-over-stock
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N04: quantité supérieure au stock local saisie dans le panier, refus attendu.
 * @impact-areas staging-only
 */
'use strict';
const id="N04_QTY_OVER_STOCK";
const requires=Object.freeze([]);
const produces=Object.freeze(["n04_qty_over_stock"]);
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
