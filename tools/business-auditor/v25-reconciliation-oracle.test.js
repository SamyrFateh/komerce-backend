'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {FAULTS,verifyCrashEvidence}=require('./v25-reconciliation-oracle');
function sample(fault){
 const ex=FAULTS[fault],key='kmr-ref-12345678-1234-1234-1234-123456789abc';
 const event={id:'PP-V25-REF-1',amountEur:20,currency:'EUR',
  captureId:'CAP-OFFLINE',providerRequestKey:key};
 return {fault,firstExit:ex.exit,capture:{eur:20,kmf:10000,captureId:'CAP-OFFLINE'},
  providerEvents:ex.events?[event]:[],
  snapshot:{intents:[{owner:'paypal',state:ex.intent,amount_eur:20,
   amount_kmf:10000,provider_request_key:key,provider_refund_id:null}],
   ledger:ex.ledger?[{refund_method:'paypal',status:'completed',amount_eur:20,stripe_refund_id:event.id}]:[],
   walletKmf:0,order:{total_eur:20,total_kmf:10000,paypal_capture_id:'CAP-OFFLINE'}},
  retry:{exit:0,response:{status:409,providerCalls:0},
   providerEventsAfter:ex.events,intentStateAfter:ex.intent,
   ledgerCountAfter:ex.ledger}};
}
for(const fault of Object.keys(FAULTS))test('V25 classify interruption '+fault,()=>{
 const v=verifyCrashEvidence(sample(fault));
 assert.equal(v.retryRefused,true);
 assert.equal(v.noDuplicatePSPEffect,true);
 assert.equal(v.recoveryCompleted,false);
 assert.ok(v.signals.includes('I4_DURABLE_INTENT_RECONCILIATION_OUTSTANDING'));
 if(fault==='PRE_PSP_HARD_EXIT')assert.ok(v.signals.includes('I5_PROVIDER_RESULT_UNKNOWN_AT_CRASH'));
 if(fault==='POST_PSP_HARD_EXIT'||fault==='PSP_TIMEOUT_AFTER_EFFECT')
  assert.ok(v.signals.includes('I2_PSP_REFUND_MISSING_FROM_LEDGER'));
});
test('external refund identity mismatch fails closed',()=>{
 const x=sample('POST_PSP_HARD_EXIT');x.providerEvents[0].providerRequestKey='attacker';
 assert.throws(()=>verifyCrashEvidence(x),/V25_PROOF_DRIFT/);
});
test('retry must never make a second provider request',()=>{
 const x=sample('POST_PSP_HARD_EXIT');x.retry.providerEventsAfter=2;
 assert.throws(()=>verifyCrashEvidence(x),/V25_REPLAY_BREACH/);
});
test('green account balance does not imply completed reconciliation',()=>{
 const x=sample('POST_LEDGER_HARD_EXIT');
 const v=verifyCrashEvidence(x);
 assert.equal(v.signals.includes('I2_PSP_REFUND_MISSING_FROM_LEDGER'),false);
 assert.equal(v.recoveryCompleted,false);
 assert.ok(v.signals.includes('I4_DURABLE_INTENT_RECONCILIATION_OUTSTANDING'));
});
