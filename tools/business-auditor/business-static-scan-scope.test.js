'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {included}=require('../../scripts/audit-logic');
test('business static scanner includes live services, routes, payments and sourcing',()=>{
 for(const file of ['services/payment-paypal.js','services/order-status-machine.js',
  'services/sourcing-candidate-import-service.js','routes/orders/cancel.js',
  'scripts/lib/logic-detectors.js'])
  assert.equal(included(file),true,'missing business code '+file);
});
test('auditor adversarial harnesses are infrastructure, not business runtime candidates',()=>{
 for(const file of ['tools/business-auditor/v33-orders-sourcing-child.js',
  'tools/business-auditor/v38-calibration-benchmark.js',
  'tools/business-auditor/v28-unified-engine.js'])
  assert.equal(included(file),false,'scanner should not flag its own intentional test cases '+file);
});
test('unrelated application tools remain covered, no broad tools suppression',()=>{
 assert.equal(included('tools/supplier-sync-service.js'),true);
 assert.equal(included('services/inventory-service.js'),true);
});
