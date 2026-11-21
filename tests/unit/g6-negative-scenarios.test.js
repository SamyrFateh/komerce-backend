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
 it('N04 : clics répétés sur Ajouter (fiche sans champ quantité, stepper recouvert) ; N09 : saisie de la référence à Remises',()=>{
  const b=read('scripts/recette/g6-p2-buyer-order-real-chromium.js'),n=read('scripts/recette/g6-negative-n09-remise-chromium.js');
  expect(b).toMatch(/PDP_ADD_CAPPED/);expect(b).toMatch(/CHECKOUT_PREVIEW_REFUSED/);expect(b).toMatch(/G6_N04_SCREEN_MISSING_CHECKOUT_/);expect(b).not.toMatch(/humanClick\(null,page\.locator\('#k-qty-plus'\)\)/);
  expect(n).toMatch(/ORDER_REFERENCE/);expect(n).toMatch(/RELAY_REMISES_COUNTER_ABSENT/);expect(n).toMatch(/RELAY_NO_REQUEST_SENT/);
 });
 it('workflow : titres N07/N09/N04/N33 pour KM, CM et CG',()=>{
  const wf=read('.github/workflows/staging-g6-dynamic-fresh-buyer-cash.yml');
  for(const id of ['N07','N09','N04','N33'])for(const m of ['KM','CM','CG'])
   expect(wf).toContain("'[staging-op] g6-dynamic-fresh-full-"+id+'-'+m+"'");
 });
});
describe('G6-G4B N23 (tentatives de retrait) et N24 (deux remises simultanées)',()=>{
 const chain=['BUYER','RELAY_CASH','LOCAL_RELAY_AVAILABLE'];
 it('séquences : parcours M02 jusqu\'à disponible puis geste et oracle ; M02 inchangé',()=>{
  expect(graphFor('N23').order).toEqual([...chain,'N23_WITHDRAWAL_ATTEMPTS','N23_SECURITY_ORACLE']);
  expect(graphFor('N24').order).toEqual([...chain,'N24_PARALLEL_HANDOFF','N24_SINGLE_HANDOFF_ORACLE']);
  expect(graphFor('M02').order).toEqual([...chain,'LOCAL_CLIENT_PICKUP']);
  expect(validateStageModuleSources()).toBeGreaterThan(0);
 });
 it('paramètres acheteur : produit LOCAL_STOCK lié comme M02',()=>{
  const e={G6_CANONICAL_SCENARIO:'N23',G6_TARGET_MARKET:'KM',G6_BUYER_PRODUCT_REF:'KPR-000321',G6_BUYER_EXPECTED_PRICE:'1500'};
  expect(buyerParams(e)).toMatchObject({scenario:'N23',fulfillment:'LOCAL_STOCK',expected_price:1500});
  expect(buyerParams({...e,G6_CANONICAL_SCENARIO:'N24'}).scenario).toBe('N24');
  expect(N.isNegative('N23')&&N.isNegative('N24')).toBe(true);
 });
 const mk=rows=>{let i=0;return {query:async()=>({rows:[rows[i++]]})}};
 const order={id:'o',user_id:'u',status:'available',payment_status:'paid',display_total_amount:1,lines:1,qty:1,cash_count:1,control_count:1,allocations:1,consumed_allocations:0,purchase_lines:0,collected_scans:0,parcels:1};
 it('oracle N23 : aucune remise, code vivant, compteur de sécurité >= seuil',async()=>{
  const ok=()=>mk([order,{n:0},{code_alive:true,attempts:0},{n:7}]);
  await expect(N.oracleN23(ok(),{orderId:'o',agentId:'a',minFailures:5})).resolves.toMatchObject({collected_scans:0,security_failures_15min:7});
  await expect(N.oracleN23(mk([{...order,status:'collected'},{n:0}]),{orderId:'o',agentId:'a',minFailures:5})).rejects.toThrow('G6_N23_PRODUCT_GAP_HANDOFF_DESPITE_BAD_CODES');
  await expect(N.oracleN23(mk([order,{n:0},{code_alive:false}]),{orderId:'o',agentId:'a',minFailures:5})).rejects.toThrow('G6_N23_PRODUCT_GAP_CODE_CONSUMED');
  await expect(N.oracleN23(mk([order,{n:0},{code_alive:true},{n:2}]),{orderId:'o',agentId:'a',minFailures:5})).rejects.toThrow('G6_N23_PRODUCT_GAP_SECURITY_COUNTER_BELOW_2');
 });
 it('oracle N24 : une seule attestation de remise',async()=>{
  const done={...order,status:'collected'};
  await expect(N.oracleN24(mk([done,{scans:1,code_scans:1},{got:1,want:1}]),{orderId:'o'})).resolves.toMatchObject({collected_scans:1});
  await expect(N.oracleN24(mk([done,{scans:2,code_scans:2}]),{orderId:'o'})).rejects.toThrow('G6_N24_PRODUCT_GAP_HANDOFF_ATTESTATIONS_2');
  await expect(N.oracleN24(mk([done,{scans:1,code_scans:1},{got:2,want:1}]),{orderId:'o'})).rejects.toThrow('G6_N24_PRODUCT_GAP_QTY_COLLECTED');
 });
 it('script : garde de corps normalisé, 4 chiffres, force brute au-delà du seuil, deux onglets, verdict par statuts HTTP',()=>{
  const s=read('scripts/recette/g6-negative-n23-n24-chromium.js');
  expect(s).toMatch(/norm\(body\.pickup_code\)===wait\.expect/);
  expect(s).toMatch(/LAST4_ONLY/);expect(s).toMatch(/BRUTE_FORCE_/);expect(s).toMatch(/RIGHT_CODE_WHILE_LOCKED/);
  expect(s).toMatch(/ctx\.newPage\(\)/);expect(s).not.toMatch(/screenshot/);
  expect(s).toMatch(/G6_N24_PRODUCT_GAP_HTTP_/);expect(s).toMatch(/silent_refusals/);expect(s).toMatch(/steps_reached/);
 });
 it('workflow : titres N23/N24 pour KM, CM et CG',()=>{
  const wf=read('.github/workflows/staging-g6-dynamic-fresh-buyer-cash.yml');
  for(const id of ['N23','N24'])for(const m of ['KM','CM','CG'])
   expect(wf).toContain("'[staging-op] g6-dynamic-fresh-full-"+id+'-'+m+"'");
 });
});
describe('G6-G4B N21 (agent d\'un autre relais) et N22 (relais A/B)',()=>{
 const chain=['BUYER','RELAY_CASH','LOCAL_RELAY_AVAILABLE'];
 it('séquences et classification des prérequis',()=>{
  expect(graphFor('N21').order).toEqual([...chain,'N21_CROSS_RELAY_ATTEMPTS','N21_CROSS_RELAY_ORACLE']);
  expect(graphFor('N22').order).toEqual([...chain,'N22_TWO_RELAYS_ATTEMPTS','N22_TWO_RELAYS_ORACLE']);
  expect(N.classifyNegative('N21','PREREQ_MISSING_SECOND_RELAY_KM')).toBe('PREREQ_MISSING_SECOND_RELAY');
  expect(N.classifyNegative('N22','G6_N22_PRODUCT_GAP_READ_order_by_ref')).toBe('PRODUCT_GAP');
  expect(validateStageModuleSources()).toBeGreaterThan(0);
 });
 it('oracle : aucune remise par l\'agent étranger, code vivant',async()=>{
  const order={id:'o',user_id:'u',status:'available',lines:1,qty:1,collected_scans:0,parcels:1};
  const mk=rows=>{let i=0;return {query:async()=>({rows:[rows[i++]]})}};
  await expect(N.oracleCrossRelay(mk([order,{n:0},{code_alive:true,attempts:1}]),{orderId:'o',scenario:'N21'})).resolves.toMatchObject({collected_scans:0,order_attempts:1});
  await expect(N.oracleCrossRelay(mk([{...order,status:'collected'},{n:0}]),{orderId:'o',scenario:'N21'})).rejects.toThrow('G6_N21_PRODUCT_GAP_FOREIGN_AGENT_HANDOFF');
 });
 it('script : rattachement par l\'écran Réseau, lectures sans divulgation, sens inverse, verdict PRODUCT_GAP sans contournement',()=>{
  const s=read('scripts/recette/g6-negative-n21-n22-cross-relay-chromium.js');
  expect(s).toMatch(/attachDedicatedRelayByUI/);expect(s).toMatch(/PREREQ_MISSING_SECOND_RELAY_/);
  expect(s).toMatch(/agent_at_A_vs_order_at_B/);expect(s).toMatch(/contains_order/);expect(s).toMatch(/steps_reached/);expect(s).not.toMatch(/screenshot/);
  expect(read('scripts/recette/g6-prereq-probe.js')).toMatch(/PREREQ_MISSING_SECOND_RELAY/);
 });
 it('workflow : titres N21/N22 pour KM, CM et CG',()=>{
  const wf=read('.github/workflows/staging-g6-dynamic-fresh-buyer-cash.yml');
  for(const id of ['N21','N22'])for(const m of ['KM','CM','CG'])
   expect(wf).toContain("'[staging-op] g6-dynamic-fresh-full-"+id+'-'+m+"'");
 });
});
describe('G6-G4B N20 (écart de réception relais) et N29 (session 401, rôle 403)',()=>{
 it('séquences : N20 = chaîne import jusqu\'à la douane, N29 = parcours M02 ; M01 inchangé',()=>{
  expect(graphFor('N20').order).toEqual([...STAGE_IDS.slice(0,STAGE_IDS.indexOf('CUSTOMS')+1),'N20_RELAY_DISCREPANCY','N20_DISCREPANCY_ORACLE']);
  expect(graphFor('N20').order).not.toContain('RELAY_RECEIPT');
  expect(graphFor('N29').order).toEqual(['BUYER','RELAY_CASH','LOCAL_RELAY_AVAILABLE','N29_SESSION_ROLE_ATTEMPTS','N29_NO_MUTATION_ORACLE']);
  expect(graphFor('M01').order).toEqual(STAGE_IDS);
  expect(validateStageModuleSources()).toBeGreaterThan(0);
 });
 it('oracle N20 : quantité constatée, incident, aucune remise du manquant',async()=>{
  const mk=rows=>{let i=0;return {query:async()=>({rows:rows[i++]})}};
  const order={id:'o',status:'preparation',lines:1,qty:1,collected_scans:0,parcels:1};
  const rec=[{expected_qty:1,received_qty:0,incident_id:'i',incident:'i'}];
  await expect(N.oracleN20(mk([[order],rec,[{collected:0,received:0}]]),{orderId:'o'})).resolves.toMatchObject({received_qty:0,expected_qty:1});
  await expect(N.oracleN20(mk([[order],[{...rec[0],incident:null}]]),{orderId:'o'})).rejects.toThrow('G6_N20_PRODUCT_GAP_NO_INCIDENT');
  await expect(N.oracleN20(mk([[order],[{...rec[0],received_qty:1}]]),{orderId:'o'})).rejects.toThrow('G6_N20_PRODUCT_GAP_RECEIVED_QTY_NOT_SHORT');
  await expect(N.oracleN20(mk([[order],rec,[{collected:1,received:0}]]),{orderId:'o'})).rejects.toThrow('G6_N20_PRODUCT_GAP_MISSING_QTY_HANDED_OVER');
 });
 it('scripts : écart saisi à l\'écran, SCREEN_MISSING_RELAY_DISCREPANCY, session expirée et rôle interdit',()=>{
  const a=read('scripts/recette/g6-negative-n20-relay-discrepancy-chromium.js'),b=read('scripts/recette/g6-negative-n29-authz-chromium.js');
  expect(a).toMatch(/G6_N20_SCREEN_MISSING_RELAY_DISCREPANCY/);expect(a).toMatch(/data-relay-received/);expect(a).not.toMatch(/screenshot/);
  expect(b).toMatch(/clearCookies/);expect(b).toMatch(/SESSION_EXPIREE_SANS_REDIRECTION_NI_MESSAGE/);expect(b).toMatch(/CLIENT_FORBIDDEN_TRIED/);expect(b).not.toMatch(/screenshot/);
  expect(read('scripts/recette/canonical/real-buyer-cash-adapters.js')).toMatch(/G6_CANONICAL_SCENARIO:'M01'/);
 });
 it('workflow : titres N20/N29 pour KM, CM et CG',()=>{
  const wf=read('.github/workflows/staging-g6-dynamic-fresh-buyer-cash.yml');
  for(const id of ['N20','N29'])for(const m of ['KM','CM','CG'])
   expect(wf).toContain("'[staging-op] g6-dynamic-fresh-full-"+id+'-'+m+"'");
 });
});

