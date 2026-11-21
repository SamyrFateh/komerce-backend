/** @komerce-arch-lite
 * @role g6-canonical-stage-n04-no-effect-oracle
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N04: oracle PG lecture seule, aucune commande, aucun stock négatif ni réserve fictive.
 * @impact-areas staging-only
 */
'use strict';
const id="N04_NO_EFFECT_ORACLE";
const requires=Object.freeze(["N04_QTY_OVER_STOCK"]);
const produces=Object.freeze(["n04_no_effect_oracle"]);
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
