/** @komerce-arch-lite
 * @role g6-canonical-stage-n08-idempotency-oracle
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N08: la commande de l'écran est rejouée sous la même clé x5, avec un contenu différent, sans clé et sans total accepté ; oracle PG en lecture seule (aucun doublon de commande, paiement ni réservation).
 * @impact-areas staging-only
 */
'use strict';
const id="N08_IDEMPOTENCY_ORACLE";
const requires=Object.freeze(["BUYER"]);
const produces=Object.freeze(["n08_idempotency_oracle"]);
const roles=Object.freeze(["client", "system_readonly"]);
async function run(ctx){
 if(!ctx || typeof ctx.runCertifiedStage!=='function')throw Error('G6_STAGE_EXECUTOR_NOT_BOUND_'+id);
 return ctx.runCertifiedStage(id);
}
function validate(ctx,proof){
 if(!ctx || typeof ctx.validateCertifiedStage!=='function')throw Error('G6_STAGE_VALIDATOR_NOT_BOUND_'+id);
 return ctx.validateCertifiedStage(id,proof);
}
module.exports=Object.freeze({id,requires,produces,roles,run,validate});
