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
  expect(a).toMatch(/\['M02','M03','N23','N24','N21','N22','N29'(?:,'N\d+')*\]\.includes\(env\.G6_CANONICAL_SCENARIO\)/);
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

describe('G6-G4C N11 (PO sans engagement) et N12 (paiement sans deuxième autorisation)',()=>{
 const up=id=>STAGE_IDS.slice(0,STAGE_IDS.indexOf(id)+1);
 it('séquences : chaîne M01 coupée au bon point, M01 inchangé',()=>{
  expect(graphFor('N11').order).toEqual([...up('HUB_PO'),'N11_PO_NO_COMMITMENT_ATTEMPT','N11_NO_ENGAGEMENT_ORACLE']);
  expect(graphFor('N12').order).toEqual([...up('HUB_VENDOR_SIMULATION'),'N12_PAYMENT_SINGLE_VALIDATOR','N12_NO_PAYMENT_ORACLE']);
  expect(graphFor('N11').order).not.toContain('HUB_COMMITMENT');
  expect(graphFor('N12').order).not.toContain('HUB_RECEIVING');
  expect(graphFor('M01').order).toEqual(STAGE_IDS);
  expect(validateStageModuleSources()).toBeGreaterThan(0);
 });
 const mk=rows=>{let i=0;return {query:async()=>({rows:rows[i++]})}};
 const po={id:'p',status:'draft',sent_at:null,sent_channel:null,supplier_order_id:null};
 const fx={commitments:0,payment_authorizations:0,supplier_payments:0,manual_executions:0,confirmed_lines:0,hub_allocations:0,hub_units:0,payment_status:'paid'};
 it('oracle N11 : brouillon, aucun engagement, aucun effet fournisseur ni Hub',async()=>{
  await expect(N.oracleN11(mk([[po],[fx]]),{orderId:'o',poId:'p'})).resolves.toMatchObject({po_status:'draft',commitments:0});
  await expect(N.oracleN11(mk([[{...po,status:'notified'}],[fx]]),{orderId:'o',poId:'p'})).rejects.toThrow('G6_N11_PRODUCT_GAP_PO_ADVANCED_notified');
  await expect(N.oracleN11(mk([[po],[{...fx,commitments:1}]]),{orderId:'o',poId:'p'})).rejects.toThrow('G6_N11_PRODUCT_GAP_ENGAGEMENT_RECORDED');
  await expect(N.oracleN11(mk([[po],[{...fx,hub_units:1}]]),{orderId:'o',poId:'p'})).rejects.toThrow('G6_N11_PRODUCT_GAP_HUB_EFFECT');
  await expect(N.oracleN11(mk([[po,{...po,id:'q'}]]),{orderId:'o',poId:'p'})).rejects.toThrow('G6_NEG_PO_NOT_UNIQUE_2');
 });
 it('oracle N12 : engagement unique intact, aucune autorisation de paiement, aucun paiement',async()=>{
  const c={...po,status:'confirmed'},f={...fx,commitments:1},row=[{proof_ref:'E-1',decided_by:'u'}];
  await expect(N.oracleN12(mk([[c],[f],row]),{orderId:'o',poId:'p',commitmentProof:'E-1'})).resolves.toMatchObject({commitments:1,payment_authorizations:0});
  await expect(N.oracleN12(mk([[c],[{...f,payment_authorizations:1}]]),{orderId:'o',poId:'p',commitmentProof:'E-1'})).rejects.toThrow('G6_N12_PRODUCT_GAP_PAYMENT_AUTHORIZED_BY_SINGLE_VALIDATOR');
  await expect(N.oracleN12(mk([[c],[{...f,supplier_payments:1}]]),{orderId:'o',poId:'p',commitmentProof:'E-1'})).rejects.toThrow('G6_N12_PRODUCT_GAP_SUPPLIER_PAYMENT_EXECUTED');
  await expect(N.oracleN12(mk([[c],[f],row]),{orderId:'o',poId:'p',commitmentProof:'AUTRE'})).rejects.toThrow('G6_N12_PRODUCT_GAP_COMMITMENT_PROOF_CHANGED');
 });
 it('script : écran puis sondes signalées, verdicts PRODUCT_GAP et SCREEN_MISSING, aucune capture',()=>{
  const a=read('scripts/recette/g6-negative-n11-n12-chromium.js');
  expect(a).toMatch(/API_PROBE_NO_SCREEN_GESTURE/);expect(a).toMatch(/SOUMISSION_ABSENTE_SANS_MOTIF_AFFICHE/);
  expect(a).toMatch(/G6_'\+SCEN\+'_PRODUCT_GAP_/);expect(a).toMatch(/SCREEN_MISSING/);expect(a).not.toMatch(/screenshot/);
  expect(a).toMatch(/authorize-payment/);expect(a).toMatch(/DIRECTOR_HOLDS_BOTH_GRANTS/);
  expect(read('scripts/recette/canonical/negative-runner.js')).toMatch(/G6_CANONICAL_PO_ID:poId|G6_CANONICAL_PO_ID/);
  expect(validateChromiumScriptSources()).toBeGreaterThan(0);
 });
 it('classification des verdicts et workflow : titres N11/N12 pour KM, CM et CG',()=>{
  expect(N.classifyNegative('N11','G6_N11_PRODUCT_GAP_PO_ADVANCED_notified')).toBe('PRODUCT_GAP');
  expect(N.classifyNegative('N12','G6_N12_SCREEN_MISSING_PROBE_csrf_origin_required')).toBe('SCREEN_MISSING');
  expect(N.isNegative('N11')&&N.isNegative('N12')).toBe(true);
  const wf=read('.github/workflows/staging-g6-dynamic-fresh-buyer-cash.yml');
  for(const id of ['N11','N12'])for(const m of ['KM','CM','CG'])
   expect(wf).toContain("'[staging-op] g6-dynamic-fresh-full-"+id+'-'+m+"'");
 });
});

