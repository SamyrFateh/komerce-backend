/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {graphFor,scenarioProfile,STAGE_IDS}=require('../../scripts/recette/canonical/stage-registry');
const {buyerParams,basketLines}=require('../../scripts/recette/canonical/scenario-profile');
const N=require('../../scripts/recette/canonical/negative-scenarios');
const {humanDoubleClickOnce}=require('../../scripts/recette/canonical/actors/human-gestures');
const {validateStageModuleSources,validateChromiumScriptSources}=require('../../scripts/recette/canonical/chromium-policy');
const ROOT=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const U1='11111111-1111-4111-8111-111111111111',U2='22222222-2222-4222-8222-222222222222';
describe('G6-G4A scénarios négatifs N07, N09, N04, N33',()=>{
 it('séquences enregistrées dans stage-registry, M01 inchangé',()=>{
  expect(graphFor('N07').order).toEqual(['BUYER','N07_NO_DOUBLE_EFFECT']);
  expect(graphFor('N09').order).toEqual(['BUYER','N09_REMISE_REFUSED','N09_NOT_COLLECTED_ORACLE']);
  expect(graphFor('N04').order).toEqual(['N04_QTY_OVER_STOCK','N04_NO_EFFECT_ORACLE']);
  expect(graphFor('N33').order).toEqual(['BUYER','N33_SKU_ORACLE']);
  expect(graphFor('N09').order).not.toContain('RELAY_CASH');
  expect(graphFor('M01').order).toEqual(STAGE_IDS);
  expect(()=>scenarioProfile('N99')).toThrow('G6_UNSUPPORTED_SCENARIO');
 });
 it('paramètres : N07 = produit Golden, N33 = 2 SKU liés, M01 intact',()=>{
  expect(buyerParams({G6_CANONICAL_SCENARIO:'N07',G6_TARGET_MARKET:'CM'})).toMatchObject({scenario:'N07',product_ref:'KPR-000165',expected_price:7987,fulfillment:null});
  expect(buyerParams({G6_CANONICAL_SCENARIO:'M01',G6_TARGET_MARKET:'CM'}).scenario).toBe('M01');
  expect(()=>buyerParams({G6_CANONICAL_SCENARIO:'N33'})).toThrow('G6_N33_VARIANTS_NOT_BOUND');
  const v={product_ref:'KPR-000777',price:1000,skus:[{sku_id:U1,variant_combo:{couleur:'Noir'}},{sku_id:U2,variant_combo:{couleur:'Blanc'}}]};
  const p=buyerParams({G6_CANONICAL_SCENARIO:'N33',G6_TARGET_MARKET:'KM',G6_N33_VARIANTS:JSON.stringify(v)});
  expect(p.expected_price).toBe(2000);
  expect(basketLines(p).map(l=>l.sku_id)).toEqual([U1,U2]);
  v.skus[1].sku_id=U1;
  expect(()=>buyerParams({G6_CANONICAL_SCENARIO:'N33',G6_N33_VARIANTS:JSON.stringify(v)})).toThrow('G6_N33_VARIANTS_NOT_BOUND');
  expect(buyerParams({G6_CANONICAL_SCENARIO:'N04',G6_TARGET_MARKET:'KM',G6_BUYER_PRODUCT_REF:'KPR-000321',G6_BUYER_EXPECTED_PRICE:'5990'}).fulfillment).toBe('LOCAL_STOCK');
 });
 it('pickTwoSkus : deux combinaisons distinctes sinon null',()=>{
  expect(N.pickTwoSkus([{sku_id:U1,variant_combo:{a:1,b:2}},{sku_id:U2,variant_combo:{b:2,a:1}}])).toBeNull();
  expect(N.pickTwoSkus([{sku_id:U1,variant_combo:{a:1}},{sku_id:U2,variant_combo:{a:2}}])).toHaveLength(2);
  expect(N.pickTwoSkus([{sku_id:U1,variant_combo:null},{sku_id:U2,variant_combo:{}}])).toBeNull();
  expect(N.pickTwoSkus(null)).toBeNull();
 });
 it('sonde multi-SKU : lecture seule, verdict PREREQ_MISSING_MULTI_SKU sans produit',async()=>{
  expect(N.MULTI_SKU_SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
  await expect(N.resolveMultiSku({query:async()=>({rows:[]})},'KM')).rejects.toThrow('PREREQ_MISSING_MULTI_SKU_KM');
  const r=await N.resolveMultiSku({query:async()=>({rows:[{id:'p',product_ref:'KPR-000777',amount:'1000',skus:[{sku_id:U1,variant_combo:{c:'A'}},{sku_id:U2,variant_combo:{c:'B'}}]}]})},'KM');
  expect(r).toMatchObject({product_ref:'KPR-000777',price:1000});
  expect(read('scripts/recette/g6-prereq-probe.js')).toMatch(/PREREQ_MISSING_MULTI_SKU/);
 });
 it('verdicts SCREEN_MISSING / PRODUCT_GAP explicites',()=>{
  expect(N.classifyNegative('N07','x G6_N07_PRODUCT_GAP_DOUBLE_ORDER_2')).toBe('PRODUCT_GAP');
  expect(N.classifyNegative('N09','G6_N09_SCREEN_MISSING_NO_REFUSAL_OBSERVED')).toBe('SCREEN_MISSING');
  expect(N.classifyNegative('N33','PREREQ_MISSING_MULTI_SKU_KM')).toBe('PREREQ_MISSING_MULTI_SKU');
  expect(N.classifyNegative('N04','autre erreur')).toBeNull();
 });
 it("l'exception du double clic est réservée à N07",async()=>{
  await expect(humanDoubleClickOnce(null,{},{allowedFor:'N07',scenario:'M01'})).rejects.toThrow('G6_DOUBLE_CLICK_EXCEPTION_N07_ONLY');
  await expect(humanDoubleClickOnce(null,{},{scenario:'N07'})).rejects.toThrow('G6_DOUBLE_CLICK_EXCEPTION_N07_ONLY');
  expect(read('scripts/recette/g6-p2-buyer-order-real-chromium.js')).toMatch(/humanDoubleClickOnce\(null,confirm,\{allowedFor:'N07'\}\)/);
 });
 it('politique Chromium globale inchangée et valide pour les nouveaux fichiers',()=>{
  expect(validateStageModuleSources()).toBe(STAGE_IDS.length);
  expect(validateChromiumScriptSources()).toBeGreaterThan(0);
  expect(read('scripts/recette/canonical/chromium-policy.js')).toMatch(/RAW_GESTURE=/);
 });
 it('oracle N09 refuse un collected, une consommation de stock ou un cash',async()=>{
  const row=o=>({query:async sql=>/parcel_items/.test(sql)?{rows:[{n:0}]}:{rows:[{id:'o',user_id:'u',status:'pending',payment_status:'pending',display_total_amount:1,lines:1,qty:1,cash_count:0,control_count:0,allocations:1,consumed_allocations:0,purchase_lines:0,collected_scans:0,parcels:0,...o}]}});
  await expect(N.oracleN09(row({}),{orderId:'o'})).resolves.toMatchObject({collected_scans:0});
  await expect(N.oracleN09(row({status:'collected'}),{orderId:'o'})).rejects.toThrow('G6_N09_PRODUCT_GAP_COLLECTED');
  await expect(N.oracleN09(row({consumed_allocations:1}),{orderId:'o'})).rejects.toThrow('G6_N09_PRODUCT_GAP_STOCK_CONSUMED');
  await expect(N.oracleN09(row({cash_count:1}),{orderId:'o'})).rejects.toThrow('G6_N09_PRODUCT_GAP_CASH_EFFECT');
 });
 it('workflow : titres N07/N09/N04/N33 pour KM, CM et CG',()=>{
  const wf=read('.github/workflows/staging-g6-dynamic-fresh-buyer-cash.yml');
  for(const id of ['N07','N09','N04','N33'])for(const m of ['KM','CM','CG'])
   expect(wf).toContain("'[staging-op] g6-dynamic-fresh-full-"+id+'-'+m+"'");
 });
});
