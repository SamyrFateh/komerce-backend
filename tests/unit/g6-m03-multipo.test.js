/** @test-kind unit @test-runner jest @test-requires none */
/** @komerce-arch-lite
 * @role g6-m03-multipo-unit
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Unit proof of the M03 multi-PO import loop: per-PO plan, N=1 identical to M01, refusal of multi-supplier PO, chromium policy.
 * @impact-areas staging-only
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const mp=require('../../scripts/recette/canonical/multi-po');
const {classifyGap}=require('../../scripts/recette/canonical/m03-import-stages');
const chromium=require('../../scripts/recette/canonical/chromium-policy');
const ROOT=path.join(__dirname,'../..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const MARKET=id(900);
// Une ligne IMPORT (qté 1) sur son propre PO mono-fournisseur et mono-marché.
const row=(n,over={})=>({order_item_id:id(100+n),quantity:1,order_market:MARKET,line_id:id(200+n),po_id:id(300+n),
 line_supplier:id(400+n),po_supplier:id(400+n),po_market:MARKET,po_status:'draft',...over});
const rows=n=>Array.from({length:n},(_,i)=>row(i+1));
describe('M03 multi-PO import loop (G6-C2b)',()=>{
 test('N=3 : trois PO mono-fournisseur mono-marché, une itération par PO pour les étapes par PO',()=>{
  const inv=mp.shapeImportPos(rows(3));
  expect(inv.pos).toHaveLength(3);expect(inv.item_count).toBe(3);expect(inv.units).toBe(3);
  for(const stage of mp.PER_PO_STAGES){
   const plan=mp.planStage(stage,inv);
   expect(plan.map(p=>p.po_id)).toEqual(inv.pos.map(p=>p.po_id));
   expect(plan.map(p=>p.env)).toEqual(inv.pos.map(p=>({G6_CANONICAL_PO_ID:p.po_id})));
  }
 });
 test('N=3 : une seule itération par commande (sac consolidé unique) avec listes alignées',()=>{
  const inv=mp.shapeImportPos(rows(3));
  const recv=['SUPPLIER_PACKAGE-AAAAAAAA','SUPPLIER_PACKAGE-BBBBBBBB','SUPPLIER_PACKAGE-CCCCCCCC'],alloc=[id(1),id(2),id(3)];
  for(const stage of mp.ORDER_STAGES){
   const plan=mp.planStage(stage,inv,{receipts:recv,allocations:alloc});
   expect(plan).toHaveLength(1);
   const e=plan[0].env;
   expect(JSON.parse(e.G6_CANONICAL_PO_IDS)).toEqual(inv.pos.map(p=>p.po_id));
   expect(JSON.parse(e.G6_CANONICAL_RECEIPT_REFERENCES)).toEqual(recv);
   expect(JSON.parse(e.G6_CANONICAL_ALLOCATION_IDS)).toEqual(alloc);
   expect(e.G6_CANONICAL_IMPORT_ITEMS).toBe('3');expect(e.G6_CANONICAL_IMPORT_UNITS).toBe('3');
   // Les scripts relisent exactement ces listes.
   const sc=mp.importScope(e);
   expect(sc.pos).toEqual(inv.pos.map(p=>p.po_id));expect(sc.items).toBe(3);expect(sc.multi).toBe(true);
  }
  expect(()=>mp.orderEnv(inv,{receipts:recv.slice(0,2)})).toThrow('G6_MULTIPO_RECEIPTS_NOT_ONE_PER_PO');
 });
 test('N=1 : paramètres effectifs strictement identiques au chemin M01 (aucune clé en plus)',()=>{
  const inv=mp.shapeImportPos(rows(1),{minPos:1});
  for(const stage of [...mp.PER_PO_STAGES,...mp.ORDER_STAGES]){
   const plan=mp.planStage(stage,inv,{receipts:['SUPPLIER_PACKAGE-AAAAAAAA'],allocations:[id(1)]});
   expect(plan).toHaveLength(1);
   // M01 passe uniquement G6_CANONICAL_PO_ID au script ; les extras des scripts valent leurs défauts historiques.
   expect(plan[0].env).toEqual({G6_CANONICAL_PO_ID:inv.pos[0].po_id});
  }
  const single=mp.importScope({},{po:id(7),receipt:'SUPPLIER_PACKAGE-ZZZZZZZZ',allocation:id(8),item:id(9)});
  expect(single).toMatchObject({pos:[id(7)],receipts:['SUPPLIER_PACKAGE-ZZZZZZZZ'],allocations:[id(8)],itemIds:[id(9)],items:1,units:1,multi:false});
 });
 test('refus : un PO multi-fournisseur, multi-marché, un fournisseur sur deux PO, une ligne sans PO',()=>{
  const multiSupplier=[row(1),row(2,{po_id:id(301),line_id:id(202),line_supplier:id(999)}),row(3)];
  expect(()=>mp.shapeImportPos(multiSupplier)).toThrow('G6_MULTIPO_PO_NOT_MONO_SUPPLIER_'+id(301));
  const poSupplierDrift=[row(1),row(2,{po_supplier:id(998)}),row(3)];
  expect(()=>mp.shapeImportPos(poSupplierDrift)).toThrow('G6_MULTIPO_PO_NOT_MONO_SUPPLIER_'+id(302));
  const otherMarket=[row(1),row(2,{po_market:id(901)}),row(3)];
  expect(()=>mp.shapeImportPos(otherMarket)).toThrow('G6_MULTIPO_PO_NOT_MONO_MARKET_'+id(302));
  const sameSupplier=[row(1),row(2,{line_supplier:id(401),po_supplier:id(401)}),row(3)];
  expect(()=>mp.shapeImportPos(sameSupplier)).toThrow('G6_MULTIPO_SUPPLIER_ON_SEVERAL_POS');
  expect(()=>mp.shapeImportPos([row(1),row(2,{po_id:null}),row(3)])).toThrow('G6_MULTIPO_LINE_WITHOUT_PO_'+id(202));
  expect(()=>mp.shapeImportPos([row(1),row(2,{line_id:null,po_id:null}),row(3)])).toThrow('G6_MULTIPO_ITEM_WITHOUT_PURCHASE_LINE_'+id(102));
  expect(()=>mp.shapeImportPos(rows(2))).toThrow('G6_MULTIPO_POS_BELOW_3_GOT_2');
  expect(()=>mp.shapeImportPos([])).toThrow('G6_MULTIPO_NO_IMPORT_ITEM');
 });
 test('avant HUB_PO : lignes sans PO tolérées, mais un PO déjà formé reste contrôlé',()=>{
  expect(mp.shapeImportPos(rows(3).map(r=>({...r,po_id:null,po_supplier:null,po_market:null,po_status:null})),{requirePo:false}).pos).toHaveLength(0);
  expect(()=>mp.shapeImportPos([row(1,{po_supplier:id(5)})],{requirePo:false})).toThrow('G6_MULTIPO_PO_NOT_MONO_SUPPLIER');
 });
 test('lecture des listes : JSON invalide ou vide refusé',()=>{
  expect(()=>mp.importScope({G6_CANONICAL_PO_IDS:'x'})).toThrow('G6_MULTIPO_ENV_NOT_JSON_G6_CANONICAL_PO_IDS');
  expect(()=>mp.importScope({G6_CANONICAL_PO_IDS:'[]'})).toThrow('G6_MULTIPO_ENV_NOT_LIST_G6_CANONICAL_PO_IDS');
  expect(()=>mp.importScope({G6_CANONICAL_IMPORT_ITEMS:'3',G6_CANONICAL_IMPORT_UNITS:'2'})).toThrow('G6_MULTIPO_COUNTS_INVALID');
  expect(()=>mp.planStage('HUB_PO',mp.shapeImportPos(rows(3)))).toThrow('G6_MULTIPO_STAGE_NOT_PLANNABLE_HUB_PO');
 });
 test('lecture PG : requête en lecture seule sur les lignes IMPORT',async()=>{
  expect(mp.IMPORT_SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
  const q=jest.fn().mockResolvedValue({rows:rows(3)});
  const inv=await mp.readImportInventory({query:q},id(1));
  expect(inv.pos).toHaveLength(3);expect(q).toHaveBeenCalledTimes(1);
  await expect(mp.readImportInventory({query:q},'pas-un-uuid')).rejects.toThrow('G6_MULTIPO_ORDER_ID_INVALID');
 });
 test('verdicts explicites : écran manquant ou manque produit, jamais contourné',()=>{
  expect(classifyGap('HUB_CUSTOMER_BAG','... G6_BAG_EXACT_ORDER_NOT_AVAILABLE')).toBe('SCREEN_MISSING');
  expect(classifyGap('RELAY_RECEIPT','G6_RELAY_UI_ITEM_NOT_UNIQUE')).toBe('SCREEN_MISSING');
  expect(classifyGap('HUB_KOM_BOX','G6_BOX_CLIENT_PARCEL_NOT_UNIQUE')).toBe('PRODUCT_GAP');
  expect(classifyGap('HUB_PO','G6_HUB_PO_PRODUCT_GAP_AUTO_PURCHASE_LINES_1_OF_3')).toBe('PRODUCT_GAP');
  expect(classifyGap('HUB_COMMITMENT','G6_COMMITMENT_UNEXPECTED_ORDINARY_BROWSER_WRITE')).toBeNull();
 });
 test('adaptateur : M01 inchangé, branche import M03 déléguée à la boucle par PO',()=>{
  const a=read('scripts/recette/canonical/real-buyer-cash-adapters.js');
  expect(a).not.toContain('G6_M03_SCREEN_MISSING_');
  expect(a).toContain("if(SCENARIO==='M03'&&M03_IMPORT_STAGES.includes(stageId))\n    return m03import.execute(stageId,context,finalMileIdentity);");
  // Le chemin M01 garde son unique PO via uniquePoId (une ligne, un PO, un colis).
  expect(a).toContain('const poId=await uniquePoId(db,context.order_id);');
  expect(a).toContain("G6_DYNAMIC_HUB_PO_ID_NOT_UNIQUE");
 });
 test('scripts paramétrés restent dans chromium-policy (gestes par helpers, aucune écriture SQL)',()=>{
  expect(chromium.validateStageModuleSources()).toBeGreaterThan(0);
  const dir=path.join(ROOT,'scripts/recette');
  const scripts=['g6-hub-customer-bag-chromium.js','g6-hub-kom-box-chromium.js','g6-hub-shipment-chromium.js','g6-canonical-forwarder-chromium.js',
   'g6-canonical-customs-chromium.js','g6-canonical-relay-receipt-chromium.js','g6-canonical-client-pickup-chromium.js'];
  for(const f of scripts){
   expect(()=>chromium.assertGestureSourceUsesHelper(path.join(dir,f))).not.toThrow();
   expect(()=>chromium.assertTraceStartsAfterAuth(path.join(dir,f))).not.toThrow();
   expect(read('scripts/recette/'+f)).toMatch(/\['M01','M03'(?:,'M06')?\]\.includes\(env\.G6_CANONICAL_SCENARIO\)/);
  }
  expect(()=>chromium.assertGestureSourceUsesHelper(path.join(ROOT,'tests/staging-clicks/g6-p3-kuyiyuk.spec.js'))).not.toThrow();
  for(const f of ['multi-po.js','m03-import-stages.js']){
   const p=path.join(ROOT,'scripts/recette/canonical',f);
   expect(chromium.sqlWriteTables(fs.readFileSync(p,'utf8'))).toEqual([]);
   expect(()=>chromium.assertGestureSourceUsesHelper(p)).not.toThrow();
  }
 });
 test('spec HUB_PO : M01 (sans itération) garde ses comptages historiques',()=>{
  const spec=read('tests/staging-clicks/g6-p3-kuyiyuk.spec.js');
  expect(spec).toContain("const MULTI=CANONICAL&&process.env.G6_CANONICAL_PO_ITERATION!==undefined");
  expect(spec).toContain("const EXPECT_PO=MULTI?ITER+1:1,EXPECT_LINES=MULTI?N_IMPORT:1;");
  expect(spec).toContain("if(!MULTI&&Number(afterCash.line_count)===0){");
  expect(spec).toContain("if(MULTI)expect(env.G6_CANONICAL_SCENARIO).toBe('M03');");
   expect(spec).toContain("else expect(['M01','M06']).toContain(env.G6_CANONICAL_SCENARIO);");
 });
});
