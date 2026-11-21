/** @komerce-arch-lite
 * @role g6-canonical-stage-n27-remnant-cancel-screen-probe
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N27: sonde d ecran en lecture seule, annulation du reliquat par palier.
 * @impact-areas staging-only
 */
'use strict';
const id="N27_REMNANT_CANCEL_SCREEN_PROBE";
const requires=Object.freeze(["HUB_VENDOR_READINESS"]);
const produces=Object.freeze(["n27_remnant_cancel_screen_probe"]);
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