describe('G6-G4C N13 (rupture fournisseur, reliquat) et N14 (réception partielle, excès, négatif)',()=>{
 const up=id=>STAGE_IDS.slice(0,STAGE_IDS.indexOf(id)+1);
 const mk=rows=>{let i=0;return {query:async()=>({rows:rows[i++]})}};
 it('séquences : chaîne M01 coupée au bon point, M01 inchangé',()=>{
  expect(graphFor('N13').order).toEqual([...up('HUB_VENDOR_READINESS'),'N13_SUPPLIER_BACKORDER','N13_BACKORDER_ORACLE']);
  expect(graphFor('N14').order).toEqual([...up('HUB_VENDOR_SIMULATION'),'N14_RECEIVING_QTY_ATTEMPTS','N14_RECEIVING_ORACLE']);
  expect(graphFor('N13').order).not.toContain('HUB_VENDOR_SIMULATION');
  expect(graphFor('M01').order).toEqual(STAGE_IDS);
  expect(validateStageModuleSources()).toBeGreaterThan(0);
 });
 const fx={commitments:1,payment_authorizations:0,supplier_payments:0,manual_executions:0,confirmed_lines:1,hub_allocations:0,hub_units:0,payment_status:'paid'};
 it('oracle N13 : reliquat égal au manque, rien reçu ni payé',async()=>{
  const po=[{id:'p',status:'cancelled'}],l=[{id:'l',quantity:1,confirmed_quantity:0,received:0}];
  await expect(N.oracleN13(mk([po,l,[{quantity:1,purchase_order_id:null,cancelled_at:null}],[fx],[{n:0}]]),{orderId:'o',poId:'p',ordered:1,typed:0})).resolves.toMatchObject({remnant_quantity:1,received:0});
  await expect(N.oracleN13(mk([po,l,[],[fx],[{n:0}]]),{orderId:'o',poId:'p',ordered:1,typed:0})).rejects.toThrow('G6_N13_PRODUCT_GAP_REMNANT_0');
  await expect(N.oracleN13(mk([po,[{...l[0],received:1}],[{quantity:1,purchase_order_id:null,cancelled_at:null}],[fx],[{n:0}]]),{orderId:'o',poId:'p',ordered:1,typed:0})).rejects.toThrow('G6_N13_PRODUCT_GAP_FICTIVE_RECEIPT');
  await expect(N.oracleN13(mk([[{id:'p',status:'confirmed'}],l]),{orderId:'o',poId:'p',ordered:1,typed:0})).rejects.toThrow('G6_N13_PRODUCT_GAP_PO_STATE_confirmed');
  const part=[{...l[0],quantity:3,confirmed_quantity:2}];
  await expect(N.oracleN13(mk([[{id:'p',status:'confirmed'}],part,[{quantity:1,purchase_order_id:null,cancelled_at:null}],[fx],[{n:2}]]),{orderId:'o',poId:'p',ordered:3,typed:2})).resolves.toMatchObject({remnant_quantity:1,confirmed:2});
 });
 it('oracle N14 : une réception exacte, jamais en excès ni négative',async()=>{
  const ok=[[{quantity:1,received:1}],[{quantity:1}],[fx]];
  await expect(N.oracleN14(mk(ok),{orderId:'o',poId:'p',ordered:1})).resolves.toMatchObject({received:1,placements:1});
  await expect(N.oracleN14(mk([[{quantity:1,received:2}]]),{orderId:'o',poId:'p',ordered:1})).rejects.toThrow('G6_N14_PRODUCT_GAP_EXCESS_RECEIVED_2');
  await expect(N.oracleN14(mk([[{quantity:1,received:-1}]]),{orderId:'o',poId:'p',ordered:1})).rejects.toThrow('G6_N14_PRODUCT_GAP_NEGATIVE_RECEIVED');
  await expect(N.oracleN14(mk([[{quantity:1,received:0}]]),{orderId:'o',poId:'p',ordered:1})).rejects.toThrow('G6_N14_PRODUCT_GAP_RECEIVED_NOT_EXACT_0');
  await expect(N.oracleN14(mk([[{quantity:1,received:1}],[{quantity:-1}]]),{orderId:'o',poId:'p',ordered:1})).rejects.toThrow('G6_N14_PRODUCT_GAP_PLACEMENTS_1');
 });
 it('script : confirmation en rupture et quantités invalides par l\'écran, sondes signalées, aucune capture',()=>{
  const a=read('scripts/recette/g6-negative-n13-n14-chromium.js');
  expect(a).toMatch(/PARTIAL_CONFIRMATION_/);expect(a).toMatch(/RELIQUAT_NON_VISIBLE_APRES_CONFIRMATION/);
  expect(a).toMatch(/data-receive-line/);expect(a).toMatch(/QUANTITE_INVALIDE_SANS_MESSAGE/);expect(a).toMatch(/API_PROBE_NO_SCREEN_GESTURE/);
  expect(a).toMatch(/EXCESS/);expect(a).toMatch(/NEGATIVE/);expect(a).not.toMatch(/screenshot/);
  expect(validateChromiumScriptSources()).toBeGreaterThan(0);
 });
 it('workflow : titres N13/N14 pour KM, CM et CG',()=>{
  const wf=read('.github/workflows/staging-g6-dynamic-fresh-buyer-cash.yml');
  for(const id of ['N13','N14'])for(const m of ['KM','CM','CG'])
   expect(wf).toContain("'[staging-op] g6-dynamic-fresh-full-"+id+'-'+m+"'");
  expect(N.isNegative('N13')&&N.isNegative('N14')).toBe(true);
 });
});

