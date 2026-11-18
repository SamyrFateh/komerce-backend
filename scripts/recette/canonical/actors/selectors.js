/** @komerce-arch-lite
 * @role g6-canonical-central-selectors
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Known Chromium UI selectors; missing/unverified gestures must fail closed.
 * @impact-areas staging-only
 */
'use strict';
module.exports=Object.freeze({
 client:Object.freeze({
  identify:'#k-kmc-identify',phone:'#k-id-phone',otp:'.k-id-otp-box',
  orderCard:reference=>'.k-myorder-card[data-ref="'+reference+'"]',
  pickupPanel:'.k-order-pickup-code',
  pickupCodeOutput:'.k-pickup-code-output'
 }),
 agent_relais:Object.freeze({
  receiptCard:reference=>'[data-relay-shipment="'+reference+'"]',
  receivedLine:'input[data-relay-received]',
  receivedProof:'input[data-relay-proof]',
  receiveButton:'[data-workspace-action="relay-shipment-receive"]',
  pickupPanel:'[data-manual-pickup-code]',
  pickupInput:'[data-pickup-code-input]',
  pickupButton:'[data-pickup-code-confirm]'
 }),
 admin:Object.freeze({
  network:'[data-market-network]',
  agentSelect:'select[data-agent-select]'
 }),
 agent_hub:Object.freeze({}),transitaire:Object.freeze({}),
 responsable_marche:Object.freeze({}),
 admin_finance:Object.freeze({}),admin_invendus:Object.freeze({})
});
