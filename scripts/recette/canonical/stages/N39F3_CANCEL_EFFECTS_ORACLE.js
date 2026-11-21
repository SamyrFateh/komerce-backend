/** @komerce-arch-lite
 * @role g6-canonical-stage-n39f3-cancel-effects-oracle
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N39F3: oracle PG lecture seule, effets de l annulation (F3 embarqué).
 * @impact-areas staging-only
 */
'use strict';
const id="N39F3_CANCEL_EFFECTS_ORACLE";
const requires=Object.freeze(["N39F3_CLIENT_CANCEL_ATTEMPT"]);
const produces=Object.freeze(["n39f3_cancel_effects_oracle"]);
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
