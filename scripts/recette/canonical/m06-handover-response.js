/** @komerce-arch-lite
 * @role g6-m06-shipment-handover-response-contract
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose Validate the actual shipping-customs HTTP envelope on a single M06 staging shipment.
 * @db-read none
 * @db-write none
 * @impact-areas staging-only
 */
'use strict';

function assertM06HandoverResponse(payload, reference) {
 const seen=payload?.result;
 if(payload?.ok!==true||!reference||seen?.reference!==reference||
    seen.from_stage!=='hub_ready'||seen.stage!=='handed_over')
  throw Error('G6_M06_HANDOVER_RESPONSE_INVALID');
 return seen;
}

module.exports={assertM06HandoverResponse};