describe('G6-G4B-FIX runner N23, N29, N20',()=>{
 it('N23 : aucune tentative acceptée ne lève pas de TypeError ; une acceptée donne le verdict produit',()=>{
  const {assertNoneAccepted}=require('../../scripts/recette/g6-negative-n23-n24-chromium');
  expect(()=>assertNoneAccepted([{kind:'WRONG_1',http:401},{kind:'BRUTE_FORCE_1',http:429}])).not.toThrow();
  expect(()=>assertNoneAccepted([])).not.toThrow();
  expect(()=>assertNoneAccepted([{kind:'WRONG_1',http:200}])).toThrow('G6_N23_PRODUCT_GAP_ACCEPTED_WRONG_1');
 });
 it('N29 : la garde de LOCAL_RELAY_AVAILABLE accepte N29 sans autre assouplissement',()=>{
  const a=read('scripts/recette/g6-local-relay-available-chromium.js');
  expect(a).toMatch(/\['M02','M03','N23','N24','N21','N22','N29'\]\.includes\(env\.G6_CANONICAL_SCENARIO\)/);
  expect(a).toMatch(/env\.G6_CANONICAL_PHASE==='LOCAL_RELAY_AVAILABLE'/);expect(a).toMatch(/G6_LOCAL_RELAY_OWNER_STAGING_GUARD/);
 });
 it('N20 : expédition retrouvée via le lien Hub quand parcels.shipment_id est vide',async()=>{
  const {shipmentForOrder}=require('../../scripts/recette/g6-negative-n20-relay-discrepancy-chromium');
  const seen=[];const db={query:async q=>{seen.push(q);return {rows:[{id:'s',reference:'SIM-STAGING-EXP-X',stage:'local_delivery'}]}}};
  await expect(shipmentForOrder(db,'o')).resolves.toMatchObject({reference:'SIM-STAGING-EXP-X'});
  expect(seen[0]).toMatch(/international_shipment_hub_units/);expect(seen[0]).toMatch(/hub_box_bags/);
  await expect(shipmentForOrder({query:async()=>({rows:[]})},'o')).resolves.toBeNull();
 });
});
