/** @komerce-arch-lite
 * @role g6-canonical-stage-n17-no-transition-oracle
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N17: oracle PG lecture seule, expédition inchangée, aucun frais ni lien douane.
 * @impact-areas staging-only
 */
'use strict';
const id="N17_NO_TRANSITION_ORACLE";
const requires=Object.freeze(["N17_FORWARDER_ROLE_MARKET_ATTEMPTS"]);
const produces=Object.freeze(["n17_no_transition_oracle"]);
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
