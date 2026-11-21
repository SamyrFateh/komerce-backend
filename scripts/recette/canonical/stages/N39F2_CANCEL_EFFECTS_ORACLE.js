/** @komerce-arch-lite
 * @role g6-canonical-stage-n39f2-cancel-effects-oracle
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N39F2: oracle PG lecture seule, effets de l annulation (F2 achat engagé).
 * @impact-areas staging-only
 */
'use strict';
const id="N39F2_CANCEL_EFFECTS_ORACLE";
const requires=Object.freeze(["N39F2_CLIENT_CANCEL_ATTEMPT"]);
const produces=Object.freeze(["n39f2_cancel_effects_oracle"]);
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
