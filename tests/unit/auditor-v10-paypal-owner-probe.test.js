'use strict';
/**
 * V1.0 controlled runtime probe: real refund owner and PayPal client,
 * mocked DB and HTTP. Captures evidence, never assumes an existing bug.
 * @test-kind unit @test-runner jest @test-requires none
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
const fs=require('node:fs');
const {refundPaypalOrder}=require('../../services/payment-paypal');
const paypal=require('../../services/paypal-client');

test('V10 probe records real owner retry identity and stable-client control, no PSP',async()=>{
 const captureId='CAP-V10-TEST',order={id:'ORDER-V10',paypal_capture_id:captureId,
  payment_status:'paid',total_eur:'20.00',total_kmf:'10000'};
 const requests=[];
 const prevFetch=global.fetch;
 const prior={PAYPAL_CLIENT_ID:process.env.PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET:process.env.PAYPAL_CLIENT_SECRET,PAYPAL_ENV:process.env.PAYPAL_ENV};
 const clock=jest.spyOn(Date,'now');
 let tick=1000000;
 clock.mockImplementation(()=>{tick+=1000;return tick});
 paypal._resetTokenCacheForTests();
 process.env.PAYPAL_CLIENT_ID='V10-OFFLINE';
 process.env.PAYPAL_CLIENT_SECRET='V10-OFFLINE-SECRET';
 process.env.PAYPAL_ENV='sandbox';
 global.fetch=jest.fn(async(url,options)=>{
  if(String(url).endsWith('/v1/oauth2/token'))
   return {ok:true,status:200,json:async()=>({access_token:'MOCK',expires_in:32400})};
  if(String(url).includes('/v2/payments/captures/')&&String(url).endsWith('/refund')){
   requests.push({key:options.headers['PayPal-Request-Id'],
    method:options.method,body:JSON.stringify(JSON.parse(options.body))});
   throw new Error('CONTROLLED_TIMEOUT_NO_PROVIDER');
  }
  throw Error('UNEXPECTED_NETWORK_ATTEMPT');
 });
 try{
  const db={query:jest.fn().mockResolvedValue({rows:[order]})};
  for(let i=0;i<2;i++){
   const result=await refundPaypalOrder({orderId:order.id,amountEur:20,
    reason:'same-logical-request',adminUser:{id:'ADMIN-V10'},paypal,db});
   expect(result.status).toBe(502);
  }
  expect(requests).toHaveLength(2);
  expect(db.query).toHaveBeenCalledTimes(2);
  expect(require('../../services/refund-service').recordExternalRefund).not.toHaveBeenCalled();
  const ownerRequests=requests.slice();
  const key='kmr-ref-11111111-2222-4333-8444-555555555555';
  for(let i=0;i<2;i++)await expect(paypal.refundCapture(captureId,{
   amountEur:20,reason:'same-logical-request',providerRequestKey:key
  })).rejects.toThrow('CONTROLLED_TIMEOUT_NO_PROVIDER');
  expect(requests).toHaveLength(4);
  expect(requests.every(x=>x.method==='POST')).toBe(true);
  expect(new Set(requests.map(x=>x.body)).size).toBe(1);
  expect(requests.every(x=>typeof x.key==='string'&&x.key.length>5)).toBe(true);
  expect(requests[2].key).toBe(key);
  expect(requests[3].key).toBe(key);
  const evidence={
   contract:'komerce-v10-paypal-retry-observation/v1',
   scope:'ACTUAL_OWNER_AND_CLIENT_MOCK_HTTP',
   oracle:'SAME_LOGICAL_REFUND_RETRY_REQUIRES_STABLE_PROVIDER_REQUEST_KEY',
   ownerRetries:2,clientControlRetries:2,samePayload:true,
   ownerKeysEqual:ownerRequests[0].key===ownerRequests[1].key,
   durableClientKeysEqual:requests[2].key===requests[3].key,
   fakeTimeouts:requests.length,localRefundWrites:0,
   providerCallsReal:0,realMoneyMovementObserved:false,
   productionIncidentProven:false
  };
  if(process.env.KOMERCE_V10_OBSERVATION_PATH){
   const expected='/tmp/komerce-independent-business-audit/v10-paypal-observation.json';
   expect(process.env.KOMERCE_V10_OBSERVATION_PATH).toBe(expected);
   fs.writeFileSync(expected,JSON.stringify(evidence,null,2)+'\n');
  }
 }finally{
  global.fetch=prevFetch;
  clock.mockRestore();
  for(const [key,value] of Object.entries(prior)){
   if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
 }
});
