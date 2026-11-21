/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {SCENARIO_STAGE_IDS,M03_STAGE_IDS,STAGE_IDS,M02_STAGE_IDS,graphFor,scenarioProfile}=require('../../scripts/recette/canonical/stage-registry');
const {buyerParams,basketLines,M01_PRODUCT_REF}=require('../../scripts/recette/canonical/scenario-profile');
const {selectMixedBasket}=require('../../scripts/recette/canonical/m03-prereq');
const {evaluate,assertPhase}=require('../../scripts/recette/canonical/m03-oracles');
const chromium=require('../../scripts/recette/canonical/chromium-policy');
const {bootstrapFreshScenario}=require('../../scripts/recette/canonical/fresh-buyer-bootstrap');
const read=p=>fs.readFileSync(path.join(__dirname,'../..',p),'utf8');
const P=(ref,source,local=0)=>({id:ref,product_ref:ref,price:1000,source_key:source,local_available:local,import_ready:true});
const PRODUCTS=[P('KPR-000100','supplier:a',2),P('KPR-000200','supplier:a'),P('KPR-000201','supplier:b'),P('KPR-000202','supplier:c'),P('KPR-000203','central_hub')];
const basketEnv=()=>{const b=selectMixedBasket(PRODUCTS);const l=p=>({product_ref:p.product_ref,price:p.price,source_key:p.source_key});
 return {G6_CANONICAL_SCENARIO:'M03',G6_TARGET_MARKET:'KM',G6_M03_BASKET:JSON.stringify({local:l(b.local),imports:b.imports.map(l)})}};
