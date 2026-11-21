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
 expect(c.gestures.map(g=>g.action)).toEqual(['cancel_g6_po','cancel_order']);
 expect(c.missing).toEqual([]);
 const d=classify(E({status:'preparation',lines:[L('l1','p1','hub_received')],peers:{p1:[peer('K1')]}}));
 expect(d.verdict).toBe('PLANNED');expect(d.gestures.map(g=>g.action)).toEqual(['close_hub_order']);
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
  ['discard_po:A1','cancel_line:A1','cancel_line:B1','cancel_g6_po:C1','cancel_order:A1','cancel_order:B1','cancel_order:C1']);
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

test('cutoff bloque à partir du statut de coupure, pas avant',()=>{
 const {cutoffBlocks}=require('../../scripts/recette/canonical/g6-cleanup-core');
 expect(cutoffBlocks('ordered','shipped')).toBe(false);
 expect(cutoffBlocks('preparation','shipped')).toBe(false);
 expect(cutoffBlocks('available','shipped')).toBe(true);
});

test('G6-C grouped PO deduped and G6-D Hub closure ordered after C',()=>{
 const c1=E({ref:'C1',status:'ordered',lines:[L('a','po1','confirmed')],peers:{po1:[peer('C1'),peer('C2')]}});
 const c2=E({ref:'C2',status:'ordered',lines:[L('b','po1','confirmed')],peers:{po1:[peer('C1'),peer('C2')]}});
 const d=E({ref:'D1',status:'available',lines:[L('d','po2','hub_received')],peers:{po2:[peer('D1')]}});
 const plan=buildPlan([c1,c2,d]);
 expect(plan.steps.filter(g=>g.action==='cancel_g6_po')).toHaveLength(1);
 expect(plan.steps.filter(g=>g.action==='close_hub_order')).toHaveLength(1);
 expect(plan.steps.at(-1)).toMatchObject({action:'close_hub_order',reference:'D1'});
 const mixed=classify(E({ref:'D2',status:'available',lines:[L('d','p3','received')],peers:{p3:[peer('D2'),peer('LIVE','LIVE')]}}));
 expect(mixed).toMatchObject({verdict:'REFUSED',reason:'MIXED_PO'});
});


test('C_PO: commandes déjà annulées, PO engagé 100% G6 cash : geste unique sans annuler de commande',()=>{
 const po={po_id:'po-orphan',po_status:'confirmed',legacy_order_id:null,line_count:2,
  has_physical:false,has_debit:false,peers:[
   {order_id:'o-a',reference:'C-A',simulation_scope:G6,payment_mode:'cash_relais',order_status:'cancelled'},
   {order_id:'o-b',reference:'C-B',simulation_scope:G6,payment_mode:'cash_relais',order_status:'cancelled'}]};
 const plan=buildPlan([],{orphanPos:[po]});
 expect(plan.poItems[0]).toMatchObject({class:'C_PO',verdict:'PLANNED'});
 expect(plan.steps).toEqual([{action:'cancel_g6_po',po_id:'po-orphan',reference:'C-A',class:'C_PO'}]);
 expect(assertGestureAllowed(plan.steps[0],plan)).toBe(true);
 expect(()=>assertGestureAllowed({...plan.steps[0],po_id:'another-po'},plan))
  .toThrow('G6_CLEANUP_ORDER_NOT_PLANNED');
});

test('C_PO fail-closed : PO mixte, commande vivante, réception, débit, ligne sans pair et PO non groupé',()=>{
 const {classifyOrphanPo}=require('../../scripts/recette/canonical/g6-cleanup-core');
 const safe={po_id:'po-1',po_status:'notified',legacy_order_id:null,line_count:1,
  has_physical:false,has_debit:false,peers:[
   {order_id:'o-a',reference:'C-A',simulation_scope:G6,payment_mode:'cash_relais',order_status:'cancelled'}]};
 for(const [edit,reason] of [
  [x=>x.peers[0].simulation_scope='REAL','MIXED_PO'],
  [x=>x.peers[0].payment_mode='stripe_eur','PAYMENT_MODE'],
  [x=>x.peers[0].order_status='ordered','PO_PEER_NOT_CANCELLED'],
  [x=>x.has_physical=true,'PO_PHYSICAL_RECEIVED'],
  [x=>x.has_debit=true,'PO_REAL_SUPPLIER_DEBIT'],
  [x=>x.line_count=2,'PO_PEER_INCOMPLETE'],
  [x=>x.legacy_order_id='o-a','PO_NOT_GROUPED'],
 ]) {
  const po=JSON.parse(JSON.stringify(safe));edit(po);
  expect(classifyOrphanPo(po)).toMatchObject({verdict:'REFUSED',reason,gestures:[]});
  expect(buildPlan([],{orphanPos:[po]}).steps).toEqual([]);
 }
});

