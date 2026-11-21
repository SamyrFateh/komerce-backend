/** @komerce-arch-lite
 * @role g6-canonical-stage-n13-supplier-backorder
 * @domain purchasing
 * @layer test
 * @owner backend-core
 * @purpose N13: la simulation fournisseur (seule réponse externe autorisée) confirme moins que commandé, par l'écran de confirmation du Hub.
 * @impact-areas staging-only
 */
'use strict';
const id="N13_SUPPLIER_BACKORDER";
const requires=Object.freeze(["HUB_VENDOR_READINESS"]);
const produces=Object.freeze(["n13_supplier_backorder"]);
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