describe('G6-G4C N15 (sac ou KOM-BOX incomplet) et N16 (carton non DISPATCHED, composition figée)',()=>{
 const up=id=>STAGE_IDS.slice(0,STAGE_IDS.indexOf(id)+1);
 const mk=rows=>{let i=0;return {query:async()=>({rows:rows[i++]})}};
 it('séquences : chaîne M01 coupée au bon point, M01 inchangé',()=>{
  expect(graphFor('N15').order).toEqual([...up('HUB_RECEIVING_READBACK'),'N15_BAG_BOX_INCOMPLETE','N15_NO_CLOSURE_ORACLE']);
  expect(graphFor('N16').order).toEqual([...up('HUB_KOM_BOX'),'N16_BOX_NOT_DISPATCHED_FROZEN','N16_BOX_FROZEN_ORACLE']);
  expect(graphFor('N15').order).not.toContain('HUB_CUSTOMER_BAG');
  expect(graphFor('N16').order).not.toContain('HUB_SHIPMENT');
  expect(graphFor('M01').order).toEqual(STAGE_IDS);
  expect(validateStageModuleSources()).toBeGreaterThan(0);
 });
 const clean=[[{id:'b',state:'RECEIVED'}],[{n:0}],[{n:0}],[{id:'x',state:'RECEIVED'}],[{shipments:0,links:0,departed:0}]];
 it('oracle N15 : sac non fermé et vide, carton non fermé, aucune expédition ni départ',async()=>{
  await expect(N.oracleN15(mk(clean),{orderId:'o',boxRef:'B',shipmentRef:'S'})).resolves.toMatchObject({bag_state:'RECEIVED',shipments:0});
  await expect(N.oracleN15(mk([[{id:'b',state:'PACKED'}]]),{orderId:'o',boxRef:'B',shipmentRef:'S'})).rejects.toThrow('G6_N15_PRODUCT_GAP_BAG_CLOSED_WITH_MISSING_LINE');
  await expect(N.oracleN15(mk([clean[0],clean[1],[{n:1}]]),{orderId:'o',boxRef:'B',shipmentRef:'S'})).rejects.toThrow('G6_N15_PRODUCT_GAP_INCOMPLETE_BAG_IN_BOX');
  await expect(N.oracleN15(mk([clean[0],clean[1],clean[2],[{id:'x',state:'PACKED'}]]),{orderId:'o',boxRef:'B',shipmentRef:'S'})).rejects.toThrow('G6_N15_PRODUCT_GAP_EMPTY_BOX_CLOSED');
  await expect(N.oracleN15(mk([...clean.slice(0,4),[{shipments:1,links:1,departed:0}]]),{orderId:'o',boxRef:'B',shipmentRef:'S'})).rejects.toThrow('G6_N15_PRODUCT_GAP_NON_CONFORMING_DEPARTURE');
 });
 const snap=(o={})=>[[{id:'x',state:'DISPATCHED'}],[{links:1,effective:1,qty:1,placements:2,removed:1,box_custody_events:7,shipment_links:1}],
  [{stage:'handed_over',forwarder_name:'F',transport_mode:'sea',...o}],[{statuses:'shipped',shipped:1}]];
 it('oracle N16 : carton remis, composition identique au point de référence',async()=>{
  const base=await N.snapN16(mk(snap()),{orderId:'o',boxRef:'B',shipmentRef:'S'});
  await expect(N.oracleN16(mk(snap()),{orderId:'o',boxRef:'B',shipmentRef:'S',baseline:base})).resolves.toMatchObject({box_state:'DISPATCHED',shipment_stage:'handed_over'});
  await expect(N.oracleN16(mk(snap()),{orderId:'o',boxRef:'B',shipmentRef:'S',baseline:{...base,links:0}})).rejects.toThrow('G6_N16_PRODUCT_GAP_COMPOSITION_CHANGED_AFTER_HANDOVER');
  await expect(N.oracleN16(mk(snap({stage:'hub_ready',forwarder_name:null})),{orderId:'o',boxRef:'B',shipmentRef:'S',baseline:base})).rejects.toThrow('G6_N16_PRODUCT_GAP_HANDOVER_STATE_DISPATCHED_hub_ready');
 });
 it('script : écran puis sondes signalées, refus de remise avant DISPATCHED, aucune capture',()=>{
  const a=read('scripts/recette/g6-negative-n15-n16-chromium.js');
  expect(a).toMatch(/API_PROBE_NO_SCREEN_GESTURE/);expect(a).toMatch(/HANDOVER_ACCEPTED_BOX_NOT_DISPATCHED/);expect(a).toMatch(/close-customer-bag/);
  expect(a).toMatch(/FERMETURE_SAC_ABSENTE_SANS_MOTIF_AFFICHE/);expect(a).toMatch(/detach_after_handover/);expect(a).not.toMatch(/screenshot/);
  expect(validateChromiumScriptSources()).toBeGreaterThan(0);
 });
 it('workflow : titres N15/N16 pour KM, CM et CG',()=>{
  const wf=read('.github/workflows/staging-g6-dynamic-fresh-buyer-cash.yml');
  for(const id of ['N15','N16'])for(const m of ['KM','CM','CG'])
   expect(wf).toContain("'[staging-op] g6-dynamic-fresh-full-"+id+'-'+m+"'");
  expect(N.isNegative('N15')&&N.isNegative('N16')).toBe(true);
 });
});

