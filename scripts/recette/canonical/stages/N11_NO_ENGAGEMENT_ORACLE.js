/** @komerce-arch-lite
 * @role g6-canonical-stage-n11-no-engagement-oracle
 * @domain purchasing
 * @layer test
 * @owner backend-core
 * @purpose N11: oracle PG en lecture seule, aucun engagement ni envoi fournisseur.
 * @impact-areas staging-only
 */
'use strict';
const id="N11_NO_ENGAGEMENT_ORACLE";
const requires=Object.freeze(["N11_PO_NO_COMMITMENT_ATTEMPT"]);
const produces=Object.freeze(["n11_no_engagement_oracle"]);
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
