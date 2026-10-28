'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {compare}=require('./v14-baseline-gate');
const baseline=require('./v14-sequence-baseline.json');
const expected=()=>({contract:'komerce-business-sequence-exploration-verdict/v14',
 plannedCases:68,evaluatedSteps:238,knownFamilySignals:32,candidateNewFamilySignals:0,
 exceptions:[],signalCounts:{ASSIGNMENT_COUNT_DISAGREES_WITH_DB:18,OPEN_EMPTY_PARCEL_CREATED:14}});
test('known exploration baseline passes without accepting anomalies as correct',()=>{
 assert.equal(compare(baseline,expected()).verdict,'NO_BASELINE_DRIFT');
});
test('new unknown-family signal requires explicit review',()=>{
 const v=expected();v.candidateNewFamilySignals=1;v.signalCounts.NEW_FAMILY=1;
 const result=compare(baseline,v);
 assert.equal(result.verdict,'REVIEW_REQUIRED');
 assert.ok(result.changes.some(c=>c.key==='rule:NEW_FAMILY'));
});
test('correction to known bug family also requires explicit review',()=>{
 const v=expected();v.knownFamilySignals=31;v.signalCounts.OPEN_EMPTY_PARCEL_CREATED=13;
 assert.equal(compare(baseline,v).verdict,'REVIEW_REQUIRED');
});
test('invalid inputs are separate tool errors',()=>{
 assert.throws(()=>compare({},expected()),/TOOL_ERROR/);
});