describe('G6-G5B N17 (transitaire hors rôle ou marché), N18 (douane retenue puis mainlevée), N19 (retard puis perte du transport local)',()=>{
 const up=id=>STAGE_IDS.slice(0,STAGE_IDS.indexOf(id)+1);
 const mk=rows=>{let i=0;return {query:async()=>({rows:rows[i++]})}};
 it('séquences : chaîne M01 coupée au bon point, M01 inchangé',()=>{
  expect(graphFor('N17').order).toEqual([...up('HUB_SHIPMENT'),'N17_FORWARDER_ROLE_MARKET_ATTEMPTS','N17_NO_TRANSITION_ORACLE']);
  expect(graphFor('N18').order).toEqual([...up('FORWARDER'),'N18_CUSTOMS_HOLD_ATTEMPTS','N18_HOLD_RELEASE_ORACLE']);
  expect(graphFor('N19').order).toEqual([...up('CUSTOMS'),'N19_LOCAL_TRANSPORT_DELAY_LOSS','N19_LOSS_INCIDENT_ORACLE']);
  expect(graphFor('N17').order).not.toContain('FORWARDER');
  expect(graphFor('N18').order).not.toContain('CUSTOMS');
  expect(graphFor('M01').order).toEqual(STAGE_IDS);
  expect(validateStageModuleSources()).toBeGreaterThan(0);
 });
 const snap=(o={})=>({stage:'handed_over',customs_shipment_id:null,tracking_reference:null,forwarder_name:'F',events:3,charges:0,receipts:0,...o});
 it('oracle N17 : expédition identique, aucun frais, lien douane ni suivi',async()=>{
  const row=o=>[[snap(o)]],ord=[[{id:'o',status:'shipped',collected_scans:0}]];
  await expect(N.oracleN17(mk([...row(),...ord]),{orderId:'o',shipmentRef:'S',baseline:snap()})).resolves.toMatchObject({stage:'handed_over',charges:0});
  await expect(N.oracleN17(mk(row({stage:'forwarder_received'})),{orderId:'o',shipmentRef:'S',baseline:snap()})).rejects.toThrow('G6_N17_PRODUCT_GAP_STAGE_MOVED_forwarder_received');
  await expect(N.oracleN17(mk(row({events:4})),{orderId:'o',shipmentRef:'S',baseline:snap()})).rejects.toThrow('G6_N17_PRODUCT_GAP_JOURNEY_CHANGED_BY_REFUSED_ACTOR');
 });
 const t=s=>new Date('2026-11-21T10:0'+s+':00Z');
 const j=(o={})=>[[snap({stage:'customs_released',customs_shipment_id:'c',...o})],[{id:'c',status:'declared',customs_paid_kmf:'0'}],
  [{status:'released',held_at:t(1),released_at:t(3),held_by:'u',released_by:'a',held_by_role:'admin',reason:'motif'}],
  [{event_type:'customs_linked',to_stage:null,occurred_at:t(0)},{event_type:'customs_amount_confirmed',to_stage:null,occurred_at:t(4)},{event_type:'stage_changed',to_stage:'customs_released',occurred_at:t(5)}],
  [{id:'o',status:'shipped',collected_scans:0}]];
 it('oracle N18 : aucun transit entre retenue et mainlevée, étapes autorisées après',async()=>{
  await expect(N.oracleN18(mk(j()),{orderId:'o',shipmentRef:'S',customsRef:'C'})).resolves.toMatchObject({held_by_role:'admin',stage:'customs_released'});
  const bad=j();bad[3]=[{event_type:'customs_amount_confirmed',to_stage:null,occurred_at:t(2)},{event_type:'stage_changed',to_stage:'customs_released',occurred_at:t(5)}];
  await expect(N.oracleN18(mk(bad),{orderId:'o',shipmentRef:'S',customsRef:'C'})).rejects.toThrow('G6_N18_PRODUCT_GAP_TRANSIT_WHILE_HELD_1');
  const open=j();open[2]=[{status:'held',held_at:t(1),released_at:null,held_by:'u',released_by:null,held_by_role:'admin',reason:'motif'}];
  await expect(N.oracleN18(mk(open),{orderId:'o',shipmentRef:'S',customsRef:'C'})).rejects.toThrow('G6_N18_PRODUCT_GAP_HOLD_NOT_RELEASED_BY_ACTOR');
 });
 it('oracle N19 : quantité nulle, incident haute gravité, ni disponible ni code de retrait',async()=>{
  const good=[[{id:'o',status:'in_transit',collected_scans:0}],[{expected_qty:1,received_qty:0,incident:'i',incident_type:'missing_item',severity:'high'}],[{collected:0,received:0}],[{code_alive:false}]];
  await expect(N.oracleN19(mk(good),{orderId:'o'})).resolves.toMatchObject({received_qty:0,severity:'high'});
  const avail=[[{id:'o',status:'available',collected_scans:0}],good[1],good[2]];
  await expect(N.oracleN19(mk(avail),{orderId:'o'})).rejects.toThrow('G6_N19_PRODUCT_GAP_AVAILABLE_OR_COLLECTED_AFTER_TOTAL_LOSS_available');
  await expect(N.oracleN19(mk([good[0],[{expected_qty:2,received_qty:1,incident:'i',incident_type:'quantity_mismatch',severity:'medium'}]]),{orderId:'o'})).rejects.toThrow('G6_N19_PRODUCT_GAP_RECEIVED_QTY_NOT_ZERO');
 });
 it('scripts : sondes signalées, hors marché 403/404, retenue par écran, aucune capture',()=>{
  const a=read('scripts/recette/g6-negative-n17-n18-chromium.js'),b=read('scripts/recette/g6-negative-n19-chromium.js');
  expect(a).toMatch(/API_PROBE_NO_SCREEN_GESTURE/);expect(a).toMatch(/forwarder_other_market/);expect(a).toMatch(/hold-customs/);expect(a).toMatch(/release-customs/);
  expect(a).toMatch(/AUCUNE_REQUETE_ENVOYEE/);expect(b).toMatch(/received_qty:0/);expect(b).toMatch(/PERTE_ATTESTEE_SANS_MESSAGE_INCIDENT/);
  expect(a+b).not.toMatch(/screenshot/);
  expect(validateChromiumScriptSources()).toBeGreaterThan(0);
 });
 it('effective params : N17 à N19 partent de la chaîne M01, M01 et N20 inchangés',()=>{
  const r=read('scripts/recette/canonical/negative-runner.js');
  expect(r).toMatch(/N17:\{script:N1718_SCRIPT[^}]*to:'HUB_SHIPMENT'/);expect(r).toMatch(/N18:\{script:N1718_SCRIPT[^}]*to:'FORWARDER'/);expect(r).toMatch(/N19:\{script:N19_SCRIPT[^}]*to:'CUSTOMS'/);
  expect(r).toMatch(/N20:\{script:N20_SCRIPT[^}]*to:'CUSTOMS'/);
  expect(read('scripts/recette/canonical/real-buyer-cash-adapters.js')).toMatch(/'N17','N18','N19'\]\.includes\(SCENARIO\)/);
 });
 it('workflow : titres N17 à N19 pour KM, CM et CG',()=>{
  const wf=read('.github/workflows/staging-g6-dynamic-fresh-buyer-cash.yml');
  for(const id of ['N17','N18','N19'])for(const m of ['KM','CM','CG'])
   expect(wf).toContain("'[staging-op] g6-dynamic-fresh-full-"+id+'-'+m+"'");
  expect(['N17','N18','N19'].every(N.isNegative)).toBe(true);
 });
});

