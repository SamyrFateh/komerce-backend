/** @komerce-arch-lite
 * @role g6-canonical-stage-n10-no-settlement-oracle
 * @domain payment
 * @layer test
 * @owner backend-core
 * @purpose N10: oracle PG lecture seule, aucun règlement ni événement PSP enregistré.
 * @impact-areas staging-only
 */
'use strict';
const id="N10_NO_SETTLEMENT_ORACLE";
const requires=Object.freeze(["N10_WEBHOOK_ATTEMPTS"]);
const produces=Object.freeze(["n10_no_settlement_oracle"]);
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
