/** @komerce-arch-lite
 * @role g6-canonical-stage-n11-po-no-commitment-attempt
 * @domain purchasing
 * @layer test
 * @owner backend-core
 * @purpose N11: l'agent Hub tente d'avancer un PO brouillon (soumission, envoi) sans validation d'engagement, par l'écran.
 * @impact-areas staging-only
 */
'use strict';
const id="N11_PO_NO_COMMITMENT_ATTEMPT";
const requires=Object.freeze(["HUB_PO"]);
const produces=Object.freeze(["n11_po_no_commitment_attempt"]);
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
