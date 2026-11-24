/** @komerce-arch-lite
 * @role g6-canonical-stage-n26a-line-refund-psp-decision
 * @domain refunds
 * @layer test
 * @owner backend-core
 * @purpose N26a: réserver puis exécuter une seule fois le remboursement PSP sandbox d'une ligne attestée.
 * @impact-areas staging-only, refunds, payments
 */
'use strict';
const id='N26A_LINE_REFUND_PSP_DECISION';
const requires=Object.freeze(['BUYER']);
const produces=Object.freeze(['n26a_line_refund_psp_decision']);
const roles=Object.freeze(['admin']);
async function run(ctx){
 if(!ctx||typeof ctx.runCertifiedStage!=='function')throw Error('G6_STAGE_EXECUTOR_NOT_BOUND_'+id);
 return ctx.runCertifiedStage(id);
}
function validate(ctx,proof){
 if(!ctx||typeof ctx.validateCertifiedStage!=='function')throw Error('G6_STAGE_VALIDATOR_NOT_BOUND_'+id);
 return ctx.validateCertifiedStage(id,proof);
}
module.exports=Object.freeze({id,requires,produces,roles,run,validate});
