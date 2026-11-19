/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {classify,buildPlan,assertGestureAllowed}=require('../../scripts/recette/canonical/g6-cleanup-core');
const {assertGestureSourceUsesHelper,assertStageSqlWritesIdentityOnly,assertTraceStartsAfterAuth,assertStageSourceSafe}=require('../../scripts/recette/canonical/chromium-policy');
const SCRIPT=path.join(__dirname,'../../scripts/recette/g6-cleanup-recette-chromium.js');
const G6='G6-BUYER';
const peer=(ref,scope=G6)=>({reference:ref,simulation_scope:scope});
const E=({ref='K1',status='confirmed',mode='cash_relais',scope=G6,lines=[],peers={}}={})=>
 ({order:{id:'o-'+ref,reference:ref,market:'KM',status,payment_mode:mode,simulation_scope:scope},lines,po_peers:peers});
const L=(id,po,st)=>({line_id:id,po_id:po,po_status:st});

test('classification A/B/C/D',()=>{
 expect(classify(E({lines:[L('l1','p1','draft')],peers:{p1:[peer('K1')]}})).class).toBe('A');
 expect(classify(E({lines:[L('l1',null,null)]})).class).toBe('B');
 expect(classify(E({lines:[]})).class).toBe('B');
 expect(classify(E({status:'ordered',lines:[L('l1','p1','notified')],peers:{p1:[peer('K1')]}})).class).toBe('C');
 expect(classify(E({lines:[L('l1','p1','confirmed')],peers:{p1:[peer('K1')]}})).class).toBe('C');
 expect(classify(E({lines:[L('l1','p1','hub_received')],peers:{p1:[peer('K1')]}})).class).toBe('D');
 expect(classify(E({status:'available'})).class).toBe('D');
});
test('gestures per class and screen-missing cases',()=>{
 const a=classify(E({lines:[L('l1','p1','draft'),L('l2',null,null)],peers:{p1:[peer('K1')]}}));
 expect(a.gestures.map(g=>g.action)).toEqual(['discard_po','cancel_line','cancel_line','cancel_order']);
 const c=classify(E({lines:[L('l1','p1','notified')],peers:{p1:[peer('K1')]}}));
 expect(c.gestures.map(g=>g.action)).toEqual(['cancel_order']);
 expect(c.missing).toContain('PO_ENGAGED');
 const d=classify(E({status:'preparation',lines:[L('l1','p1','hub_received')],peers:{p1:[peer('K1')]}}));
 expect(d.verdict).toBe('SCREEN_MISSING');expect(d.gestures).toEqual([]);
 expect(classify(E({status:'ordered'}),{cutoff:'ordered'}).missing).toContain('CUTOFF');
 expect(classify(E({mode:'stripe_eur'})).missing).toContain('PAYMENT_MODE');
});
test('a PO shared with a non-G6 order is refused, with no gesture',()=>{
 const r=classify(E({lines:[L('l1','p1','draft')],peers:{p1:[peer('K1'),peer('X9',null)]}}));
 expect(r.verdict).toBe('REFUSED');expect(r.reason).toBe('MIXED_PO');expect(r.gestures).toEqual([]);
 expect(buildPlan([E({lines:[L('l1','p1','draft')],peers:{p1:[peer('K1'),peer('X9','OTHER')]}})]).steps).toEqual([]);
 // pairs illisibles : fail-closed
 expect(classify(E({lines:[L('l1','p1','draft')],peers:{}})).verdict).toBe('REFUSED');
});
test('no gesture outside G6-BUYER, plan order and guard',()=>{
 const out=classify(E({ref:'R1',scope:null}));
 expect(out.verdict).toBe('REFUSED');expect(out.gestures).toEqual([]);
 const plan=buildPlan([
  E({ref:'C1',status:'ordered',lines:[L('c','pc','notified')],peers:{pc:[peer('C1')]}}),
  E({ref:'B1',lines:[L('b',null,null)]}),
  E({ref:'A1',lines:[L('a','pa','draft')],peers:{pa:[peer('A1')]}}),
  E({ref:'N1',scope:null})]);
 expect(plan.steps.map(s=>s.action+':'+s.reference)).toEqual(
  ['discard_po:A1','cancel_line:A1','cancel_line:B1','cancel_order:A1','cancel_order:B1','cancel_order:C1']);
 expect(assertGestureAllowed(plan.steps[0],plan)).toBe(true);
 expect(()=>assertGestureAllowed({action:'cancel_order',order_id:'o-N1',reference:'N1'},plan)).toThrow('G6_CLEANUP_ORDER_NOT_PLANNED');
 expect(()=>assertGestureAllowed({action:'cancel_order',order_id:'o-X',reference:'A1'},plan)).toThrow('G6_CLEANUP_GESTURE_NOT_IN_PLAN');
 expect(()=>assertGestureAllowed({action:'refund',reference:'A1'},plan)).toThrow('G6_CLEANUP_ACTION_FORBIDDEN');
});
test('chromium-policy: only human helpers, no SQL write, trace after auth',()=>{
 expect(assertGestureSourceUsesHelper(SCRIPT)).toBe(true);
 expect(assertStageSqlWritesIdentityOnly(SCRIPT)).toBe(true);
 expect(assertTraceStartsAfterAuth(SCRIPT)).toBe(true);
 expect(assertStageSourceSafe(path.join(__dirname,'../../scripts/recette/canonical/g6-cleanup-core.js'))).toBe(true);
 expect(()=>assertGestureSourceUsesHelper('x-chromium.js','await page.locator("a").click()')).toThrow();
 const src=fs.readFileSync(SCRIPT,'utf8');
 expect(src).toMatch(/BEGIN READ ONLY/);
 expect(src).toMatch(/simulation_scope=\$1/);
});
