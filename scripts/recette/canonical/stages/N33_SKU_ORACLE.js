/** @komerce-arch-lite
 * @role g6-canonical-stage-n33-sku-oracle
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N33: oracle PG lecture seule, 2 SKU distincts, quantités et total exacts.
 * @impact-areas staging-only
 */
'use strict';
const id="N33_SKU_ORACLE";
const requires=Object.freeze(["BUYER"]);
const produces=Object.freeze(["n33_sku_oracle"]);
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
