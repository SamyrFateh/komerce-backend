'use strict';
const fs=require('node:fs'),path=require('node:path');
const {STAGE_IDS,M02_STAGE_IDS,graphFor,scenarioProfile,loadScenarioStages,loadGoldenStages,stageGraph}=require('../../scripts/recette/canonical/stage-registry');
const {buyerParams,M01_PRODUCT_REF,M01_MARKET_PRICE}=require('../../scripts/recette/canonical/scenario-profile');
const {planBoundResume}=require('../../scripts/recette/canonical/resume-preflight');
const {finStatements}=require('../../scripts/recette/canonical/local-stock-oracles');
const {validateStageModuleSources,validateChromiumScriptSources}=require('../../scripts/recette/canonical/chromium-policy');
const ROOT=path.resolve(__dirname,'../..');
const HUB=/^(HUB_|FORWARDER$|CUSTOMS$|RELAY_RECEIPT$|CLIENT_PICKUP$)/;
describe('G6 M02 LOCAL_STOCK',()=>{
 it('la séquence M02 ne contient aucune étape Hub ni transport import',()=>{
  expect(M02_STAGE_IDS).toEqual(['BUYER','RELAY_CASH','LOCAL_RELAY_AVAILABLE','LOCAL_CLIENT_PICKUP']);
  expect(M02_STAGE_IDS.filter(id=>HUB.test(id))).toEqual([]);
  const g=graphFor('M02');
  expect(g.order).toEqual(M02_STAGE_IDS);
  expect(g.byId.get('LOCAL_RELAY_AVAILABLE').roles).toEqual(['agent_relais']);
 });
 it('refuse un scénario inconnu',()=>{
  for(const bad of ['M03','m02','',undefined,null,'M01;M02'])expect(()=>scenarioProfile(bad)).toThrow('G6_UNSUPPORTED_SCENARIO');
  expect(()=>graphFor('M99')).toThrow('G6_UNSUPPORTED_SCENARIO');
  expect(()=>buyerParams({G6_CANONICAL_SCENARIO:'M07'})).toThrow('G6_UNSUPPORTED_SCENARIO');
 });
 it('M01 reste strictement identique',()=>{
  expect(graphFor('M01').order).toEqual(stageGraph(loadGoldenStages()).order);
  expect(graphFor('M01').order).toEqual(STAGE_IDS);
  expect(loadScenarioStages('M01').map(s=>s.id)).toEqual(STAGE_IDS);
  for(const [m,price] of [['KM',5990],['CM',7987],['CG',7987]]){
   // Les variables M02 éventuellement présentes ne doivent jamais influencer M01.
   const p=buyerParams({G6_CANONICAL_SCENARIO:'M01',G6_TARGET_MARKET:m,G6_BUYER_PRODUCT_REF:'KPR-999999',G6_BUYER_EXPECTED_PRICE:'1'});
   expect(p).toEqual({scenario:'M01',market:m,product_ref:'KPR-000165',expected_price:price,source:'FIXED_CATALOGUE',fulfillment:null});
  }
  expect(M01_PRODUCT_REF).toBe('KPR-000165');
  expect(M01_MARKET_PRICE).toEqual({KM:5990,CM:7987,CG:7987});
  expect(buyerParams({G6_TARGET_MARKET:'KM'}).product_ref).toBe('KPR-000165');
 });
 it('M02 exige un produit LOCAL_STOCK lié',()=>{
  expect(()=>buyerParams({G6_CANONICAL_SCENARIO:'M02',G6_TARGET_MARKET:'CM'})).toThrow('G6_M02_LOCAL_STOCK_PRODUCT_NOT_BOUND');
  expect(buyerParams({G6_CANONICAL_SCENARIO:'M02',G6_TARGET_MARKET:'CM',G6_BUYER_PRODUCT_REF:'KPR-000321',G6_BUYER_EXPECTED_PRICE:'7987'}))
   .toMatchObject({product_ref:'KPR-000321',expected_price:7987,fulfillment:'LOCAL_STOCK'});
 });
 it('le plan de reprise M02 ne traverse que la chaîne locale',()=>{
  const ctx={scenario_id:'M02',market:'KM',order_id:'11111111-1111-4111-8111-111111111111',order_reference:'KABCDEF',
   staging_sha:'a'.repeat(40),db_fingerprint:'fp',production_permitted:false};
  const cp=['BUYER'].map(stage_id=>({stage_id,source_run_id:'12345678',evidence_path:'test-results/x.json',scenario_id:'M02',market:'KM',
   order_id:ctx.order_id,order_reference:ctx.order_reference,db_fingerprint:'fp',staging_sha:ctx.staging_sha,verdict:'PASS',production_permitted:false}));
  expect(planBoundResume({fromStage:'RELAY_CASH',toStage:'LOCAL_CLIENT_PICKUP',context:ctx,checkpoints:cp}).stages)
   .toEqual(['RELAY_CASH','LOCAL_RELAY_AVAILABLE','LOCAL_CLIENT_PICKUP']);
  expect(()=>planBoundResume({fromStage:'RELAY_CASH',toStage:'HUB_PO',context:ctx,checkpoints:cp})).toThrow('G6_CANONICAL_PHASE_NOT_REGISTERED');
 });
 it('O-FIN est repris du fichier SQL (I1..I15, lecture seule)',()=>{
  const st=finStatements();
  expect(new Set(st.map(x=>x.label)).size).toBe(15);
  expect(st.every(x=>/^\s*(SELECT|WITH)\b/i.test(x.sql))).toBe(true);
 });
 it('politique Chromium inchangée et verte',()=>{
  expect(validateStageModuleSources()).toBe(STAGE_IDS.length);
  expect(validateChromiumScriptSources()).toBeGreaterThan(0);
 });
 it('workflow : titres M02 KM/CM/CG avec garde propriétaire, SHA et concurrence',()=>{
  const y=fs.readFileSync(path.join(ROOT,'.github/workflows/staging-g6-dynamic-fresh-buyer-cash.yml'),'utf8');
  for(const m of ['KM','CM','CG'])expect(y).toContain("'[staging-op] g6-dynamic-fresh-full-M02-"+m+"'");
  expect(y).toContain('github.actor == github.repository_owner');
  expect(y).toContain('E2E_EXPECTED_DEPLOY_SHA');
  expect(y).toContain('group: komerce-g6-canonical-real-transaction');
 });
});
