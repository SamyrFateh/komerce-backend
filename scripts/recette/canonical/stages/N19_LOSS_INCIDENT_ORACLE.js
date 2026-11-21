/** @komerce-arch-lite
 * @role g6-canonical-stage-n19-loss-incident-oracle
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N19: oracle PG lecture seule, incident de perte, aucun retrait possible.
 * @impact-areas staging-only
 */
'use strict';
const id="N19_LOSS_INCIDENT_ORACLE";
const requires=Object.freeze(["N19_LOCAL_TRANSPORT_DELAY_LOSS"]);
const produces=Object.freeze(["n19_loss_incident_oracle"]);
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
