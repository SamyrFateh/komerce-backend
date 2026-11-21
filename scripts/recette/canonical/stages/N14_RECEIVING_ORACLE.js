/** @komerce-arch-lite
 * @role g6-canonical-stage-n14-receiving-oracle
 * @domain purchasing
 * @layer test
 * @owner backend-core
 * @purpose N14: oracle PG en lecture seule, quantités reçues exactes, aucune quantité négative.
 * @impact-areas staging-only
 */
'use strict';
const id="N14_RECEIVING_ORACLE";
const requires=Object.freeze(["N14_RECEIVING_QTY_ATTEMPTS"]);
const produces=Object.freeze(["n14_receiving_oracle"]);
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
