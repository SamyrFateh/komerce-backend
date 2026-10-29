'use strict';
/**
 * Independent V2.5 RECONCILIATION ORACLE:
 * SQL snapshots + an fsynced, independent provider evidence journal.
 * Never treats a 409 retry or a green balance as proof of a completed refund.
 * Every interrupted intent remains a human/worker reconciliation obligation.
 */
const FAULTS=Object.freeze({
 PRE_PSP_HARD_EXIT:{events:0,ledger:0,intent:'reserved',exit:86},
 POST_PSP_HARD_EXIT:{events:1,ledger:0,intent:'reserved',exit:86},
 POST_LEDGER_HARD_EXIT:{events:1,ledger:1,intent:'reserved',exit:86},
 PSP_TIMEOUT_AFTER_EFFECT:{events:1,ledger:0,intent:'reconciliation_required',exit:0},
});
function verifyCrashEvidence(x){
 if(!x||!FAULTS[x.fault]||!x.snapshot||!Array.isArray(x.providerEvents)||
    !Array.isArray(x.snapshot.ledger)||!Array.isArray(x.snapshot.intents)||
    !x.retry||!x.capture)throw Error('V25_TOOL_ERROR: missing raw physical observation');
 const expected=FAULTS[x.fault],s=x.snapshot;
 if(!Number.isInteger(x.firstExit)||x.firstExit!==expected.exit||
    !Array.isArray(x.providerEvents)||
    x.providerEvents.length!==expected.events||
    s.ledger.length!==expected.ledger||
    s.intents.length!==1||s.intents[0].state!==expected.intent)
  throw Error('V25_PROOF_DRIFT: failure point or persisted provider/SQL evidence mismatch');
 const intent=s.intents[0];
 if(intent.owner!=='paypal'||intent.amount_eur!==x.capture.eur||
    intent.amount_kmf!==x.capture.kmf||
    !/^kmr-ref-[0-9a-f-]{36}$/i.test(intent.provider_request_key||'')||
    s.walletKmf!==0||s.order.total_eur!==x.capture.eur||
    s.order.total_kmf!==x.capture.kmf||
    s.order.paypal_capture_id!==x.capture.captureId)
  throw Error('V25_PROOF_DRIFT: intent, original capture or wallet mismatch');
 if(x.providerEvents.some(e=>e.amountEur!==x.capture.eur||
    e.currency!=='EUR'||e.captureId!==x.capture.captureId||
    e.providerRequestKey!==intent.provider_request_key))
  throw Error('V25_PROOF_DRIFT: evidence cannot be matched to same capture/key/amount');
 if(s.ledger.some(l=>l.refund_method!=='paypal'||l.status!=='completed'||
    Number(l.amount_eur)!==x.capture.eur||
    !x.providerEvents.some(e=>e.id===l.stripe_refund_id)))
  throw Error('V25_PROOF_DRIFT: ledger has unmatched external event or amount');
 if(x.retry.exit!==0||x.retry.response?.status!==409||
    x.retry.response.providerCalls!==0||
    x.retry.providerEventsAfter!==x.providerEvents.length||
    x.retry.intentStateAfter!==intent.state||
    x.retry.ledgerCountAfter!==s.ledger.length)
  throw Error('V25_REPLAY_BREACH: provider replay, intent healing without evidence or missing reject');
 const missing=x.providerEvents.filter(e=>
   !s.ledger.some(l=>l.stripe_refund_id===e.id)).map(e=>e.id);
 const signals=[];
 if(missing.length)signals.push('I2_PSP_REFUND_MISSING_FROM_LEDGER');
 if(intent.state!=='completed')signals.push('I4_DURABLE_INTENT_RECONCILIATION_OUTSTANDING');
 if(x.fault==='PRE_PSP_HARD_EXIT'&&x.providerEvents.length===0)
  signals.push('I5_PROVIDER_RESULT_UNKNOWN_AT_CRASH');
 // The latter is a necessary research-only uncertainty: no live PSP consulted.
 return {fault:x.fault,signals,missingProviderRefunds:missing,
  noDuplicatePSPEffect:x.providerEvents.length<=1&&x.retry.providerEventsAfter===x.providerEvents.length,
  originalCaptureMatch:true,retryRefused:true,productionSafetyProven:false,
  recoveryCompleted:false};
}
module.exports={FAULTS,verifyCrashEvidence};
