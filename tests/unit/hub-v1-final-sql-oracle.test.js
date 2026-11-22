'use strict';
/** @test-kind unit @test-runner jest @test-requires none
 * @brief Final independent SQL oracle must never promote a green Chromium run without actual READ ONLY PG readback.
 */
const fs=require('fs'),path=require('path');
jest.mock('../../db',()=>({pool:{end:jest.fn()}}));
jest.mock('../../scripts/recette/target-guard',()=>({confirmTarget:jest.fn()}));
const {evaluateEvidence}=require('../../scripts/recette/hub-v1-final-sql-oracle');
const RUN='A1B2C3D4';
const keys=['journey:handed_over','journey:forwarder_received','journey:in_transit',
 'journey:arrived','journey:customs_released','journey:local_delivery','relay:attest',
 'relay:collect','local:direct-receipt','local:collect'];
function fixture(){
 return {
  run8:RUN,verdict:'CHROMIUM_CLICKS_RECORDED_SQL_READBACK_PENDING',
  tests:Array.from({length:11},(_,i)=>({title:'path-'+i,status:'passed'})),
  gestures:[...keys,...Array.from({length:26},(_,i)=>'extra-'+i)].map(key=>({key,verdict:'CLICK_PASS',http:200})),
  transverse_t8:{verdict:'PASS_REAL_HUB_ARRIVAL_TWO_DIRECTOR_BROWSERS'},
  pickup_checks:[{verdict:'PASS'},{verdict:'PASS'}],
  t_cases:[{id:'T2',verdict:'CHROMIUM_UI_GUARD_API_PG_PASS_NO_SECOND_POST'},
           {id:'T2',verdict:'CHROMIUM_UI_GUARD_API_PG_PASS_NO_SECOND_POST'}],
 };
}
test('36 real clicks + 11 paths + T8 + pickup refusals + T2 guards accepted for SQL readback',()=>{
 expect(evaluateEvidence(fixture(),RUN)).toEqual([]);
});
test('a good global Playwright run alone does not certify missing physical or role proof',()=>{
 const x=fixture();
 x.gestures=x.gestures.filter(t=>t.key!=='journey:handed_over');
 x.transverse_t8.verdict='NOT_PROVEN';
 expect(evaluateEvidence(x,RUN)).toEqual(expect.arrayContaining([
  'CHROMIUM_GESTURE_NOT_PROVEN','MISSING_CHROMIUM_GESTURE_journey:handed_over',
  'T8_TWO_SESSION_PROOF_MISSING']));
});
test('stale fixture, incomplete suite or bad pickups must fail closed',()=>{
 const x=fixture();x.tests[9].status='skipped';x.pickup_checks[0].verdict='FAIL';
 expect(evaluateEvidence(x,'DEADBEEF')).toEqual(expect.arrayContaining([
   'EVIDENCE_RUN8_MISMATCH','CHROMIUM_NOT_11_OF_11','PICKUP_NEGATIVE_GUARDS_NOT_PROVEN']));
});
test('workflow runs independent oracle after Chromium and archives its report',()=>{
 const w=fs.readFileSync(path.resolve(__dirname,'../../.github/workflows/hub-v1-clicks-staging.yml'),'utf8');
 expect(w.indexOf('node scripts/recette/hub-v1-final-sql-oracle.js'))
  .toBeGreaterThan(w.indexOf('tests/staging-clicks/hub-v1-clicks.spec.js'));
 expect(w).toContain('test-results/hub-v1-clicks/final-sql-oracle.json');
 expect(w).toContain('komerce-g6-canonical-real-transaction');
});
