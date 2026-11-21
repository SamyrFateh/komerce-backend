/** @komerce-arch-lite
 * @role g6-canonical-stage-n35-eco-oracle
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N35: oracle PG lecture seule O-ECO sur les objets de la chaîne M01.
 * @impact-areas staging-only
 */
'use strict';
const id="N35_ECO_ORACLE";
const requires=Object.freeze(["CLIENT_PICKUP"]);
const produces=Object.freeze(["n35_eco_oracle"]);
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