const L=(f,rec=0,col=0,q=1)=>({fulfillment_source:f,quantity:q,qty_received:rec,qty_collected:col});
const snap=(status,local,imp)=>({order:{status},lines:[local,...imp],parcels:[]});
describe('G6 M03 mixed basket',()=>{
 test('sequence: local branch, key oracle, import branch, final oracle',()=>{
  expect(M03_STAGE_IDS).toEqual(['BUYER','RELAY_CASH','LOCAL_RELAY_AVAILABLE','LOCAL_CLIENT_PICKUP','M03_NOT_COLLECTED',
   ...STAGE_IDS.slice(2),'M03_COLLECTED_FINAL']);
  expect(graphFor('M03').order).toEqual(M03_STAGE_IDS);
  expect(scenarioProfile('M03')).toBe('M03');
 });
 test('M01 and M02 effective parameters strictly unchanged',()=>{
  expect(SCENARIO_STAGE_IDS.M01).toBe(STAGE_IDS);expect(SCENARIO_STAGE_IDS.M02).toBe(M02_STAGE_IDS);
  expect(STAGE_IDS).toHaveLength(15);expect(M02_STAGE_IDS).toEqual(['BUYER','RELAY_CASH','LOCAL_RELAY_AVAILABLE','LOCAL_CLIENT_PICKUP']);
  for(const [m,price] of [['KM',5990],['CM',7987],['CG',7987]]){
   const p=buyerParams({G6_TARGET_MARKET:m,G6_M03_BASKET:'{"x":1}'});
   expect(p).toEqual({scenario:'M01',market:m,product_ref:'KPR-000165',expected_price:price,source:'FIXED_CATALOGUE',fulfillment:null});
   expect(basketLines(p)).toEqual([{product_ref:'KPR-000165',price,fulfillment:null}]);
  }
  const p2=buyerParams({G6_CANONICAL_SCENARIO:'M02',G6_BUYER_PRODUCT_REF:'KPR-000100',G6_BUYER_EXPECTED_PRICE:'1000',G6_M03_BASKET:'{}'});
  expect(p2).toEqual({scenario:'M02',market:'KM',product_ref:'KPR-000100',expected_price:1000,source:'RESOLVED_LOCAL_STOCK',fulfillment:'LOCAL_STOCK'});
  expect(basketLines(p2)).toEqual([{product_ref:'KPR-000100',price:1000,fulfillment:'LOCAL_STOCK'}]);
 });
 test('multi-source selection: 1 local, 3 imports on distinct sources, effective params',()=>{
  const p=buyerParams(basketEnv());
  expect(p.fulfillment).toBe('MIXED');expect(p.expected_price).toBe(4000);
  expect(basketLines(p).map(l=>l.fulfillment)).toEqual(['LOCAL_STOCK','IMPORT','IMPORT','IMPORT']);
  expect(new Set(basketLines(p).filter(l=>l.source_key).map(l=>l.source_key)).size).toBe(3);
 });
 test('refuses fewer than 3 sources, M01 reference as local, missing or duplicate basket',()=>{
  expect(()=>selectMixedBasket(PRODUCTS.slice(0,3))).toThrow('G6_M03_IMPORT_SOURCES_BELOW_3');
  const e=basketEnv(),b=JSON.parse(e.G6_M03_BASKET);
  expect(()=>buyerParams({...e,G6_M03_BASKET:JSON.stringify({...b,imports:b.imports.slice(0,2)})})).toThrow('G6_M03_IMPORT_SOURCES_BELOW_3');
  expect(()=>buyerParams({...e,G6_M03_BASKET:JSON.stringify({...b,imports:b.imports.map(i=>({...i,source_key:'supplier:a'}))})})).toThrow('G6_M03_IMPORT_SOURCES_BELOW_3');
  expect(()=>buyerParams({...e,G6_M03_BASKET:JSON.stringify({...b,local:{...b.local,product_ref:M01_PRODUCT_REF}})})).toThrow('G6_M03_LOCAL_PRODUCT_IS_M01_REFERENCE');
  expect(()=>buyerParams({G6_CANONICAL_SCENARIO:'M03'})).toThrow('G6_M03_BASKET_NOT_BOUND');
 });
 test('bootstrap refuses a basket below 3 sources before any buyer gesture',async()=>{
  let buyerRan=false;
  const adapters={attestRuntimeBeforeBuyer:async()=>({environment:'staging',scenario_id:'M03',market:'KM',staging_sha:'a'.repeat(40),db_fingerprint:'f',production_permitted:false,attestation_origin:'INDEPENDENT_CHROMIUM_POSTGRESQL'}),
   resolveMixedBasket:async()=>({basket:{local:{product_ref:'KPR-000100',price:1,source_key:null},imports:[{product_ref:'KPR-000200',price:1,source_key:'a'},{product_ref:'KPR-000201',price:1,source_key:'b'},{product_ref:'KPR-000202',price:1,source_key:'b'}]}}),
   executeBuyerChromium:async()=>{buyerRan=true},verifyBuyerIndependently:async()=>{},persistEvidence:async()=>{},authenticateCheckpoint:async()=>{},attestRuntime:async()=>{},executeStage:async()=>{},verifyStageProof:async()=>{}};
  await expect(bootstrapFreshScenario({scenario:'M03',toStage:'RELAY_CASH',adapters})).rejects.toThrow('G6_FRESH_BOOTSTRAP_MIXED_BASKET_INVALID');
  expect(buyerRan).toBe(false);
 });
 test('key oracle: not collected after local handover, collected only after import delivery',()=>{
  const imp=[L('IMPORT'),L('IMPORT'),L('IMPORT')];
  expect(evaluate(snap('preparation',L('LOCAL_STOCK',1,1),imp),'local_collected')).toEqual([]);
  expect(evaluate(snap('collected',L('LOCAL_STOCK',1,1),imp),'local_collected')).toContain('order_collected_before_import_delivery');
  expect(evaluate(snap('preparation',L('LOCAL_STOCK',1,1),[L('IMPORT',1,1),L('IMPORT'),L('IMPORT')]),'local_collected')).toContain('import_collected_before_delivery');
  expect(()=>assertPhase(snap('collected',L('LOCAL_STOCK',1,1),imp),'local_collected')).toThrow('G6_M03_ORACLE_FAILED_local_collected');
  const done=snap('collected',L('LOCAL_STOCK',1,1),[L('IMPORT',1,1),L('IMPORT',1,1),L('IMPORT',1,1)]);
  expect(evaluate(done,'final')).toEqual([]);
  expect(evaluate({...done,order:{status:'ready'}},'final')).toContain('order_not_collected_after_import_delivery');
  expect(evaluate(snap('x',L('LOCAL_STOCK'),imp.slice(0,2)),'structure')).toContain('import_lines_2');
 });
 test('import branch: no blanket SCREEN_MISSING any more, product gaps stay explicit verdicts',()=>{
  const a=read('scripts/recette/canonical/real-buyer-cash-adapters.js');
  expect(a).not.toContain("throw Error('G6_M03_SCREEN_MISSING_'+stageId");
  expect(a).toContain('m03import.execute');
  expect(a).toContain("G6_M03_PRODUCT_GAP_");
  const e=read('scripts/recette/g6-dynamic-buyer-cash.js');
  expect(e).toContain("state.verdict=gap[1]");
 });
 test('M03 stages and scripts stay inside chromium-policy',()=>{
  expect(chromium.validateStageModuleSources()).toBeGreaterThan(0);
  expect(chromium.validateChromiumScriptSources()).toBeGreaterThan(0);
  for(const f of ['g6-local-relay-available-chromium.js','g6-local-client-pickup-chromium.js','g6-p2-buyer-order-real-chromium.js','g6-canonical-client-pickup-chromium.js'])
   expect(()=>chromium.assertGestureSourceUsesHelper(path.join(__dirname,'../../scripts/recette',f))).not.toThrow();
  for(const s of ['M03_NOT_COLLECTED','M03_COLLECTED_FINAL'])chromium.assertStageSourceSafe(path.join(__dirname,'../../scripts/recette/canonical/stages',s+'.js'));
  expect(read('scripts/recette/canonical/m03-oracles.js')).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/);
 });
 test('workflow: M03 KM title, owner guards, scenario and to-stage',()=>{
  const y=read('.github/workflows/staging-g6-dynamic-fresh-buyer-cash.yml');
  expect(y).toContain("'[staging-op] g6-dynamic-fresh-full-M03-KM'");
  expect(y).toContain("contains(github.event.issue.title, '-full-M03-') && 'M03'");
  expect(y).toContain("g6-dynamic-fresh-full-M03-KM' && 'M03_COLLECTED_FINAL'");
  expect(y).toContain('github.actor == github.repository_owner');
  expect(y).toContain("'[staging-op] g6-dynamic-fresh-full-M02-KM'");
 });
 test('local branch scripts: M03 uses mixed oracles, M02 keeps strict ones; shared pickup keeps M01 assertion',()=>{
  for(const f of ['g6-local-relay-available-chromium.js','g6-local-client-pickup-chromium.js']){
   const s=read('scripts/recette/'+f);
   expect(s).toContain("SCEN==='M03'?assertMixedPhase");expect(s).toContain('assertNoHubOrTransport(db,id,phase)');
  }
  const c=read('scripts/recette/g6-canonical-client-pickup-chromium.js');
  expect(c).toContain("once.status==='collected'&&once.code_consumed===true");
  expect(c).toContain('G6_M03_ORDER_COLLECTED_BEFORE_IMPORT_DELIVERY');
 });
});
