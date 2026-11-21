/** @komerce-arch-lite
 * @role g6-canonical-stage-n13-backorder-oracle
 * @domain purchasing
 * @layer test
 * @owner backend-core
 * @purpose N13: oracle PG en lecture seule, reliquat enregistré et aucune réception fictive.
 * @impact-areas staging-only
 */
'use strict';
const id="N13_BACKORDER_ORACLE";
const requires=Object.freeze(["N13_SUPPLIER_BACKORDER"]);
const produces=Object.freeze(["n13_backorder_oracle"]);
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