describe('G6-G5C N28 (échec réseau puis réessai) et N32 (marché et rôles croisés)',()=>{
 const mk=rows=>{let i=0;return {query:async()=>({rows:rows[i++]})}};
 const ord=(o={})=>({id:'o',user_id:'u',status:'collected',payment_status:'paid',display_total_amount:1,lines:1,qty:1,cash_count:1,control_count:1,allocations:1,consumed_allocations:1,purchase_lines:0,collected_scans:1,parcels:1,...o});
 it('séquences : parcours M02 coupé, M01 et M02 inchangés',()=>{
  expect(graphFor('N28').order).toEqual(['BUYER','RELAY_CASH','LOCAL_RELAY_AVAILABLE','N28_NETWORK_FAILURE_RETRY','N28_SINGLE_EFFECT_ORACLE']);
  expect(graphFor('N32').order).toEqual(['BUYER','RELAY_CASH','LOCAL_RELAY_AVAILABLE','N32_CROSS_MARKET_ROLES','N32_NO_MUTATION_ORACLE']);
  expect(graphFor('M01').order).toEqual(STAGE_IDS);
  expect(graphFor('M02').order).toEqual(['BUYER','RELAY_CASH','LOCAL_RELAY_AVAILABLE','LOCAL_CLIENT_PICKUP']);
  expect(validateStageModuleSources()).toBeGreaterThan(0);
 });
 it('oracle N28 : une seule remise, quantités exactes ; double effet = PRODUCT_GAP',async()=>{
  await expect(N.oracleN28(mk([[ord()],[{scans:1}],[{got:1,want:1}]]),{orderId:'o',committedBeforeRetry:true})).resolves.toMatchObject({collected_scans:1,committed_before_retry:true});
  await expect(N.oracleN28(mk([[ord()],[{scans:2}]]),{orderId:'o'})).rejects.toThrow('G6_N28_PRODUCT_GAP_HANDOFF_ATTESTATIONS_2');
  await expect(N.oracleN28(mk([[ord()],[{scans:0}]]),{orderId:'o'})).rejects.toThrow('G6_N28_PRODUCT_GAP_HANDOFF_ATTESTATIONS_0');
 });
 it('oracle N32 : aucune mutation et aucune remise par un rôle étranger',async()=>{
  const snap={unchanged:true,before:{codes:3},after:{codes:3}};
  await expect(N.oracleN32(mk([[ord({status:'available',collected_scans:0})],[{n:0}]]),{orderId:'o',snapshot:snap})).resolves.toMatchObject({status:'available',codes_after:3});
  await expect(N.oracleN32(mk([[ord({status:'available',collected_scans:0})]]),{orderId:'o',snapshot:{...snap,unchanged:false}})).rejects.toThrow('G6_N32_PRODUCT_GAP_MUTATION');
  await expect(N.oracleN32(mk([[ord()],[{n:1}]]),{orderId:'o',snapshot:snap})).rejects.toThrow('G6_N32_PRODUCT_GAP_HANDOFF_BY_FOREIGN_ROLE');
 });
 it('script : sondes API signalées, réponse perdue après commit, aucune capture ; prérequis classés',()=>{
  const a=read('scripts/recette/g6-negative-n28-n32-chromium.js');
  expect(a).toMatch(/API_PROBE_NO_SCREEN_GESTURE/);expect(a).toMatch(/connectionreset/);expect(a).toMatch(/FALSE_SUCCESS_SHOWN_ON_HTTP500/);
  expect(a).toMatch(/PREREQ_MISSING_FOREIGN_MARKET_ORDER/);expect(a).not.toMatch(/screenshot/);expect(validateChromiumScriptSources()).toBeGreaterThan(0);
  expect(N.classifyNegative('N32','x PREREQ_MISSING_FOREIGN_MARKET_ORDER')).toBe('PREREQ_MISSING_FOREIGN_MARKET_ORDER');
 });
 it('workflow : titres N28/N32 pour KM, CM et CG et alias de scénario',()=>{
  const wf=read('.github/workflows/staging-g6-dynamic-fresh-buyer-cash.yml');
  for(const id of ['N28','N32'])for(const m of ['KM','CM','CG'])expect(wf).toContain("'[staging-op] g6-dynamic-fresh-full-"+id+'-'+m+"'");
  expect(wf).toContain("'-full-N28-') && 'N28'");expect(wf).toContain("'-full-N32-') && 'N32'");
  expect(N.isNegative('N28')&&N.isNegative('N32')).toBe(true);
 });
});
