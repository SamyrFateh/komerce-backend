'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {assessUnsubmittedPo}=require('./golden-po-unsubmitted-proof');
const shapeFacts = shape => ({
  facts:{
    po:{id:'po1',order_id:shape==='historical'?'o1':null,order_item_id:shape==='historical'?'oi1':null,
      status:shape==='historical'?'pending':'draft',supplier_order_id:null},
    line:{purchase_order_id:'po1',order_item_id:'oi1'},executionCount:0,paymentCount:0,
  },
  expected:{shape,poId:'po1',orderId:'o1',orderItemId:'oi1'},
});
for(const shape of ['grouped','historical']) {
  test(shape+' non-submitted PO: observed DB shape and absence of supplier execution',()=>{
    const {facts,expected}=shapeFacts(shape), result=assessUnsubmittedPo(facts,expected);
    assert.equal(result.verdict,'NO_RECORDED_SUPPLIER_EXECUTION');
    assert.deepEqual(result.issues,[]);
    assert.equal(result.persisted_status,shape==='grouped'?'draft':'pending');
  });
}
for(const [name,poison,code] of [
  ['actual shape changed',x=>{x.facts.po.order_id='another-order'},'PO_SHAPE_MISMATCH'],
  ['supplier confirmation already recorded',x=>{x.facts.po.supplier_order_id='EXT-ORDER'},'SUPPLIER_ORDER_ALREADY_RECORDED'],
  ['line diverted',x=>{x.facts.line.order_item_id='other'},'PURCHASE_LINE_FOREIGN_ITEM'],
  ['execution exists despite unsubmitted PO',x=>{x.facts.executionCount=1},'EXECUTION_BEFORE_SUBMISSION'],
  ['payment exists before submission',x=>{x.facts.paymentCount=1},'PAYMENT_BEFORE_SUBMISSION'],
]) {
  test('poisoned checkpoint detects '+name,()=>{
    const x=shapeFacts('grouped');poison(x);
    const r=assessUnsubmittedPo(x.facts,x.expected);
    assert.equal(r.verdict,'UNSUBMITTED_PO_CONTRADICTION_HYPOTHESIS');
    assert.ok(r.issues.includes(code));
  });
}
test('historical pending PO with wrong owner cannot be certified',()=>{
  const x=shapeFacts('historical');x.facts.po.order_id='other';
  const r=assessUnsubmittedPo(x.facts,x.expected);
  assert.ok(r.issues.includes('PO_FOREIGN_ORDER'));
});
