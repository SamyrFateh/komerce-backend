/** @komerce-arch-lite
 * @role g6-canonical-stage-n31-fx-snapshot-oracle
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N31: oracle PG, snapshot d affichage monétaire conservé.
 * @impact-areas staging-only
 */
'use strict';
const id="N31_FX_SNAPSHOT_ORACLE";
const requires=Object.freeze(["LOCAL_RELAY_AVAILABLE"]);
const produces=Object.freeze(["n31_fx_snapshot_oracle"]);
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
