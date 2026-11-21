/** @komerce-arch-lite
 * @role g6-canonical-stage-n37-documents-oracle
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N37: oracle PG lecture seule O-DOC et O-NOTIF.
 * @impact-areas staging-only
 */
'use strict';
const id="N37_DOCUMENTS_ORACLE";
const requires=Object.freeze(["N37_DOCUMENT_ACCESS"]);
const produces=Object.freeze(["n37_documents_oracle"]);
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
