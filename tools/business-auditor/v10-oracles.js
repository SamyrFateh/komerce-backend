'use strict';
/**
 * V1.0 declarative oracle registry. Expectations are sourced from feature
 * invariants, not inferred from implementation output. Expand by supplying
 * a new independent producer and exact same-run test identity.
 */
const ORACLES=Object.freeze([
 Object.freeze({
  id:'KBA-V10-RC9-PAYPAL-RETRY',
  boundary:'P5_REFUNDS_EXTERNAL_IDEMPOTENCY',
  priority:'P1',
  invariant:'Same logical refund replay must reuse the same durable provider key',
  owner:'Refunds / Payments',
  source:'features/refunds.feature.js: invariants RC-5/RC-9; features/payments.feature.js: invariants RC-9',
  writer:'services/payment-paypal.js',
  harness:'tests/unit/auditor-v10-paypal-owner-probe.test.js',
  testTitle:'V10 probe records real owner retry identity and stable-client control, no PSP',
  evidenceContract:'komerce-v10-paypal-retry-observation/v1',
  evidenceScope:'ACTUAL_OWNER_AND_CLIENT_MOCK_HTTP',
  observationField:'ownerKeysEqual',
  expected:true,
  type:'boolean',
  remediation:'Route legacy refund through durable refund_execution_intents and keep the provider request key fixed on retry'
 })
]);
module.exports={ORACLES};
