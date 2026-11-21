/** @komerce-arch-lite
 * @role g6-canonical-stage-n26a-line-refund-screen-probe
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N26a: sonde d ecran en lecture seule, remboursement de ligne et avoir partiel avant retrait.
 * @impact-areas staging-only
 */
'use strict';
const id="N26A_LINE_REFUND_SCREEN_PROBE";
const requires=Object.freeze(["RELAY_CASH"]);
const produces=Object.freeze(["n26a_line_refund_screen_probe"]);
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
