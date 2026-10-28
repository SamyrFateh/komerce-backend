'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {halfEven,fxOracle,marketOracle,negative}=require('./v31-fx-market-oracle');
const base={contract:'komerce-fx-market-owner-physical/v31',
 ownerExecuted:true,canonicalPg:true,noProductionAccess:true,
 noExternalNetwork:true,authMiddlewareExecuted:false};
function fx(){
 const rates=[{currency:'KMF',rate:'491.96775'},{currency:'XAF',rate:'655.95700'}];
 const inputs=[
  {amount:'100',from:'EUR',to:'KMF'},
  {amount:'100',from:'EUR',to:'XAF'},
  {amount:'491.96775',from:'KMF',to:'XAF'}];
 const out=inputs.map(input=>{
  const amt=halfEven(input.amount,input.from==='EUR'?'1':
   rates.find(x=>x.currency===input.from).rate,
   rates.find(x=>x.currency===input.to).rate);
  const legs=[...(input.from==='EUR'?[]:[{kind:'parity',
   source:'currency_parities',pair:'EUR/KMF',rate:rates[0].rate}]),
   {kind:'parity',source:'currency_parities',pair:'EUR/'+input.to,
    rate:rates.find(x=>x.currency===input.to).rate}];
  return {input,result:{amount_text:amt,amount:Number(amt),
   from:input.from,to:input.to,pivot:'EUR',
   rounding:{mode:'half_even',minor_unit:0},legs}};
 });
 return {...base,mode:'FX',rates,outcomes:out};
}
const ops=['local_price_activate','local_price_draft','catalog_exposure_enable',
 'customs_shipment_create','customs_shipment_create'];
function market(){
 const observations=[];
 for(const status of ['ACTIVE','SUSPENDED','PROVISIONING'])
  for(let i=0;i<5;i++){
   const operation=ops[i],existingOrders=i===3?true:i===4?false:null;
   const yes=status==='ACTIVE'||
    (status==='SUSPENDED'&&i===3)||
    (status==='PROVISIONING'&&i===1);
   const dbState={lifecycle_status:status,is_active:status!=='PROVISIONING'};
   observations.push({status,operation,existingOrders,
    before:{...dbState},after:{...dbState},
    outcome:yes?{allowed:true,error:null,returnedMarket:'KM'}:
     {allowed:false,error:{code:status==='SUSPENDED'?'MARKET_SUSPENDED':'MARKET_NOT_ACTIVE',status:409}}});
  }
 return {...base,mode:'MARKET',marketId:'00000000-0000-4000-8000-000000000001',
  marketCode:'KM',observations};
}
test('fixed KMF/XAF parity amounts are calculated independently with integer half-even',()=>{
 assert.equal(halfEven('100','1','491.96775'),'49197');
 assert.equal(halfEven('100','1','655.957'),'65596');
 assert.equal(halfEven('491.96775','491.96775','655.957'),'656');
});
test('realistic canonical FX legs and precision verdict pass',()=>{
 assert.deepEqual(fxOracle(fx()).signals,[]);
});
test('fake output amount remains red even if other result fields agree',()=>{
 assert.ok(negative(fx()).signals.includes('FX1_PIVOT_RESULT_OR_ROUNDING_MISMATCH'));
});
test('provenance must trace raw DB parity legs',()=>{
 const x=fx();x.outcomes[1].result.legs[0].rate='1';
 assert.ok(fxOracle(x).signals.includes('FX2_RATE_PROVENANCE_INCORRECT'));
});
test('all 15 market lifecycle policy observations are accounted for',()=>{
 assert.equal(marketOracle(market()).checks,15);
 assert.equal(marketOracle(market()).violation,false);
});
test('forged price activation on suspended market fails owner-independent oracle',()=>{
 assert.ok(negative(market()).signals.includes('MK2_MARKET_OPERATION_POLICY_VIOLATION'));
});
test('market guard never certifies user membership',()=>{
 assert.equal(marketOracle(market()).scope,'MARKET_LIFECYCLE_ONLY_NOT_USER_AUTHORIZATION');
});
test('missing market row or FX parity fails closed as tool error',()=>{
 const x=market();x.observations.pop();
 assert.throws(()=>marketOracle(x),/V31_ORACLE_TOOL_ERROR/);
 const y=fx();y.rates.pop();
 assert.throws(()=>fxOracle(y),/V31_ORACLE_TOOL_ERROR/);
});
