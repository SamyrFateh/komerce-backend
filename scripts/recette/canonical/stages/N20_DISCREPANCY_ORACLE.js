/** @komerce-arch-lite
 * @role g6-canonical-stage-n20-discrepancy-oracle
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N20: oracle PG lecture seule, quantité constatée, incident, aucune remise du manquant.
 * @impact-areas staging-only
 */
'use strict';
const id="N20_DISCREPANCY_ORACLE";
const requires=Object.freeze(["N20_RELAY_DISCREPANCY"]);
const produces=Object.freeze(["n20_discrepancy_oracle"]);
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
