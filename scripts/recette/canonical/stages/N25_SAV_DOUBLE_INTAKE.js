/** @komerce-arch-lite
 * @role g6-canonical-stage-n25-sav-double-intake
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N25: dossier SAV puis reprise physique unique, double reprise refusée, par l ecran Retours et SAV.
 * @impact-areas staging-only
 */
'use strict';
const id="N25_SAV_DOUBLE_INTAKE";
const requires=Object.freeze(["LOCAL_CLIENT_PICKUP"]);
const produces=Object.freeze(["n25_sav_double_intake"]);
const roles=Object.freeze(["agent_relais"]);
async function run(ctx){
 if(!ctx || typeof ctx.runCertifiedStage!=='function')throw Error('G6_STAGE_EXECUTOR_NOT_BOUND_'+id);
 return ctx.runCertifiedStage(id);
}
function validate(ctx,proof){
 if(!ctx || typeof ctx.validateCertifiedStage!=='function')throw Error('G6_STAGE_VALIDATOR_NOT_BOUND_'+id);
 return ctx.validateCertifiedStage(id,proof);
}
module.exports=Object.freeze({id,requires,produces,roles,run,validate});
