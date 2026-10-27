'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {assessP6P1,collectP6P1Canonical}=require('./p6-p1-canonical-collector');
const {MAP,evaluateBoundary}=require('./p1-p7-boundary-oracle');
const edge=MAP.find(x=>x.id==='P6_P1_PRICE_REVIEW');
const verdict=x=>evaluateBoundary(edge,x.proofs.P6_P1_PRICE_REVIEW);
const item={order_id:'o1',product_id:'p1'};
const market={id:'m1',code:'KM',currency:'KMF'};
const shadow={order_id:'o1',margin:{shadow_pct:7.5,basis:'real'}};
const base=x=>({item,market,shadow,events:[],draft:null,...x});
test('real margin deterioration alone never activates product price',()=>{
 const r=assessP6P1(base());
 assert.equal(verdict(r).status,'EVIDENCE_GAP');
 assert.ok(r.diagnostics.gaps.includes('NO_HUMAN_MARKET_PRICE_DECISION'));
 assert.equal(r.proofs.P6_P1_PRICE_REVIEW.context.automatically_activated,false);
});
test('draft remains pending economic gate',()=>{
 const r=assessP6P1(base({draft:{product_id:'p1',status:'DRAFT_PENDING_GATE'}}));
 assert.equal(verdict(r).status,'EVIDENCE_GAP');
 assert.ok(r.diagnostics.gaps.includes('PRICE_DRAFT_NOT_ECONOMICALLY_AUTHORIZED'));
});
test('AUTHORIZED does not imply a customer-facing new price',()=>{
 const r=assessP6P1(base({draft:{product_id:'p1',status:'LOCAL_AUTHORIZED_PENDING_CUTOVER'}}));
 assert.equal(verdict(r).status,'EVIDENCE_GAP');
});
test('proper actor and audited activation is a scoped observed seam, not GO',()=>{
 const draft={product_id:'p1',status:'LOCAL_ACTIVE',decided_by:'u1',active_at:'2026-10-27',
  authorized_at:'2026-10-26',authorization_snapshot:{activation_allowed:true}};
 const events=[{market_id:'m1',product_id:'p1',action:'ACTIVATE',actor_id:'u1',
  old_amount:'25000',new_amount:'25000',decision_snapshot:{activation_allowed:true}}];
 const r=assessP6P1(base({draft,events}));
 assert.equal(verdict(r).status,'NO_CONTRADICTION_OBSERVED');
 assert.equal(r.diagnostics.contradictions.length,0);
 assert.equal(r.diagnostics.gaps.includes('ORDER_MARGIN_NOT_AUTOMATIC_MARKET_PRODUCT_DECISION'),true);
});
test('unattributed ACTIVATE audit event is contradicted independently',()=>{
 const r=assessP6P1(base({events:[{market_id:'m1',product_id:'p1',
  action:'ACTIVATE',actor_id:null,old_amount:15000,new_amount:15000}]}));
 assert.ok(verdict(r).contradictions.includes('OWNER_FACT:UNATTRIBUTED_PRICE_ACTIVATE_EVENT'));
});
test('activation changing the authorized monetary amount is contradicted',()=>{
 const r=assessP6P1(base({events:[{market_id:'m1',product_id:'p1',
  action:'ACTIVATE',actor_id:'u1',old_amount:15000,new_amount:16000}]}));
 assert.ok(verdict(r).contradictions.includes(
  'OWNER_FACT:ACTIVATE_CHANGED_AMOUNT_INSTEAD_OF_PRESERVING_AUTHORIZED_DECISION'));
});
test('read-only owner pair shares transaction and selected item/product',async()=>{
 const queries=[],db={query:async(sql,params)=>{
  queries.push({sql,params});if(sql.includes('FROM product_market_price_drafts'))return {rows:[]};
  if(sql.includes('FROM product_market_price_draft_events'))return {rows:[]};
  throw Error('unplanned SQL');
 }};
 const r=await collectP6P1Canonical(db,{item,market,readers:{realMargin:async(id,opt)=>{
  assert.equal(id,'o1');assert.equal(opt.client,db);return shadow;
 }}});
 assert.equal(verdict(r).status,'EVIDENCE_GAP');assert.equal(queries.length,2);
 assert.ok(queries.every(x=>x.sql.startsWith('SELECT ')&&JSON.stringify(x.params)==='["m1","p1"]'));
});