test('C_PO ne duplique pas le geste d’un PO déjà traité en classe C vivante',()=>{
 const po={po_id:'p1',po_status:'notified',legacy_order_id:null,line_count:1,
  has_physical:false,has_debit:false,peers:[
   {order_id:'o-K1',reference:'K1',simulation_scope:G6,payment_mode:'cash_relais',order_status:'ordered'}]};
 const plan=buildPlan([E({ref:'K1',status:'ordered',lines:[L('l1','p1','notified')],peers:{p1:[peer('K1')]}})],{orphanPos:[po]});
 expect(plan.steps.filter(s=>s.action==='cancel_g6_po')).toHaveLength(1);
 expect(plan.poItems[0].reason).toBe('PO_PEER_NOT_CANCELLED');
});

test('G6 PO orphan inventory is independently read-only, not restricted to live order IDs',()=>{
 const src=fs.readFileSync(SCRIPT,'utf8');
 expect(src).toContain('BEGIN READ ONLY');
 expect(src).toContain('FROM purchase_orders po');
 expect(src).toContain('po.status::text IN (\'notified\',\'confirmed\')');
 expect(src).toContain('WHERE scoped.purchase_order_id=po.id AND so.simulation_scope=$1');
 expect(src).toContain('report.po_audit=');
 expect(src).not.toMatch(/(?:UPDATE|DELETE FROM)\s+purchase_orders\b/i);
});

// G6-CLEANUP-D : sous-classes de la classe D et geste de remise comptoir.
const F=(o={})=>({payment_status:'paid',relais_id:'r-1',has_secret:true,secret_blocked_until:null,hub_unit_count:0,box_linked:false,open_discrepancy:false,...o});
const ED=(facts,ref='K1',extra={})=>({...E({ref,status:'available',...extra}),facts});
test('D payée et disponible : remise comptoir, une mutation, pas de clôture Hub',()=>{
 const r=classify(ED(F()));
 expect(r.class).toBe('D');expect(r.d_class).toBe('D_PAID_AVAILABLE');
 expect(r.gestures.map(g=>g.action)).toEqual(['handover_relay']);
 expect(r.gestures[0]).toMatchObject({relais_id:'r-1',market:'KM'});
});
test('D écart N20 : remise de la quantité constatée, résolution d’incident signalée manquante',()=>{
 const r=classify(ED(F({open_discrepancy:true})));
 expect(r.d_class).toBe('D_DISCREPANCY');expect(r.gestures.map(g=>g.action)).toEqual(['handover_relay']);
 expect(r.proposal).toBe('SCREEN_MISSING_INCIDENT_RESOLUTION');
});
test('D KOM-BOX figée : SCREEN_MISSING avec proposition, aucun geste',()=>{
 const r=classify(ED(F({box_linked:true})));
 expect(r.d_class).toBe('D_BOX_FROZEN');expect(r.verdict).toBe('SCREEN_MISSING');
 expect(r.missing).toContain('KOM_BOX_FROZEN');expect(r.gestures).toEqual([]);expect(r.reason).toMatch(/Solder la recette/);
});
test('D non remettable (impayée, sans code ou sans relais) : SCREEN_MISSING sans geste',()=>{
 for(const f of [F({payment_status:'pending'}),F({has_secret:false}),F({relais_id:null})]){
  const r=classify(ED(f));expect(r.verdict).toBe('SCREEN_MISSING');expect(r.gestures).toEqual([]);
 }
});
test('D marchandise Hub reste sur la clôture Hub ; sans faits, comportement historique',()=>{
 expect(classify(ED(F({hub_unit_count:2}))).gestures.map(g=>g.action)).toEqual(['close_hub_order']);
 expect(classify(E({status:'available'})).gestures.map(g=>g.action)).toEqual(['close_hub_order']);
});
test('remise : refus hors G6-BUYER, PO mixte refusé, ordre après les clôtures Hub, garde du plan',()=>{
 expect(classify(ED(F(),'K2',{scope:'OTHER'})).gestures).toEqual([]);
 expect(classify(ED(F(),'K3',{scope:'OTHER'})).reason).toBe('NOT_G6_BUYER');
 const mixed=classify(ED(F(),'K4',{lines:[L('l1','p1','received')],peers:{p1:[peer('K4'),peer('X',null)]}}));
 expect(mixed.reason).toBe('MIXED_PO');expect(mixed.gestures).toEqual([]);
 const plan=buildPlan([ED(F(),'KA'),{...E({ref:'KB',status:'preparation',lines:[L('l1','p1','hub_received')],peers:{p1:[peer('KB')]}})}]);
 expect(plan.steps.map(s=>s.action)).toEqual(['close_hub_order','handover_relay']);
 expect(assertGestureAllowed(plan.steps[1],plan)).toBe(true);
 expect(()=>assertGestureAllowed({...plan.steps[1],reference:'KZ',order_id:'o-KZ'},plan)).toThrow(/NOT_PLANNED/);
});
test('chromium-policy : child de remise sans clic brut ni écriture SQL métier',()=>{
 const child=path.join(__dirname,'../../scripts/recette/g6-cleanup-handover-chromium.js');
 expect(assertGestureSourceUsesHelper(child)).toBe(true);
 expect(assertStageSqlWritesIdentityOnly(child)).toBe(true);
 expect(assertTraceStartsAfterAuth(child)).toBe(true);
});
