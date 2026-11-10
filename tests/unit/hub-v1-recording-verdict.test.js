/** @test-kind unit @test-runner jest @test-requires none */
/**
 * @komerce-arch-lite
 * @role chromium-relay-scoped-recording-verdict-tests
 * @domain dashboard
 * @layer unit-test
 * @owner backend-core
 * @purpose Refuser les faux GO de visibilité E2E, tout en certifiant la navigation relay réellement autorisée.
 * @impact-areas dashboard, staging-only, authorization
 */
'use strict';
const {evaluateRecording}=require('../../scripts/recette/hub-v1-recording-verdict');
const base=()=>({
 role:'agent_relais',sha_stable:true,video_encrypted:true,trace_encrypted:true,
 blocked_writes:0,blocked_external:0,browser_errors:0,
 route_reads:[{path:'/admin/relais-live',http:200},{path:'/admin/action-center',http:200}],
 clicks:[{href:'/admin/relais-live',actual:'/admin/relais-live',kind:'REAL_UI_CLICK'}],
 found_fixture_refs:[],
 relay_scope:{identity_http:200,role_verified:true,action_center_http:200,central_admin_http:403}
});
describe('Hub V1 Chromium recording scope',()=>{
 test('Relay navigation PASS, but E2E fixture visibility remains unproven when not assigned',()=>{
  expect(evaluateRecording(base())).toBe('PASS_SCOPED_READONLY_RECORDING');
 });
 test('Relais never gains central Admin permission just to make the test green',()=>{
  const p=base();p.relay_scope.central_admin_http=200;
  expect(evaluateRecording(p)).toBe('HOLD_NOT_PROVEN');
 });
 test('Relais requires its own real action center API',()=>{
  const p=base();p.relay_scope.action_center_http=403;
  expect(evaluateRecording(p)).toBe('HOLD_NOT_PROVEN');
 });
 test('No false green from missing video, blocked writes, forbidden external requests or JS errors',()=>{
  for(const [field,value] of [['video_encrypted',false],['blocked_writes',1],['blocked_external',1],['browser_errors',1]]){
   const p=base();p[field]=value;expect(evaluateRecording(p)).toBe('HOLD_NOT_PROVEN');
  }
 });
 test('Admin/Hub retain the strict fixture visibility check',()=>{
  for(const role of ['admin','agent_hub']){
   const p=base();p.role=role;p.relay_scope=null;
   expect(evaluateRecording(p)).toBe('HOLD_NOT_PROVEN');
   p.found_fixture_refs=['E2E-HUB-V1-43BE86B3-KOM-101'];
   expect(evaluateRecording(p)).toBe('PASS_READONLY_RECORDING');
  }
 });
 test('Expected HTTP 200 for both pages and a real matching link click',()=>{
  const p=base();p.route_reads[1].http=403;expect(evaluateRecording(p)).toBe('HOLD_NOT_PROVEN');
  p.route_reads[1].http=200;p.clicks[0].actual='/admin';
  expect(evaluateRecording(p)).toBe('HOLD_NOT_PROVEN');
 });
});
