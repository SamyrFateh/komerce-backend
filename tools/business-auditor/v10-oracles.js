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
  observationOracle:'SAME_LOGICAL_REFUND_RETRY_REQUIRES_STABLE_PROVIDER_REQUEST_KEY',
  expectedControls:Object.freeze({ownerRetries:2,clientControlRetries:2,samePayload:true,
   durableClientKeysEqual:true,fakeTimeouts:4,localRefundWrites:0,
   providerCallsReal:0,realMoneyMovementObserved:false,productionIncidentProven:false}),
  observationField:'ownerKeysEqual',
  expected:true,
  type:'boolean',
  proofScope:'ACTUAL_OWNER_REPLAY_MOCKED_HTTP_AND_DB',
  remediation:'Route legacy refund through durable refund_execution_intents and keep the provider request key fixed on retry'
 }),
 Object.freeze({
  id:'KBA-V11-LOGISTICS-PARCEL-COUNT',
  boundary:'P4_LOGISTICS_PARCEL_MEMBERSHIP',
  priority:'P1',
  invariant:'Reported item assignments equal actual successful parcel_items insertions',
  owner:'Logistics / Parcel Membership',
  source:'features/logistics.feature.js: HUB-A parcel membership trace and quantity; issue #2949',
  writer:'services/auto-parcel.js',
  harness:'tests/unit/auditor-v11-auto-parcel-owner-probe.test.js',
  testTitle:'V11 actual auto-parcel owner nominal insert vs ignored-conflict counterexample',
  evidenceContract:'komerce-v11-parcel-count-observation/v1',
  evidenceScope:'ACTUAL_LOGISTICS_OWNER_MOCKED_SQL_ROWCOUNT',
  observationOracle:'ASSIGNED_ITEMS_MUST_EQUAL_SUCCESSFUL_MEMBERSHIP_INSERTS',
  expectedControls:Object.freeze({
   nominalSqlRowCount:1,nominalReported:1,adversarialSqlRowCount:0,
   nominalControlPassed:true,sameItemAndParcel:true,sqlConflictIgnored:true,
   dbQueriesToRealDb:0,physicalSqlConflictReproduced:false,productionIncidentProven:false
  }),
  consistencyRelation:Object.freeze({booleanField:'conflictReportedAccurately',leftField:'adversarialReported',rightField:'adversarialSqlRowCount'}),
  observationField:'conflictReportedAccurately',
  expected:true,
  type:'boolean',
  proofScope:'ACTUAL_OWNER_SQL_ROWCOUNT_SIMULATED_NOT_PHYSICAL_DB',
  remediation:'Count only inserted rows returned by PostgreSQL and reconcile ignored conflicts through canonical parcel membership owner'
 })
]);
module.exports={ORACLES};
