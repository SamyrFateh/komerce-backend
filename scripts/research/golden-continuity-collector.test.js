'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {collectGoldenContinuity}=require('./golden-continuity-collector');

function owners(){
 let observedFetch='NOT_CALLED';
 return {
  upstream:async(_db,options)=>{
    observedFetch=options.fetchImpl;
    return {ids:{product_id:options.productId,market_code:options.marketCode,
        order_reference:options.orderReference},
      thread:{product_id:options.productId,market:options.marketCode,
        order_reference:options.orderReference},
      gates:[
        {key:'SOURCE_PROVED',status:'PROVED'},
        {key:'REFINERY_PROVED',status:'PROVED'},
        {key:'CATALOG_RELEASE_PROVED',status:'PROVED'},
        {key:'STOREFRONT_PROVED',status:'NON_PROUVE'},
        {key:'CHECKOUT_ORIGIN_PROVED',status:'ANOMALIE',evidence:{market_code:'CM'}},
        {key:'PAYMENT_FINAL_PROVED',status:'NON_PROUVE'},
      ]};
  },
  order:async(_db,order)=>({order,steps:[
    {key:'CLIENT_PAYMENT',passed:false},{key:'PURCHASING',passed:false},
    {key:'HUB_INBOUND',passed:false},{key:'CUSTOMER_HANDOFF',passed:false},
    {key:'FINANCIAL_CLOSE',passed:false}]}),
  getFetch:()=>observedFetch,
 };
}
test('owner adapter exposes KM-versus-CM discrepancy, never joins by requested market',async()=>{
 let sql=null,params=null;
 const db={query:async(s,p)=>{sql=s;params=p;return{rows:[{id:'o1',reference:'O1',market_code:'CM'}]}}};
 const adapter=owners();
 const report=await collectGoldenContinuity(db,{productId:'p1',marketCode:'KM',orderReference:'O1'},adapter);
 assert.match(sql,/^SELECT/);
 assert.doesNotMatch(sql,/AND\s+m\.code/);
 assert.deepEqual(params,['O1']);
 assert.equal(adapter.getFetch(),null); // prohibit unsolicited external storefront calls
 assert.equal(report.trace.canonical_order_market,'CM');
 assert.equal(report.totals.contradiction_hypotheses,1);
 assert.equal(report.checkpoints[1].status,'CONTRADICTION_HYPOTHESIS');
 assert.equal(report.stagingCertified,false);
 assert.equal(report.humanAccepted,false);
});
test('missing order is a gap, not a fabricated downstream handoff',async()=>{
 const db={query:async()=>({rows:[]})};
 const adapter=owners();let projected=false;
 adapter.order=async()=>{projected=true;throw Error('Should not run');};
 const r=await collectGoldenContinuity(db,{productId:'p1',marketCode:'KM',orderReference:'O1'},adapter);
 assert.equal(projected,false);
 assert.equal(r.trace.canonical_order_id,null);
 assert.equal(r.checkpoints[2].status,'EVIDENCE_GAP');
 assert.equal(r.no_go_granted,true);
});
test('ambiguous reference fails closed before projecting',async()=>{
 const db={query:async()=>({rows:[{id:1},{id:2}]})};
 await assert.rejects(()=>collectGoldenContinuity(db,{productId:'p1',marketCode:'KM',orderReference:'O1'},owners()),/ambiguous/);
});
