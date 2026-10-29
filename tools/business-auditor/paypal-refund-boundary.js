'use strict';
/**
 * Independent READ-ONLY source-chain observer, no Komerce runtime imports.
 * A code call path is evidence of reachability, never PSP-side effects.
 */
const fs=require('node:fs'),path=require('node:path');
function between(source,start,end){
 const a=String(source).indexOf(start);
 if(a<0)throw Error('KBA-C03 owner boundary missing: '+start);
 const b=String(source).indexOf(end,a+start.length);
 if(b<0)throw Error('KBA-C03 boundary closing anchor missing: '+end);
 return String(source).slice(a,b);
}
function inspectPayPalRefundChain(sources){
 const route=between(sources.route,"router.post('/refund/:orderId'","module.exports = router");
 const owner=between(sources.owner,'async function refundPaypalOrder(', '\nmodule.exports = {');
 const client=between(sources.client,'async function refundCapture(', '\nasync function getRefund(');
 const ledger=String(sources.ledger);
 const routeConnected=/\brefundPaypalOrder\s*\(\s*\{[\s\S]*?\bpaypal\s*,[\s\S]*?\bdb\s*,?[\s\S]*?\}\s*\)/.test(route);
 const ownerCall=owner.match(/\bpaypal\.refundCapture\s*\(\s*order\.paypal_capture_id\s*,\s*\{([\s\S]*?)\}\s*\)/);
 const clientFallback=/['"]PayPal-Request-Id['"]\s*:\s*\x60[^\x60]{0,160}Date\.now\s*\(\s*\)[^\x60]*\x60/.test(client);
 const durableOverride=/if\s*\(\s*providerRequestKey\s*\)\s*refundHeaders\[['"]PayPal-Request-Id['"]\]\s*=\s*providerRequestKey/.test(client);
 const durableReserved=/\breserveRefundIntent\s*\(/.test(owner);
 const durableClaimed=/\bclaimRefundIntent\s*\(/.test(owner);
 const providerKeyPassed=Boolean(ownerCall&&/\bproviderRequestKey\s*:/.test(ownerCall[1]));
 const futureOnly=/NOT ACTIVATED/.test(ledger.slice(0,1400));
 const observations={
  routeConnected,ownerCallsClient:Boolean(ownerCall),
  ownerPassesStableProviderKey:providerKeyPassed,
  ownerReservesDurableIntent:durableReserved,
  ownerClaimsDurableIntent:durableClaimed,
  clientHasTimestampFallback:clientFallback,
  clientSupportsDurableOverride:durableOverride,
  intentLedgerMarkedNotActivated:futureOnly,
 };
 const legacyLive=routeConnected&&ownerCall&&!providerKeyPassed&&
   !durableReserved&&!durableClaimed&&clientFallback&&durableOverride;
 return {
  id:'KBA-C03',boundary:'P5_P2_PAYMENT_CLOSURE',
  owner:'Refunds / PayPal',status:legacyLive?
   'LIVE_LEGACY_CALL_WITHOUT_DURABLE_REQUEST_KEY':
   (!routeConnected||!ownerCall||!clientFallback||!durableOverride)?
    'OWNER_CHAIN_EVIDENCE_GAP':'OWNER_CHAIN_CHANGED_REQUIRE_REVIEW',
  evidenceLevel:'EXACT_SOURCE_CALL_CHAIN_NOT_NETWORK_PAYMENT',
  observations,productionDuplicateRefundConfirmed:false,
  nextProof:'Fake HTTP refunds through actual owner; timeout then retry, compare request headers; no real PSP',
 };
}
function inspectTrackedPayPalRefundChain(root,read=fs.readFileSync){
 const sources={};
 const files={
  route:'routes/payments-paypal.js',
  owner:'services/payment-paypal.js',
  client:'services/paypal-client.js',
  ledger:'services/refund-intent-ledger.js',
 };
 for(const [k,rel] of Object.entries(files))sources[k]=read(path.join(root,rel),'utf8');
 return inspectPayPalRefundChain(sources);
}
module.exports={inspectPayPalRefundChain,inspectTrackedPayPalRefundChain};
