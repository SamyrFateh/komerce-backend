/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {expectedPriorCollectScans}=require('../../scripts/recette/canonical/pickup-scan-baseline');
describe('G6 M03 pickup scan baselines',()=>{
 test.each([
  ['M03','LOCAL_CLIENT_PICKUP',0],
  ['M03','CLIENT_PICKUP',1],
  ['M01','CLIENT_PICKUP',0],
  ['M02','LOCAL_CLIENT_PICKUP',0],
  ['N21','LOCAL_CLIENT_PICKUP',0],
  ['N22','LOCAL_CLIENT_PICKUP',0]
 ])('%s phase %s has %i prior collected scans',(scenario,phase,expected)=>{
  expect(expectedPriorCollectScans(scenario,phase)).toBe(expected);
 });
 test('real Chromium POST and independent PostgreSQL code scans remain mandatory',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../../scripts/recette/g6-canonical-client-pickup-chromium.js'),'utf8');
  expect(src).toContain('expectedPriorCollectScans(env.G6_CANONICAL_SCENARIO,env.G6_CANONICAL_PHASE)');
  expect(src).toContain('const MIXED=LOCAL_MIXED');
  expect(src).toContain('await humanClick(null,button);const res=await pending');
  expect(src).toContain('once.collect_scans===1+PRE&&once.code_scans===1+PRE');
  expect(src).toContain('G6_M03_ORDER_COLLECTED_BEFORE_IMPORT_DELIVERY');
  expect(src).toContain('report.pickup_scan_oracle=');
 });
});
