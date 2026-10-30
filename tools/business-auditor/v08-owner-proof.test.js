'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {qualifyPayPalJest,EXPECTED}=require('./v08-owner-proof');
const meta={sha:'a'.repeat(40),runId:'456'};
const report=()=>({success:true,numFailedTests:0,numPassedTests:3,
 testResults:[{assertionResults:EXPECTED.map(title=>({title,status:'passed'}))}]});
test('three same-run observed tests produce mock-only, not financial, owner proof',()=>{
 const x=qualifyPayPalJest(report(),meta);
 assert.equal(x.testsPassed,3);
 assert.equal(x.businessOwnerInvokedInTest,true);
 assert.equal(x.duplicateMoneyMovementProven,false);
 assert.equal(x.productionIncidentConfirmed,false);
});
test('missing, failed, duplicated or externally unattributed reports fail closed',()=>{
 const j=report();j.testResults[0].assertionResults[0].status='failed';
 assert.throws(()=>qualifyPayPalJest(j,meta),/Missing/);
 const k=report();k.testResults[0].assertionResults[0].title='fabricated';
 assert.throws(()=>qualifyPayPalJest(k,meta),/Missing/);
 const m=report();m.testResults[0].assertionResults[0].title=EXPECTED[1];
 assert.throws(()=>qualifyPayPalJest(m,meta),/Missing\/duplicate/);
 assert.throws(()=>qualifyPayPalJest(report(),{sha:'forged',runId:'456'}),/CI run identity/);
 assert.throws(()=>qualifyPayPalJest({...report(),numPassedTests:2},meta),/not green/);
});
