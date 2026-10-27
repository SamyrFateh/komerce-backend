'use strict';
/** @test-kind unit @test-runner jest @test-requires none
 * R&D only: actual PayPal refund owner and client, fake HTTP transport.
 * No PSP endpoint reachable, no DB connection, no monetary side effects.
 */
jest.mock('../../services/documents/refund-receipt',()=>({issue:jest.fn()}));
jest.mock('../../services/order-payment-confirmation',()=>({confirmPaymentCycle:jest.fn()}));
jest.mock('../../services/payment-service',()=>({markRefunded:jest.fn()}));
jest.mock('../../services/order-mutation-service',()=>({
 setPaypalOrderId:jest.fn(),setPaypalCaptureMetadata:jest.fn(),
 setPaypalCaptureId:jest.fn(),appendOrderNote:jest.fn(),
}));
jest.mock('../../services/refund-service',()=>({recordExternalRefund:jest.fn()}));
jest.mock('../../services/order-status-machine',()=>({
 appendOrderHistoryNote:jest.fn(),transitionOrderStatus:jest.fn(),
}));
jest.mock('../../services/pickup-secret-service',()=>({
 generateAndStoreSecret:jest.fn(),cacheCodeForReveal:jest.fn(),
}));
jest.mock('../../utils/alerts',()=>({createAlert:jest.fn()}));
jest.mock('../../utils/logger',()=>({child:()=>({
 info:jest.fn(),warn:jest.fn(),error:jest.fn(),debug:jest.fn(),
})}));
const {refundPaypalOrder}=require('../../services/payment-paypal');
const paypal=require('../../services/paypal-client');
const order={id:'TEST-ORDER',paypal_capture_id:'CAP-RD-1',
 payment_status:'paid',total_eur:'20.00',total_kmf:'10000'};
let actualRequests,clockSpy;
beforeEach(()=>{
 actualRequests=[];
 paypal._resetTokenCacheForTests();
 process.env.PAYPAL_CLIENT_ID='RND-TEST-ID';
 process.env.PAYPAL_CLIENT_SECRET='RND-TEST-SECRET';
 process.env.PAYPAL_ENV='sandbox';
 let time=2000000;
 clockSpy=jest.spyOn(Date,'now').mockImplementation(()=>{time+=1000;return time});
 global.fetch=jest.fn(async(url,options)=>{
  if(String(url).includes('/v1/oauth2/token'))return {
   ok:true,status:200,json:async()=>({access_token:'OFFLINE-TOKEN',expires_in:32400}),
  };
  if(String(url).includes('/v2/payments/captures/')&&String(url).endsWith('/refund')){
   actualRequests.push({url:String(url),method:options.method,
    key:options.headers['PayPal-Request-Id'],body:JSON.parse(options.body)});
   // Conservative unknown outcome: network might have accepted the request
   // before the connection drops. Do NOT claim the PSP issued a refund.
   throw new Error('SIMULATED_AMBIGUOUS_PROVIDER_TIMEOUT');
  }
  throw Error('Forbidden fake HTTP path '+url);
 });
});
afterEach(()=>{clockSpy.mockRestore();delete global.fetch});
test('actual live refund owner retries same operation with two different outgoing PSP keys',async()=>{
 const db={query:jest.fn().mockResolvedValue({rows:[order]})};
 for(let i=0;i<2;i++){
  const r=await refundPaypalOrder({orderId:order.id,amountEur:20,
   reason:'same-admin-request',adminUser:{id:'TEST-ADMIN'},paypal,db});
  expect(r.status).toBe(502);
 }
 expect(actualRequests).toHaveLength(2);
 expect(actualRequests.map(x=>x.method)).toEqual(['POST','POST']);
 expect(actualRequests.map(x=>x.body)).toEqual([
  {amount:{currency_code:'EUR',value:'20.00'},note_to_payer:'same-admin-request'},
  {amount:{currency_code:'EUR',value:'20.00'},note_to_payer:'same-admin-request'},
 ]);
 expect(actualRequests[0].key).not.toBe(actualRequests[1].key);
 expect(actualRequests.every(x=>x.key.startsWith('refund-CAP-RD-1-'))).toBe(true);
 expect(db.query).toHaveBeenCalledTimes(2); // read only, no local refund writer
 expect(require('../../services/refund-service').recordExternalRefund).not.toHaveBeenCalled();
});
test('actual PayPal client preserves exact durable key on two mocked failed provider attempts',async()=>{
 const opts={amountEur:20,reason:'same-admin-request',
  providerRequestKey:'kmr-ref-11111111-2222-4333-8444-555555555555'};
 for(let i=0;i<2;i++)await expect(paypal.refundCapture('CAP-RD-1',opts))
  .rejects.toThrow('SIMULATED_AMBIGUOUS_PROVIDER_TIMEOUT');
 expect(actualRequests).toHaveLength(2);
 expect(actualRequests.map(x=>x.key)).toEqual([opts.providerRequestKey,opts.providerRequestKey]);
});
test('an invalid provider key is rejected before any HTTP call',async()=>{
 await expect(paypal.refundCapture('CAP-RD-1',{amountEur:20,
  providerRequestKey:'forged'})).rejects.toMatchObject({
   code:'REFUND_PROVIDER_REQUEST_KEY_INVALID',
  });
 expect(global.fetch).not.toHaveBeenCalled();
});
