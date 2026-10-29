'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {inspectPayPalRefundChain,inspectTrackedPayPalRefundChain}=
 require('./paypal-refund-boundary');
const root=path.resolve(__dirname,'../..');
const load=()=>({
 route:fs.readFileSync(path.join(root,'routes/payments-paypal.js'),'utf8'),
 owner:fs.readFileSync(path.join(root,'services/payment-paypal.js'),'utf8'),
 client:fs.readFileSync(path.join(root,'services/paypal-client.js'),'utf8'),
 ledger:fs.readFileSync(path.join(root,'services/refund-intent-ledger.js'),'utf8'),
});
test('real API->owner->client chain is reachable but does not use durable intent',()=>{
 const r=inspectTrackedPayPalRefundChain(root);
 assert.equal(r.status,'LIVE_LEGACY_CALL_WITHOUT_DURABLE_REQUEST_KEY');
 assert.deepEqual(r.observations,{
  routeConnected:true,ownerCallsClient:true,
  ownerPassesStableProviderKey:false,
  ownerReservesDurableIntent:false,ownerClaimsDurableIntent:false,
  clientHasTimestampFallback:true,clientSupportsDurableOverride:true,
  intentLedgerMarkedNotActivated:true,
 });
 assert.equal(r.productionDuplicateRefundConfirmed,false);
});
test('do not mistake durable client support for live route use',()=>{
 const s=load();
 s.owner=s.owner.replace('      reason:    reason || \'admin_refund\',',
   '      reason:    reason || \'admin_refund\',\n      providerRequestKey: stableFromLedger,');
 const r=inspectPayPalRefundChain(s);
 assert.equal(r.observations.ownerPassesStableProviderKey,true);
 assert.equal(r.status,'OWNER_CHAIN_CHANGED_REQUIRE_REVIEW');
});
test('a disconnected real route is an evidence gap, not certified safe',()=>{
 const s=load();
 s.route=s.route.replace("router.post('/refund/:orderId'","router.post('/legacy-disabled/:orderId'");
 assert.throws(()=>inspectPayPalRefundChain(s),/owner boundary missing/);
});
test('an unrecognized client fallback is unknown, not a confirmed issue',()=>{
 const s=load();
 s.client=s.client.replace('Date.now()','crypto.randomUUID()');
 // The first Date.now is not necessarily refund-specific, target within function.
 const old=load().client,at=old.indexOf('async function refundCapture');
 s.client=old.slice(0,at)+old.slice(at).replace('Date.now()','crypto.randomUUID()');
 const r=inspectPayPalRefundChain(s);
 assert.equal(r.status,'OWNER_CHAIN_EVIDENCE_GAP');
});
test('observable owner calls may not be classified as a real PayPal debit',()=>{
 const r=inspectTrackedPayPalRefundChain(root);
 assert.equal(r.evidenceLevel,'EXACT_SOURCE_CALL_CHAIN_NOT_NETWORK_PAYMENT');
 assert.equal(r.productionDuplicateRefundConfirmed,false);
});
