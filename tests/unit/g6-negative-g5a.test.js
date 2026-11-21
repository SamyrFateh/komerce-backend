/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {graphFor,STAGE_IDS}=require('../../scripts/recette/canonical/stage-registry');
const {buyerParams}=require('../../scripts/recette/canonical/scenario-profile');
const N=require('../../scripts/recette/canonical/negative-scenarios');
const {judgeN08,PARALLEL}=require('../../scripts/recette/canonical/n08-replay');
const {validateStageModuleSources,validateChromiumScriptSources}=require('../../scripts/recette/canonical/chromium-policy');
const ROOT=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const mk=rows=>{let i=0;return {query:async()=>({rows:rows[i++]})}};
describe('G6-G5A N08 (clé d\'idempotence concurrente) et N10 (webhook PSP simulé)',()=>{
 it('séquences et paramètres : M01 et N07 inchangés',()=>{
  expect(graphFor('N08').order).toEqual(['BUYER','N08_IDEMPOTENCY_ORACLE']);
  expect(graphFor('N10').order).toEqual(['BUYER','N10_WEBHOOK_ATTEMPTS','N10_NO_SETTLEMENT_ORACLE']);
  expect(graphFor('M01').order).toEqual(STAGE_IDS);
  for(const s of ['N08','N10'])expect(buyerParams({G6_CANONICAL_SCENARIO:s,G6_TARGET_MARKET:'CM'})).toMatchObject({scenario:s,product_ref:'KPR-000165',expected_price:7987,fulfillment:null});
  expect(buyerParams({G6_CANONICAL_SCENARIO:'N07',G6_TARGET_MARKET:'KM'})).toMatchObject({scenario:'N07',expected_price:5990});
  expect(buyerParams({G6_CANONICAL_SCENARIO:'M01',G6_TARGET_MARKET:'KM'})).toMatchObject({scenario:'M01',expected_price:5990});
  expect(validateStageModuleSources()).toBeGreaterThan(0);
  expect(validateChromiumScriptSources()).toBeGreaterThan(0);
  expect(N.isNegative('N08')&&N.isNegative('N10')).toBe(true);
 });
 const good=()=>({parallel_same_key:Array.from({length:PARALLEL},(_,i)=>i?{http:200,code:null,order_id:'o'}:{http:201,code:null,order_id:'o'}),
  different_content:{http:409,code:'idempotency_key_reused',order_id:null},no_key:{http:400,code:'idempotency_key_required',order_id:null},
  no_accepted_total:{http:428,code:'price_confirmation_required',order_id:null}});
 it('jugement N08 : conforme, puis chaque écart produit détecté',()=>{
  expect(judgeN08(good(),'o')).toEqual([]);
  const a=good();a.parallel_same_key[2]={http:201,code:null,order_id:'autre'};expect(judgeN08(a,'o')).toContain('SAME_KEY_OTHER_ORDER');
  const b=good();b.parallel_same_key[1]={http:409,code:'idempotency_in_progress',order_id:null};expect(judgeN08(b,'o')).toEqual([]);
  const c=good();c.different_content={http:201,code:null,order_id:'x'};expect(judgeN08(c,'o')).toContain('DIFFERENT_CONTENT_ACCEPTED');
  const d=good();d.no_key={http:201,code:null,order_id:'x'};expect(judgeN08(d,'o')).toContain('NO_KEY_ACCEPTED');
  const e=good();e.no_accepted_total={http:201,code:null,order_id:'x'};expect(judgeN08(e,'o')).toContain('NO_ACCEPTED_TOTAL_ORDER_CREATED');
  expect(judgeN08({parallel_same_key:[]},'o')).toEqual(['N08_REPLAY_INCOMPLETE']);
 });
 const order={user_id:'u',lines:1,qty:1,cash_count:0,control_count:0,payment_status:'pending',allocations:0,purchase_lines:0};
 it('oracle N08 : commande unique, ou écart produit',async()=>{
  await expect(N.oracleN08(mk([[{n:1}],[order],[{keys:1}]]),{orderId:'o',buyerId:'u'})).resolves.toMatchObject({orders_for_buyer:1,completed_keys:1});
  await expect(N.oracleN08(mk([[{n:2}]]),{orderId:'o',buyerId:'u'})).rejects.toThrow('G6_N08_PRODUCT_GAP_ORDERS_2');
  await expect(N.oracleN08(mk([[{n:1}],[{...order,qty:2}]]),{orderId:'o',buyerId:'u'})).rejects.toThrow('G6_N08_PRODUCT_GAP_ORDER_LINES');
  await expect(N.oracleN08(mk([[{n:1}],[order],[{keys:2}]]),{orderId:'o',buyerId:'u'})).rejects.toThrow('G6_N08_PRODUCT_GAP_COMPLETED_KEYS_2');
 });
 const snap={payment_status:'pending',status:'pending',cash_count:0,psp_events:0,tx_status:'initiated',tx_updated_at:'t'};
 it('oracle N10 : aucun règlement, aucun événement PSP, transaction inchangée',()=>{
  expect(N.oracleN10(snap,{...snap})).toMatchObject({payment_status:'pending',psp_events:0});
  expect(()=>N.oracleN10(snap,{...snap,payment_status:'paid'})).toThrow('G6_N10_PRODUCT_GAP_ORDER_SETTLED');
  expect(()=>N.oracleN10(snap,{...snap,cash_count:1})).toThrow('G6_N10_PRODUCT_GAP_PAYMENT_RECORDED');
  expect(()=>N.oracleN10(snap,{...snap,psp_events:1})).toThrow('G6_N10_PRODUCT_GAP_UNSIGNED_EVENT_RECORDED');
  expect(()=>N.oracleN10(snap,{...snap,tx_status:'succeeded'})).toThrow('G6_N10_PRODUCT_GAP_MOBILE_MONEY_TX_CHANGED');
 });
 it('workflow : titres N08/N10 pour KM, CM et CG, sondes signalées, N10 sans écran',()=>{
  const wf=read('.github/workflows/staging-g6-dynamic-fresh-buyer-cash.yml');
  for(const id of ['N08','N10'])for(const m of ['KM','CM','CG'])expect(wf).toContain("'[staging-op] g6-dynamic-fresh-full-"+id+'-'+m+"'");
  const n10=read('scripts/recette/g6-negative-n10-webhook-chromium.js');
  expect(n10).toMatch(/API_PROBE_NO_SCREEN_GESTURE/);expect(n10).toMatch(/NOT_APPLICABLE/);expect(n10).toMatch(/SIGNED_DUPLICATE_NOT_PROVABLE_NO_PSP_SECRET/);
  expect(read('scripts/recette/canonical/n08-replay.js')).toMatch(/API_PROBE_NO_SCREEN_GESTURE/);
 });
});
