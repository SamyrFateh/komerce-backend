/** @komerce-arch-lite
 * @role g6-canonical-stage-n37-document-access
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N37: accès aux documents refusé hors propriétaire (O-SEC-DOC).
 * @impact-areas staging-only
 */
'use strict';
const id="N37_DOCUMENT_ACCESS";
const requires=Object.freeze(["CLIENT_PICKUP"]);
const produces=Object.freeze(["n37_document_access"]);
const roles=Object.freeze(["client", "agent_relais"]);
async function run(ctx){
 if(!ctx || typeof ctx.runCertifiedStage!=='function')throw Error('G6_STAGE_EXECUTOR_NOT_BOUND_'+id);
 return ctx.runCertifiedStage(id);
}
function validate(ctx,proof){
 if(!ctx || typeof ctx.validateCertifiedStage!=='function')throw Error('G6_STAGE_VALIDATOR_NOT_BOUND_'+id);
 return ctx.validateCertifiedStage(id,proof);
}
module.exports=Object.freeze({id,requires,produces,roles,run,validate});
