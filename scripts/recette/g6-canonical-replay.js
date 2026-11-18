#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g6-canonical-transactional-chromium-replayer
 * @domain orders
 * @layer script
 * @owner backend-core
 * @purpose Reuse the real buyer and relay Chromium scripts sequentially on ONE order; fail closed at the unbound Hub transition.
 * @impact-areas checkout, payment, logistics, staging-only
 */
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {spawnSync,execFileSync}=require('node:child_process');
const {resolveCanonicalReplay}=require('./g6-canonical-journey-binding');
const {loadGoldenStages,stageGraph,resolvePhase,requiresResumeProof}=require('./canonical/stage-registry');

const ROOT=path.resolve(__dirname,'../..');
const OUT=path.join(ROOT,'test-results/g6-canonical-replay');
const REPORT=path.join(OUT,'report.json');
const BUYER=path.join(ROOT,'test-results/g6-p2-buyer-order/report.json');
const CASH=path.join(ROOT,'test-results/g6-a-relay-cash/report.json');
const RESUME_BUYER=path.join(ROOT,'test-results/g6-canonical-resume/g6-p2-buyer-order/report.json');
const RESUME_CASH=path.join(ROOT,'test-results/g6-canonical-resume/g6-a-relay-cash/report.json');
const RESUME_CANONICAL=path.join(ROOT,'test-results/g6-canonical-resume/g6-canonical-replay/report.json');
const HUB_PROOF=path.join(ROOT,'test-results/g6-p3-kuyiyuk/evidence.json');
const RESUME_HUB_PROOF=path.join(ROOT,'test-results/g6-canonical-resume/g6-p3-kuyiyuk/evidence.json');
const HUB_COMMITMENT=path.join(ROOT,'test-results/g6-hub-commitment/report.json');
const RESUME_COMMITMENT=path.join(ROOT,'test-results/g6-canonical-resume/g6-hub-commitment/report.json');
const VENDOR_READY=path.join(ROOT,'test-results/g6-hub-vendor-readiness/report.json');
const RESUME_VENDOR_READY=path.join(ROOT,'test-results/g6-canonical-resume/g6-hub-vendor-readiness/report.json');
const VENDOR_SIMULATION=path.join(ROOT,'test-results/g6-hub-vendor-simulation/report.json');
const RESUME_VENDOR_SIMULATION=path.join(ROOT,'test-results/g6-canonical-resume/g6-hub-vendor-simulation/report.json');
const HUB_RECEIVING=path.join(ROOT,'test-results/g6-hub-receiving/report.json');
const RESUME_HUB_RECEIVING=path.join(ROOT,'test-results/g6-canonical-resume/g6-hub-receiving/report.json');
const HUB_RECEIVING_READBACK=path.join(ROOT,'test-results/g6-hub-receiving-readback/report.json');
const RESUME_RECEIVING_READBACK=path.join(ROOT,'test-results/g6-canonical-resume/g6-hub-receiving-readback/report.json');
const CUSTOMER_BAG=path.join(ROOT,'test-results/g6-hub-customer-bag/report.json');
const RESUME_CUSTOMER_BAG=path.join(ROOT,'test-results/g6-canonical-resume/g6-hub-customer-bag/report.json');
const HUB_KOM_BOX=path.join(ROOT,'test-results/g6-hub-kom-box/report.json');
const RESUME_KOM_BOX=path.join(ROOT,'test-results/g6-canonical-resume/g6-hub-kom-box/report.json');
const HUB_SHIPMENT=path.join(ROOT,'test-results/g6-hub-shipment/report.json');
const RESUME_SHIPMENT=path.join(ROOT,'test-results/g6-canonical-resume/g6-hub-shipment/report.json');
const ORIGIN='https://komerce-backend-production.up.railway.app';
const VALID_SHA=/^[a-f0-9]{40}$/;
const VALID_REF=/^[A-Z0-9][A-Z0-9-]{5,63}$/;

function validateGuard(env=process.env) {
  if (env.GITHUB_EVENT_NAME!=='issues' || env.GITHUB_ACTOR!==env.GITHUB_REPOSITORY_OWNER ||
      env.GITHUB_REPOSITORY!=='SamyrFateh/komerce-backend' ||
      env.NODE_ENV!=='test'||env.KOMERCE_ENV!=='staging'||
      env.KOMERCE_TARGET_ENV!=='staging'||env.EXPECTED_RAILWAY_ENVIRONMENT!=='staging'||
      env.STAGING_BASE_URL!==ORIGIN || !VALID_SHA.test(env.E2E_EXPECTED_DEPLOY_SHA||'') ||
      !env.DATABASE_URL || !env.E2E_ADMIN_EMAIL || !env.E2E_ADMIN_PASSWORD ||
      env.G6_CANONICAL_ACCEPT_PARTIAL_REPLAY!=='1') {
    throw new Error('G6_CANONICAL_OWNER_STAGING_GUARD');
  }
  return resolveCanonicalReplay(env);
}

// Resuming from a previous GitHub run is only allowed after a Git-authenticated
// SAME-STAGING SHA compatibility proof and fresh PostgreSQL readback in cash.
const RESUME_DIFF_ALLOWLIST=new Set([
  '.github/workflows/staging-g6-canonical-buyer-cash.yml',
  'scripts/recette/g6-canonical-replay.js',
  'scripts/recette/g6-hub-commitment-chromium.js',
  'scripts/recette/g6-hub-vendor-readiness-chromium.js',
  'tests/staging-clicks/g6-p3-kuyiyuk.spec.js',
  'tests/unit/g6-canonical-journey-replay.test.js',
  'docs/recette/PARCOURS_REFERENCE_UNIQUE.md',
  // STATUS est un journal de preuves, jamais une autorité de mutation.
  'docs/chantier/STATUS.md'
]);
function isToolingOnlyResumeDiff(files) {
  return Array.isArray(files) && files.length>0 && files.every(f=>RESUME_DIFF_ALLOWLIST.has(f));
}
function verifyResumeTooling(oldSha,newSha) {
  if(!VALID_SHA.test(String(oldSha||''))||!VALID_SHA.test(String(newSha||'')))
    throw new Error('G6_CANONICAL_RESUME_SHA_INVALID');
  if(oldSha===newSha)return {equivalent:true,changedFiles:[]};
  try {
    execFileSync('git',['merge-base','--is-ancestor',oldSha,newSha],{cwd:ROOT,timeout:15000,stdio:'pipe'});
    const files=execFileSync('git',['diff','--name-only',oldSha,newSha],{cwd:ROOT,timeout:15000,encoding:'utf8'})
      .split(/\r?\n/).filter(Boolean);
    if(isToolingOnlyResumeDiff(files))return {equivalent:true,changedFiles:files};
  }catch(_){}
  throw new Error('G6_CANONICAL_RESUME_RUNTIME_DIFF_UNVERIFIED');
}
function validateBuyerProof(buyer, scope, env, {toolingEquivalent=false}={}) {
  if(buyer.verdict!=='G6_P2_REAL_OTP_CHROMIUM_ORDER_CREATED_NO_EXTERNAL_EFFECTS' ||
      buyer.market!==scope.market || buyer.order?.market!==scope.market ||
      buyer.order?.scope!=='G6-BUYER' || buyer.order?.payment_status!=='pending' || buyer.order?.status!=='pending' ||
      // The historical buyer report omitted payment_mode, but its code asserts
      // cash_relais against PG before emitting this exact verdict. The live
      // relay precheck MUST recheck payment_mode before every cash action.
      (buyer.order?.payment_mode && buyer.order.payment_mode!=='cash_relais') ||
      !VALID_REF.test(String(buyer.order?.reference||'')) ||
      !buyer.order?.id || !buyer.db_fingerprint ||
      (buyer.runtime_sha!==env.E2E_EXPECTED_DEPLOY_SHA && !toolingEquivalent) ||
      buyer.blocked_requests?.length || buyer.payment_real || buyer.supplier_order_real) {
    throw new Error('G6_CANONICAL_BUYER_PROOF_INVALID');
  }
  return {id:buyer.order.id,reference:buyer.order.reference,market:buyer.order.market};
}

function validateCashProof(cash, buyer, scope, env) {
  const proof=(cash.steps||[]).find(s=>s.name==='CASH_UI_PAID' && s.market===scope.market);
  const pre=(cash.steps||[]).find(s=>s.name==='PRECHECK_TARGET_CASH_ORDERS');
  if(cash.verdict!=='G6_A_RELAY_UI_ASSIGNMENT_AND_CASH_CHROMIUM_PG_PASS_NOT_PICKUP_GO' ||
      cash.sha!==env.E2E_EXPECTED_DEPLOY_SHA || cash.db_fingerprint!==buyer.db_fingerprint ||
      (cash.steps||[]).filter(s=>s.name==='CASH_UI_PAID').length!==1 ||
      pre?.references?.[scope.market]!==buyer.order.reference ||
      proof?.reference!==buyer.order.reference || proof?.http!==200 ||
      proof?.payment_status!=='paid'||proof?.cash_collection_count!==1||
      proof?.cash_control_confirmed_count!==1 || cash.real_external_payment!==false) {
    throw new Error('G6_CANONICAL_CASH_NOT_LINKED_TO_BUYER');
  }
  return {reference:proof.reference,market:scope.market,http:proof.http,paid:true,collection_count:1};
}

function executeExisting(script, output, env) {
  fs.rmSync(output,{force:true});
  const started=Date.now();
  const p=spawnSync(process.execPath,[path.join(ROOT,script)],{
    cwd:ROOT,env,stdio:'inherit',timeout:9*60*1000
  });
  if(p.error||p.status!==0)throw new Error('G6_EXISTING_STAGE_FAILED_'+path.basename(script));
  if(!fs.existsSync(output)||fs.statSync(output).mtimeMs<started-1000) {
    throw new Error('G6_EXISTING_STAGE_FRESH_EVIDENCE_MISSING');
  }
  return JSON.parse(fs.readFileSync(output,'utf8'));
}

function validateHubProof(proof, order, cash) {
  if(proof.verdict!=='G6_P3_MANUAL_LINE_AND_DRAFT_PO_CHROMIUM_PASS' ||
      proof.reference!==order.reference ||
      proof.final?.order_id!==order.id ||
      proof.final?.payment_status!=='paid' ||
      Number(proof.final?.line_count)!==1 ||
      Number(proof.final?.po_count)!==1 ||
      Number(proof.final?.cash_collection_count)!==1 ||
      Number(proof.final?.cash_control_confirmed_count)!==1 ||
      cash.reference!==order.reference ||
      proof.external_supplier_calls!==0 || proof.external_payment_executed!==false) {
    throw new Error('G6_CANONICAL_HUB_PO_PROOF_NOT_BOUND_TO_ORDER');
  }
  return {reference:order.reference,order_id:order.id,po_count:1,line_count:1};
}

function validateCommitmentCheckpoint(previous,hub,buyer,scope) {
  if(scope.id!=='M01'||scope.market!=='KM'||
     previous.scenario_id!==scope.id||previous.market!==scope.market||
     previous.verdict!=='NOT_PROVEN'||previous.full_chain_certified!==false||
     previous.production_permitted!==false||previous.buyer_cash_verdict!=='PASS'||
     previous.hub_po_verdict!=='PASS'||previous.db_fingerprint!==buyer.db_fingerprint||
     previous.order?.id!==buyer.order?.id||
     previous.order?.reference!==buyer.order?.reference||
     !['BUYER','RELAY_CASH','HUB_PO'].every(id=>
       previous.stages?.some(s=>s.id===id&&s.verdict==='PASS'))){
    throw new Error('G6_COMMITMENT_PRIOR_CANONICAL_PROOF_INVALID');
  }
  const order={id:previous.order.id,reference:previous.order.reference,market:scope.market};
  validateHubProof(hub,order,{reference:order.reference});
  const poIds=(hub.gestures||[]).filter(g=>g.key==='prepare-draft-po'&&g.verdict==='PASS')
    .map(g=>g.purchase_order_id);
  if(poIds.length!==1||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(poIds[0]))
    throw new Error('G6_COMMITMENT_PRIOR_DRAFT_PO_NOT_UNIQUE');
  return {order,poId:poIds[0],dbFingerprint:previous.db_fingerprint};
}

function validateVendorReadinessCheckpoint(previous,commitment,scope) {
  const ref=String(previous.order?.reference||'');
  const po=String(previous.po_id||'');
  if(scope.id!=='M01'||scope.market!=='KM'||
     previous.reference_contract!=='G6-CANONICAL-JOURNEY-v1'||
     previous.scenario_id!==scope.id||previous.market!==scope.market||
     previous.verdict!=='NOT_PROVEN'||previous.full_chain_certified!==false||
     previous.production_permitted!==false||
     previous.next_stage!=='VENDOR_PROOF_AND_RECEIVING'||
     !/^[A-Z0-9][A-Z0-9-]{5,63}$/.test(ref)||
     !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(po)||
     !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(String(previous.order?.id||''))||
     !previous.db_fingerprint||
     !['BUYER','RELAY_CASH','HUB_PO'].every(id=>
       previous.stages?.some(st=>st.id===id&&st.verdict==='PREVIOUS_RUN_PASS'))||
     !previous.stages?.some(st=>st.id==='HUB_COMMITMENT'&&st.verdict==='PASS'&&
       st.po_id===po&&st.reference===ref)||
     commitment.verdict!=='G6_HUB_COMMITMENT_AND_INTERNAL_SUBMIT_CHROMIUM_PASS_NOT_VENDOR_OR_RECEIPT_GO'||
     commitment.reference!==ref||commitment.po_id!==po||
     commitment.db_fingerprint!==previous.db_fingerprint||
     commitment.after?.po_status!=='notified'||
     commitment.after?.commitment_count!==1||
     commitment.after?.payment_authorization_count!==0||
     commitment.external_supplier_calls!==0||
     commitment.external_payment_executed!==false){
    throw Error('G6_VENDOR_PRIOR_COMMITMENT_PROVENANCE_INVALID');
  }
  return {order:previous.order,poId:po,dbFingerprint:previous.db_fingerprint};
}

function validateVendorSimulationCheckpoint(previous,ready,scope) {
  if(scope.id!=='M01'||scope.market!=='KM'||
    previous.scenario_id!=='M01'||previous.market!=='KM'||
    previous.verdict!=='NOT_PROVEN'||previous.full_chain_certified!==false||
    previous.production_permitted!==false||
    previous.next_stage!=='REAL_SUPPLIER_SEND_EVIDENCE_REQUIRED'||
    previous.order?.reference!=='KL1WGP6'||
    !/^[a-f0-9-]{36}$/i.test(String(previous.order?.id||''))||
    !/^[a-f0-9-]{36}$/i.test(String(previous.po_id||''))||
    !previous.db_fingerprint||
    !previous.stages?.some(st=>st.id==='HUB_VENDOR_UI'&&st.verdict==='PASS_READONLY')||
    ready.verdict!=='G6_VENDOR_SEND_UI_READY_BUT_EXTERNAL_EVENT_NOT_PROVEN'||
    ready.po_id!==previous.po_id||ready.reference!==previous.order.reference||
    ready.db_fingerprint!==previous.db_fingerprint||
    ready.external_supplier_calls!==0||ready.external_payment_executed!==false||
    ready.supplier_send_certified!==false||ready.supplier_confirmation_certified!==false){
    throw Error('G6_VENDOR_SIMULATION_PRIOR_READONLY_PROVENANCE_INVALID');
  }
  return {order:previous.order,poId:previous.po_id,dbFingerprint:previous.db_fingerprint};
}

function validateHubReceivingCheckpoint(previous,simulated,scope) {
  const po='8353f1a3-f2a5-4c5e-b01c-95b4cb2004e3';
  const orderId='56adad65-d1fa-4e80-8d69-c25e0fe92a76';
  if(scope.id!=='M01'||scope.market!=='KM'||
     previous.scenario_id!=='M01'||previous.market!=='KM'||
     previous.verdict!=='NOT_PROVEN'||previous.full_chain_certified!==false||
     previous.production_permitted!==false||previous.next_stage!=='HUB_RECEIVING'||
     previous.po_id!==po||previous.order?.reference!=='KL1WGP6'||previous.order?.id!==orderId||
     !previous.db_fingerprint||
     !previous.stages?.some(s=>s.id==='HUB_VENDOR_SIMULATED'&&
       s.verdict==='PASS_SIMULATED_STAGING'&&s.po_id===po)||
     simulated.verdict!=='G6_VENDOR_SIMULATED_SEND_AND_CONFIRM_CHROMIUM_PASS_NOT_RECEIPT_GO'||
     simulated.reference!=='KL1WGP6'||simulated.po_id!==po||simulated.order_id!==orderId||
     simulated.db_fingerprint!==previous.db_fingerprint||
     simulated.after?.po_status!=='confirmed'||
     Number(simulated.after?.confirmed_quantity)!==1||
     Number(simulated.after?.manual_executions)!==1||
     Number(simulated.after?.payment_authorizations)!==0||
     simulated.provenance!=='SIMULATED / STAGING ONLY'||
     simulated.external_supplier_calls!==0||simulated.external_payment_executed!==false||
     simulated.physical_receipt_certified!==false)throw Error('G6_RECEIVING_PRIOR_SUPPLIER_PROOF_INVALID');
  return {order:previous.order,poId:po,dbFingerprint:previous.db_fingerprint};
}

function validateCustomerBagCheckpoint(previous,receipt,scope){
  const po='8353f1a3-f2a5-4c5e-b01c-95b4cb2004e3';
  const orderId='56adad65-d1fa-4e80-8d69-c25e0fe92a76';
  const sourceRef='SUPPLIER_PACKAGE-17824209-30d1-41be-87ad-1ef55c8a2994';
  if(scope.id!=='M01'||scope.market!=='KM'||previous.scenario_id!=='M01'||previous.market!=='KM'||
    previous.verdict!=='NOT_PROVEN'||previous.full_chain_certified!==false||previous.production_permitted!==false||
    previous.next_stage!=='KOM_BOX'||previous.order?.id!==orderId||previous.order?.reference!=='KL1WGP6'||
    previous.po_id!==po||!previous.db_fingerprint||
    !previous.stages?.some(x=>x.id==='HUB_RECEIVING'&&x.verdict==='PASS_SIMULATED_STAGING')||
    receipt.verdict!=='G6_HUB_RECEIPT_SIMULATED_CHROMIUM_HISTORICAL_UI_PG_READBACK_PASS'||
    receipt.reference!=='KL1WGP6'||receipt.order_id!==orderId||receipt.po_id!==po||
    receipt.physical_ref!==sourceRef||receipt.db_fingerprint!==previous.db_fingerprint||
    receipt.read_only!==true||receipt.external_supplier_calls!==0||receipt.external_payment_executed!==false||
    receipt.readback?.po?.status!=='hub_received'||receipt.readback?.remaining!==0||
    receipt.readback?.placements?.length!==1||receipt.readback.placements[0].reference!==sourceRef||
    receipt.readback.placements[0].evidence_method!=='MANUAL'||
    Number(receipt.readback.placements[0].quantity)!==1)
      throw Error('G6_CUSTOMER_BAG_RECEIPT_PROVENANCE_INVALID');
  return {order:previous.order,poId:po,dbFingerprint:previous.db_fingerprint,sourceRef};
}

function validateKomBoxCheckpoint(previous,bag,scope){
 const po='8353f1a3-f2a5-4c5e-b01c-95b4cb2004e3',orderId='56adad65-d1fa-4e80-8d69-c25e0fe92a76';
 const bagId='bcf810c9-33b2-438a-b4c3-857b024e2247',bagRef='KOM-ITEM-178D0AEA488AA4B5B9';
 const parcelId='95045ede-d5b8-405b-b65f-d9dbdddb4756',allocationId='3b430dcf-8662-44b4-a29f-27e38df19253';
 const after=bag.after,active=after?.units?.filter(u=>u.active)||[];
 if(scope.id!=='M01'||scope.market!=='KM'||previous.scenario_id!=='M01'||previous.market!=='KM'||
   previous.verdict!=='NOT_PROVEN'||previous.full_chain_certified!==false||previous.production_permitted!==false||
   previous.next_stage!=='KOM_BOX'||previous.order?.reference!=='KL1WGP6'||previous.order?.id!==orderId||
   previous.po_id!==po||!previous.db_fingerprint||
   !previous.stages?.some(x=>x.id==='HUB_CUSTOMER_BAG'&&x.verdict==='PASS_SIMULATED_STAGING'&&x.bag_id===bagId)||
   bag.verdict!=='G6_CUSTOMER_BAG_SIMULATED_CHROMIUM_PG_PASS'||bag.order_id!==orderId||bag.po_id!==po||
   bag.bag_id!==bagId||bag.bag_ref!==bagRef||bag.db_fingerprint!==previous.db_fingerprint||
   bag.external_supplier_calls!==0||bag.external_payment_executed!==false||bag.provenance!=='SIMULATED / STAGING ONLY'||
   bag.events?.length!==3||after?.order?.allocation_id!==allocationId||
   after.bags?.length!==1||after.bags[0].id!==bagId||after.bags[0].state!=='PACKED'||
   active.length!==1||active[0].id!==bagId||Number(active[0].quantity)!==1||
   active[0].evidence_method!=='MANUAL'||after.links?.length!==0||
   after.parcels?.length!==1||after.parcels[0].id!==parcelId)
    throw Error('G6_KOM_BOX_PRIOR_BAG_PROVENANCE_INVALID');
 return {order:previous.order,poId:po,dbFingerprint:previous.db_fingerprint,bagId,bagRef,parcelId,allocationId};
}

function validateShipmentCheckpoint(previous,box,scope){
 const po='8353f1a3-f2a5-4c5e-b01c-95b4cb2004e3',orderId='56adad65-d1fa-4e80-8d69-c25e0fe92a76';
 const bagId='bcf810c9-33b2-438a-b4c3-857b024e2247',bagRef='KOM-ITEM-178D0AEA488AA4B5B9';
 const parcelId='95045ede-d5b8-405b-b65f-d9dbdddb4756',allocationId='3b430dcf-8662-44b4-a29f-27e38df19253';
 const boxId='6ca614e5-869c-40ab-80d7-3684974092fe',boxRef='KOM-BOX-SIM-STAGING-KL1WGP6';
 const a=box.after;
 if(scope.id!=='M01'||scope.market!=='KM'||previous.scenario_id!=='M01'||previous.market!=='KM'||
   previous.verdict!=='NOT_PROVEN'||previous.full_chain_certified!==false||previous.production_permitted!==false||
   previous.next_stage!=='HUB_SHIPMENT'||previous.order?.id!==orderId||previous.order?.reference!=='KL1WGP6'||
   previous.po_id!==po||!previous.db_fingerprint||
   !previous.stages?.some(x=>x.id==='HUB_KOM_BOX'&&x.verdict==='PASS_SIMULATED_STAGING'&&x.box_id===boxId)||
   box.verdict!=='G6_KOM_BOX_SIMULATED_CHROMIUM_PG_PASS_PACKED'||box.order_id!==orderId||box.po_id!==po||
   box.box_id!==boxId||box.box_ref!==boxRef||box.bag_id!==bagId||box.bag_ref!==bagRef||
   box.parcel_id!==parcelId||box.allocation_id!==allocationId||box.db_fingerprint!==previous.db_fingerprint||
   box.external_supplier_calls!==0||box.external_payment_executed!==false||box.provenance!=='SIMULATED / STAGING ONLY'||
   box.events?.length!==8||a?.box?.length!==1||a.box[0].id!==boxId||a.box[0].state!=='PACKED'||
   a.bag?.length!==1||a.bag[0].id!==bagId||a.bag[0].state!=='PACKED'||
   a.links?.length!==1||a.links[0].bag_unit_id!==bagId||a.links[0].box_unit_id!==boxId||
   a.links[0].parcel_id!==parcelId||a.links[0].evidence_method!=='MANUAL'||
   a.effective?.length!==1||a.effective[0].allocation_id!==allocationId||Number(a.effective[0].quantity)!==1||
   a.parcels?.length!==1||a.parcels[0].id!==parcelId||a.parcels[0].status!=='preparation')
    throw Error('G6_SHIPMENT_PRIOR_BOX_PROVENANCE_INVALID');
 return {order:previous.order,poId:po,dbFingerprint:previous.db_fingerprint,boxId,boxRef,bagId,bagRef,parcelId,allocationId};
}
function validatePartialShipmentCheckpoint(previous,partial,scope){
  const orderId='56adad65-d1fa-4e80-8d69-c25e0fe92a76',poId='8353f1a3-f2a5-4c5e-b01c-95b4cb2004e3';
  const bagId='bcf810c9-33b2-438a-b4c3-857b024e2247',bagRef='KOM-ITEM-178D0AEA488AA4B5B9';
  const parcelId='95045ede-d5b8-405b-b65f-d9dbdddb4756',allocationId='3b430dcf-8662-44b4-a29f-27e38df19253';
  const boxId='6ca614e5-869c-40ab-80d7-3684974092fe',boxRef='KOM-BOX-SIM-STAGING-KL1WGP6';
  const shipmentId='ff8591fc-78bb-49a4-b154-247508368d16',shipmentRef='SIM-STAGING-EXP-KL1WGP6';
  const a=partial.after_dispatch;
  if(scope.id!=='M01'||scope.market!=='KM'||previous.scenario_id!=='M01'||previous.market!=='KM'||
     previous.verdict!=='BLOCKED'||previous.full_chain_certified!==false||previous.production_permitted!==false||
     previous.next_stage!=='HUB_SHIPMENT'||previous.resumed_from_run_id!=='44199423921'||
     previous.order?.id!==orderId||previous.order?.reference!=='KL1WGP6'||previous.po_id!==poId||
     previous.db_fingerprint!=='8acbf99fef010c23eac7d252'||
     !previous.stages?.some(x=>x.id==='HUB_KOM_BOX'&&x.verdict==='PASS_SIMULATED_STAGING')||
     partial.schema!=='komerce-g6-hub-shipment/1'||partial.verdict!=='BLOCKED'||partial.scenario_id!=='M01'||partial.market!=='KM'||
     partial.reference!=='KL1WGP6'||partial.order_id!==orderId||partial.po_id!==poId||partial.bag_id!==bagId||
     partial.bag_ref!==bagRef||partial.parcel_id!==parcelId||partial.allocation_id!==allocationId||
     partial.box_id!==boxId||partial.box_ref!==boxRef||partial.shipment_id!==shipmentId||partial.shipment_ref!==shipmentRef||
     partial.db_fingerprint!==previous.db_fingerprint||partial.sha!=='1fc4e7eac6295f00e56802611bb5e87db081c15a'||
     partial.provenance!=='SIMULATED / STAGING ONLY'||partial.external_supplier_calls!==0||partial.external_payment_executed!==false||
     partial.events?.length!==2||partial.events[0].key!=='open-shipment'||partial.events[0].http!==201||
     partial.events[1].key!=='dispatch-box'||partial.events[1].http!==200||partial.events[1].unit_id!==boxId||
     partial.before?.box?.length!==1||partial.before.box[0].id!==boxId||partial.before.box[0].state!=='PACKED'||
     partial.before.shipments?.length!==0||partial.after_open?.box?.[0]?.state!=='PACKED'||
     partial.after_open?.shipments?.[0]?.id!==shipmentId||
     !require('node:util').isDeepStrictEqual(a,partial.failure_readback)||
     a?.box?.length!==1||a.box[0].id!==boxId||a.box[0].state!=='DISPATCHED'||
     a.shipments?.length!==1||a.shipments[0].id!==shipmentId||a.shipments[0].reference!==shipmentRef||
     a.shipments[0].stage!=='hub_ready'||a.shipments[0].hub_draft!==true||
     a.shipmentLinks?.length!==1||a.shipmentLinks[0].shipment_id!==shipmentId||a.shipmentLinks[0].physical_unit_id!==boxId||
     a.shipmentEvents?.length!==1||a.shipmentEvents[0].event_type!=='opened'||a.shipmentEvents[0].proof_ref!==null||
     a.parcels?.length!==1||a.parcels[0].id!==parcelId||a.parcels[0].status!=='preparation'||
     a.parcelItems?.length!==1||Number(a.parcelItems[0].qty_shipped)!==0||Number(a.parcelItems[0].quantity)!==1||
     a.parcelEvents?.length!==0||a.effective?.length!==1||a.effective[0].allocation_id!==allocationId||
     Number(a.effective[0].quantity)!==1||a.links?.length!==1||a.links[0].bag_unit_id!==bagId||
     a.links[0].box_unit_id!==boxId||a.links[0].parcel_id!==parcelId||
     !a.custody?.some(e=>e.event_type==='STATE_TRANSITION'&&e.from_state==='PACKED'&&e.to_state==='DISPATCHED'&&e.actor_id))
    throw Error('G6_SHIPMENT_PARTIAL_PROVENANCE_INVALID');
  return {order:previous.order,poId,dbFingerprint:previous.db_fingerprint,boxId,boxRef,bagId,bagRef,parcelId,allocationId,shipmentId};
}
function validateForwarderCheckpoint(previous,shipment,scope){
 const id='56adad65-d1fa-4e80-8d69-c25e0fe92a76',po='8353f1a3-f2a5-4c5e-b01c-95b4cb2004e3';
 const sid='ff8591fc-78bb-49a4-b154-247508368d16',ref='SIM-STAGING-EXP-KL1WGP6';
 const box='6ca614e5-869c-40ab-80d7-3684974092fe',bag='bcf810c9-33b2-438a-b4c3-857b024e2247';
 const parcel='95045ede-d5b8-405b-b65f-d9dbdddb4756',allocation='3b430dcf-8662-44b4-a29f-27e38df19253';
 const fingerprint='8acbf99fef010c23eac7d252',a=shipment.after;
 if(scope.id!=='M01'||scope.market!=='KM'||previous.scenario_id!=='M01'||previous.market!=='KM'||
 previous.verdict!=='NOT_PROVEN'||previous.full_chain_certified!==false||previous.production_permitted!==false||
 previous.next_stage!=='FORWARDER_RECEIPT'||previous.order?.id!==id||previous.order?.reference!=='KL1WGP6'||previous.po_id!==po||
 previous.db_fingerprint!==fingerprint||!previous.stages?.some(x=>x.id==='HUB_SHIPMENT'&&x.verdict==='PASS_SIMULATED_STAGING'&&x.shipment_id===sid)||
 shipment.verdict!=='G6_HUB_SHIPMENT_SIMULATED_CHROMIUM_PG_PASS_HANDED_OVER'||shipment.reference!=='KL1WGP6'||
 shipment.order_id!==id||shipment.po_id!==po||shipment.box_id!==box||shipment.bag_id!==bag||
 shipment.parcel_id!==parcel||shipment.allocation_id!==allocation||shipment.shipment_id!==sid||shipment.shipment_ref!==ref||
 shipment.db_fingerprint!==fingerprint||shipment.sha!=='9d7f19feb1407826582850dfdb9489983af7b2f3'||
 shipment.provenance!=='SIMULATED / STAGING ONLY'||shipment.external_payment_executed!==false||shipment.external_supplier_calls!==0||
 shipment.events?.length!==3||shipment.events[2].key!=='handover-forwarder'||shipment.events[2].http!==200||
 a?.shipments?.length!==1||a.shipments[0].id!==sid||a.shipments[0].stage!=='handed_over'||
 a.box?.length!==1||a.box[0].id!==box||a.box[0].state!=='DISPATCHED'||a.parcels?.length!==1||
 a.parcels[0].id!==parcel||a.parcels[0].status!=='shipped'||a.parcelItems?.length!==1||
 Number(a.parcelItems[0].qty_shipped)!==1||a.parcelEvents?.length!==1)
 throw Error('G6_FORWARDER_HANDOVER_PROVENANCE_INVALID');
 return {order:previous.order,poId:po,dbFingerprint:fingerprint,boxId:box,bagId:bag,bagRef:shipment.bag_ref,parcelId:parcel,allocationId:allocation,shipmentId:sid};
}
function executeExistingHub(env) {
  fs.rmSync(HUB_PROOF,{force:true});
  const p=spawnSync(process.platform==='win32'?'npx.cmd':'npx',[
    'playwright','test','--config=playwright.hub-v1-clicks.config.js',
    'tests/staging-clicks/g6-p3-kuyiyuk.spec.js'
  ],{cwd:ROOT,env,stdio:'inherit',timeout:11*60*1000});
  if(p.error || p.status!==0)throw new Error('G6_CANONICAL_HUB_UI_STAGE_FAILED');
  if(!fs.existsSync(HUB_PROOF))throw new Error('G6_CANONICAL_HUB_EVIDENCE_MISSING');
  return JSON.parse(fs.readFileSync(HUB_PROOF,'utf8'));
}

async function main(env=process.env) {
  fs.mkdirSync(OUT,{recursive:true});
  const report={schema:'komerce-g6-canonical-replay/1',
    reference_contract:'G6-CANONICAL-JOURNEY-v1',
    scenario_id:null,market:null,staging_sha:null,db_fingerprint:null,
    order:null,stages:[],next_stage:'BUYER',verdict:'NOT_PROVEN',
    full_chain_certified:false,production_permitted:false,external_payment:false};
  const save=()=>fs.writeFileSync(REPORT,JSON.stringify(report,null,2)+'\n');
  save();
  try{
    const scope=validateGuard(env);
    const phase=String(env.G6_CANONICAL_PHASE||'BUYER_CASH');
    // The registry verifies declared stages before the certified legacy executor
    // handles their proven Chromium/PG implementation. NO stage may self-authorize.
    const graph=stageGraph(loadGoldenStages());
    const declaredStage=resolvePhase(phase,graph);
    if(!declaredStage || ['BUYER','RELAY_CASH'].includes(phase) || (phase!=='BUYER_CASH' && (scope.id!=='M01'||scope.market!=='KM')))
      throw new Error('G6_CANONICAL_PHASE_NOT_BOUND');
    report.scenario_id=scope.id;report.market=scope.market;
    report.source_matrix_version=scope.source_version;
    report.staging_sha=env.E2E_EXPECTED_DEPLOY_SHA;
    save();

    // Reuse an older real Chromium buyer checkpoint only when fetched by the
    // trusted owner-only GitHub workflow and when ONLY test tooling changed.
    // A missing artifact, unrelated order, stale database or runtime change
    // must fail closed, not rebuild or silently switch to a new buyer.
    let buyer, resumeDiff=null;
    const resumeRun=String(env.G6_CANONICAL_RESUME_RUN_ID||'');
    if(phase!=='BUYER_CASH'&&requiresResumeProof(phase,graph)&&!resumeRun)
      throw new Error('G6_CANONICAL_HUB_REQUIRES_PREVIOUS_STAGE_PROOF');
    if(phase==='CLIENT_PICKUP'){
      const id='56adad65-d1fa-4e80-8d69-c25e0fe92a76',sid='ff8591fc-78bb-49a4-b154-247508368d16';
      const parcel='95045ede-d5b8-405b-b65f-d9dbdddb4756',fingerprint='8acbf99fef010c23eac7d252';
      const po='8353f1a3-f2a5-4c5e-b01c-95b4cb2004e3';
      if(resumeRun!=='44272362064'||!fs.existsSync(RESUME_CANONICAL)||
       !fs.existsSync(path.join(ROOT,'test-results/g6-canonical-resume/g6-canonical-relay-receipt/report.json')))
       throw Error('G6_PICKUP_EXACT_RELAY_ARTIFACT_REQUIRED');
      const previous=JSON.parse(fs.readFileSync(RESUME_CANONICAL,'utf8'));
      const prior=JSON.parse(fs.readFileSync(path.join(ROOT,'test-results/g6-canonical-resume/g6-canonical-relay-receipt/report.json'),'utf8'));
      const a=prior.after?.base;
      if(scope.id!=='M01'||scope.market!=='KM'||previous.scenario_id!=='M01'||previous.market!=='KM'||
       previous.order?.id!==id||previous.order?.reference!=='KL1WGP6'||previous.po_id!==po||
       previous.db_fingerprint!==fingerprint||previous.next_stage!=='CLIENT_PICKUP'||
       previous.verdict!=='NOT_PROVEN'||previous.full_chain_certified!==false||
       previous.production_permitted!==false||
       !previous.stages?.some(x=>x.id==='RELAY_RECEIPT'&&x.verdict==='PASS_SIMULATED_STAGING'&&x.shipment_id===sid)||
       prior.schema!=='komerce-g6-relay-receipt/1'||prior.verdict!=='G6_RELAY_RECEIPT_SIMULATED_CHROMIUM_PG_PASS_AVAILABLE'||
       prior.shipment_id!==sid||prior.order_id!==id||prior.parcel_id!==parcel||
       prior.db_fingerprint!==fingerprint||prior.provenance!=='SIMULATED / STAGING ONLY'||
       prior.external_supplier_calls!==0||prior.external_payment_executed!==false||
       prior.events?.length!==1||prior.events[0].key!=='relay-receipt'||prior.events[0].http!==201||
       prior.events[0].role!=='agent_relais'||prior.assignment?.via!=='Chromium_UI'||
       prior.assignment?.http!==200||a?.shipments?.length!==1||a.shipments[0].id!==sid||
       a.shipments[0].stage!=='relay_received'||a.parcels?.length!==1||
       a.parcels[0].id!==parcel||a.parcels[0].status!=='available'||
       prior.after.orders?.length!==1||prior.after.orders[0].id!==id||
       prior.after.orders[0].status!=='available'||prior.after.receipts?.length!==1||
       Number(prior.after.receipts[0].received_qty)!==1||prior.after.receipts[0].incident_id!==null)
       throw Error('G6_PICKUP_RELAY_PROVENANCE_INVALID');
      report.resumed_from_run_id=resumeRun;report.order=previous.order;report.po_id=po;
      report.db_fingerprint=fingerprint;report.stages=previous.stages;report.next_stage='CLIENT_PICKUP';save();
      const result=executeExisting('scripts/recette/g6-canonical-client-pickup-chromium.js',
       path.join(ROOT,'test-results/g6-canonical-client-pickup/report.json'),{...env,
        // OTP fixture is the sole intentional non-UI write. The guarded writer
        // seeds a bcrypt OTP for the SAME marked buyer. Other business writes
        // must originate solely from the actual Chromium customer/relay controls.
        PGOPTIONS:'',
        G6_CANONICAL_ORDER_ID:id,G6_CANONICAL_ORDER_REFERENCE:'KL1WGP6',
        G6_CANONICAL_DB_FINGERPRINT:fingerprint,G6_CANONICAL_PO_ID:po,
        G6_CANONICAL_BAG_ID:'bcf810c9-33b2-438a-b4c3-857b024e2247',
        G6_CANONICAL_BAG_REF:'KOM-ITEM-178D0AEA488AA4B5B9',
        G6_CANONICAL_PARCEL_ID:parcel,
        G6_CANONICAL_ALLOCATION_ID:'3b430dcf-8662-44b4-a29f-27e38df19253',
        G6_CANONICAL_BOX_ID:'6ca614e5-869c-40ab-80d7-3684974092fe'});
      if(result.verdict!=='G6_CLIENT_PICKUP_SIMULATED_CHROMIUM_PG_PASS_COLLECTED'||
        result.order_id!==id||result.shipment_id!==sid||result.parcel_id!==parcel||
        result.db_fingerprint!==fingerprint||result.external_payment_executed!==false||
        result.external_supplier_calls!==0||result.plaintext_pickup_code_logged!==false||
        result.events?.length!==3||result.events[0].key!=='client-otp'||
        result.events[1].key!=='client-code-rotation'||result.events[2].key!=='relay-code-collect'||
        !result.events.every(x=>x.http===200)||result.after?.orders?.[0]?.status!=='collected'||
        result.after?.base?.parcels?.[0]?.status!=='collected'||result.after?.scans?.length!==1||
        result.after?.base?.shipments?.[0]?.stage!=='relay_received')
        throw Error('G6_PICKUP_FINAL_PROOF_INVALID');
      report.stages.push({id:'CLIENT_PICKUP',verdict:'PASS_SIMULATED_STAGING',via:'Chromium_UI',shipment_id:sid,
        evidence:'test-results/g6-canonical-client-pickup/report.json'});
      report.next_stage='COMPLETED_M01';report.verdict='G6_M01_SIMULATED_CHROMIUM_PG_PASS_COLLECTED';
      report.full_chain_certified=true;report.production_permitted=false;save();return report;
    }
    if(phase==='RELAY_RECEIPT'){
      if(resumeRun!=='44260374187'||!fs.existsSync(RESUME_CANONICAL)||
         !fs.existsSync(path.join(ROOT,'test-results/g6-canonical-resume/g6-canonical-customs/report.json')))
        throw Error('G6_RELAY_EXACT_CUSTOMS_ARTIFACT_REQUIRED');
      const previous=JSON.parse(fs.readFileSync(RESUME_CANONICAL,'utf8'));
      const prior=JSON.parse(fs.readFileSync(path.join(ROOT,'test-results/g6-canonical-resume/g6-canonical-customs/report.json'),'utf8'));
      const id='56adad65-d1fa-4e80-8d69-c25e0fe92a76',sid='ff8591fc-78bb-49a4-b154-247508368d16';
      const fingerprint='8acbf99fef010c23eac7d252',po='8353f1a3-f2a5-4c5e-b01c-95b4cb2004e3';
      const a=prior.after?.base;
      if(scope.id!=='M01'||scope.market!=='KM'||previous.scenario_id!=='M01'||previous.market!=='KM'||
        previous.verdict!=='NOT_PROVEN'||previous.full_chain_certified!==false||previous.production_permitted!==false||
        previous.next_stage!=='RELAY_RECEIPT'||previous.order?.id!==id||previous.order?.reference!=='KL1WGP6'||
        previous.po_id!==po||previous.db_fingerprint!==fingerprint||
        !previous.stages?.some(x=>x.id==='CUSTOMS_LOCAL'&&x.verdict==='PASS_SIMULATED_STAGING'&&x.shipment_id===sid)||
        prior.verdict!=='G6_CUSTOMS_LOCAL_SIMULATED_CHROMIUM_PG_PASS'||prior.shipment_id!==sid||
        prior.order_id!==id||prior.db_fingerprint!==fingerprint||prior.provenance!=='SIMULATED / STAGING ONLY'||
        prior.external_payment_executed!==false||prior.external_supplier_calls!==0||
        prior.events?.length!==5||!prior.events.every((e,i)=>e.http===[201,200,200,200,200][i]&&
          e.key===['customs_create','customs_link','customs_amount','customs_released','local_delivery'][i])||
        a?.shipments?.length!==1||a.shipments[0].id!==sid||a.shipments[0].stage!=='local_delivery'||
        a.box?.length!==1||a.box[0].id!=='6ca614e5-869c-40ab-80d7-3684974092fe'||
        a.box[0].state!=='DISPATCHED'||a.parcels?.length!==1||
        a.parcels[0].id!=='95045ede-d5b8-405b-b65f-d9dbdddb4756'||a.parcels[0].status!=='shipped'||
        !prior.after.linked||prior.after.customs?.length!==1)
        throw Error('G6_RELAY_CUSTOMS_PROVENANCE_INVALID');
      report.resumed_from_run_id=resumeRun;report.order=previous.order;report.po_id=po;
      report.db_fingerprint=fingerprint;report.stages=previous.stages;report.next_stage='RELAY_RECEIPT';save();
      const result=executeExisting('scripts/recette/g6-canonical-relay-receipt-chromium.js',
        path.join(ROOT,'test-results/g6-canonical-relay-receipt/report.json'),{...env,PGOPTIONS:'-c default_transaction_read_only=on',
          G6_CANONICAL_ORDER_ID:id,G6_CANONICAL_ORDER_REFERENCE:'KL1WGP6',
          G6_CANONICAL_DB_FINGERPRINT:fingerprint,
          G6_CANONICAL_PO_ID:po,G6_CANONICAL_BAG_ID:'bcf810c9-33b2-438a-b4c3-857b024e2247',
          G6_CANONICAL_BAG_REF:'KOM-ITEM-178D0AEA488AA4B5B9',
          G6_CANONICAL_PARCEL_ID:'95045ede-d5b8-405b-b65f-d9dbdddb4756',
          G6_CANONICAL_ALLOCATION_ID:'3b430dcf-8662-44b4-a29f-27e38df19253',
          G6_CANONICAL_BOX_ID:'6ca614e5-869c-40ab-80d7-3684974092fe'});
      if(result.verdict!=='G6_RELAY_RECEIPT_SIMULATED_CHROMIUM_PG_PASS_AVAILABLE'||
        result.shipment_id!==sid||result.order_id!==id||result.db_fingerprint!==fingerprint||
        result.events?.length!==1||result.events[0].http!==201||
        result.external_supplier_calls!==0||result.external_payment_executed!==false||
        result.after?.base?.shipments?.[0]?.stage!=='relay_received'||
        result.after?.base?.parcels?.[0]?.status!=='available')
        throw Error('G6_RELAY_FINAL_PROOF_INVALID');
      report.stages.push({id:'RELAY_RECEIPT',verdict:'PASS_SIMULATED_STAGING',via:'Chromium_UI',shipment_id:sid,
        evidence:'test-results/g6-canonical-relay-receipt/report.json'});
      report.next_stage='CLIENT_PICKUP';report.verdict='NOT_PROVEN';save();return report;
    }
    if(phase==='CUSTOMS'){
      if(resumeRun!=='44257485638'||!fs.existsSync(RESUME_CANONICAL))throw Error('G6_CUSTOMS_EXACT_ARTIFACT_REQUIRED');
      const previous=JSON.parse(fs.readFileSync(RESUME_CANONICAL,'utf8'));
      const prior=JSON.parse(fs.readFileSync(path.join(ROOT,'test-results/g6-canonical-resume/g6-canonical-forwarder/report.json'),'utf8'));
      const a=prior.after?.base,id='56adad65-d1fa-4e80-8d69-c25e0fe92a76',sid='ff8591fc-78bb-49a4-b154-247508368d16';
      const fingerprint='8acbf99fef010c23eac7d252',po='8353f1a3-f2a5-4c5e-b01c-95b4cb2004e3';
      const box='6ca614e5-869c-40ab-80d7-3684974092fe',bag='bcf810c9-33b2-438a-b4c3-857b024e2247';
      const parcel='95045ede-d5b8-405b-b65f-d9dbdddb4756',allocation='3b430dcf-8662-44b4-a29f-27e38df19253';
      if(scope.id!=='M01'||scope.market!=='KM'||previous.scenario_id!=='M01'||previous.market!=='KM'||
        previous.verdict!=='NOT_PROVEN'||previous.full_chain_certified!==false||previous.production_permitted!==false||
        previous.next_stage!=='CUSTOMS'||previous.order?.id!==id||previous.order?.reference!=='KL1WGP6'||previous.po_id!==po||
        previous.db_fingerprint!==fingerprint||!previous.stages?.some(x=>x.id==='FORWARDER'&&x.verdict==='PASS_SIMULATED_STAGING'&&x.shipment_id===sid)||
        prior.verdict!=='G6_FORWARDER_SIMULATED_CHROMIUM_PG_PASS_ARRIVED'||prior.shipment_id!==sid||prior.order_id!==id||
        prior.db_fingerprint!==fingerprint||prior.role!=='agent_transitaire'||prior.provenance!=='SIMULATED / STAGING ONLY'||
        prior.external_payment_executed!==false||prior.external_supplier_calls!==0||prior.events?.length!==4||
        !prior.events.every((e,i)=>e.http===200&&e.key===['forwarder_received','tracking','in_transit','arrived'][i])||
        a?.shipments?.length!==1||a.shipments[0].id!==sid||a.shipments[0].stage!=='arrived'||
        a.box?.length!==1||a.box[0].id!==box||a.box[0].state!=='DISPATCHED'||a.bag?.length!==1||a.bag[0].id!==bag||
        a.parcels?.length!==1||a.parcels[0].id!==parcel||a.parcels[0].status!=='shipped'||
        a.effective?.length!==1||a.effective[0].allocation_id!==allocation||Number(a.effective[0].quantity)!==1||
        prior.after.tracking?.tracking_reference!=='SIM-STAGING-TRK-KL1WGP6'||!prior.after.tracking.arrived_at)
        throw Error('G6_CUSTOMS_FORWARDER_PROVENANCE_INVALID');
      report.resumed_from_run_id=resumeRun;report.order=previous.order;report.po_id=po;report.db_fingerprint=fingerprint;
      report.stages=previous.stages;report.next_stage='CUSTOMS';save();
      const result=executeExisting('scripts/recette/g6-canonical-customs-chromium.js',
        path.join(ROOT,'test-results/g6-canonical-customs/report.json'),{...env,PGOPTIONS:'-c default_transaction_read_only=on',
        G6_CANONICAL_ORDER_ID:id,G6_CANONICAL_ORDER_REFERENCE:'KL1WGP6',G6_CANONICAL_PO_ID:po,
        G6_CANONICAL_DB_FINGERPRINT:fingerprint,G6_CANONICAL_BAG_ID:bag,G6_CANONICAL_BAG_REF:a.bag[0].reference,
        G6_CANONICAL_PARCEL_ID:parcel,G6_CANONICAL_ALLOCATION_ID:allocation,G6_CANONICAL_BOX_ID:box});
      if(result.verdict!=='G6_CUSTOMS_LOCAL_SIMULATED_CHROMIUM_PG_PASS'||result.shipment_id!==sid||
        result.order_id!==id||result.db_fingerprint!==fingerprint||result.events?.length!==5||
        result.external_payment_executed!==false||result.external_supplier_calls!==0||
        result.after?.base?.shipments?.[0]?.stage!=='local_delivery'||!result.after.linked)
        throw Error('G6_CUSTOMS_FINAL_PROOF_INVALID');
      report.stages.push({id:'CUSTOMS_LOCAL',verdict:'PASS_SIMULATED_STAGING',via:'Chromium_UI',shipment_id:sid,
        evidence:'test-results/g6-canonical-customs/report.json'});
      report.next_stage='RELAY_RECEIPT';report.verdict='NOT_PROVEN';save();return report;
    }
    if(phase==='FORWARDER'){
      if(resumeRun!=='44210239102'||!fs.existsSync(RESUME_CANONICAL)||!fs.existsSync(RESUME_SHIPMENT))
        throw Error('G6_FORWARDER_EXACT_ARTIFACT_REQUIRED');
      const previous=JSON.parse(fs.readFileSync(RESUME_CANONICAL,'utf8'));
      const bound=validateForwarderCheckpoint(previous,JSON.parse(fs.readFileSync(RESUME_SHIPMENT,'utf8')),scope);
      report.resumed_from_run_id=resumeRun;report.order=bound.order;report.po_id=bound.poId;report.db_fingerprint=bound.dbFingerprint;
      report.stages=previous.stages;report.next_stage='FORWARDER_RECEIPT';save();
      const result=executeExisting('scripts/recette/g6-canonical-forwarder-chromium.js',
        path.join(ROOT,'test-results/g6-canonical-forwarder/report.json'),{...env,PGOPTIONS:'-c default_transaction_read_only=on',
        G6_CANONICAL_ORDER_ID:bound.order.id,G6_CANONICAL_ORDER_REFERENCE:bound.order.reference,G6_CANONICAL_PO_ID:bound.poId,
        G6_CANONICAL_DB_FINGERPRINT:bound.dbFingerprint,G6_CANONICAL_BAG_ID:bound.bagId,G6_CANONICAL_BAG_REF:bound.bagRef,
        G6_CANONICAL_PARCEL_ID:bound.parcelId,G6_CANONICAL_ALLOCATION_ID:bound.allocationId,G6_CANONICAL_BOX_ID:bound.boxId});
      if(result.verdict!=='G6_FORWARDER_SIMULATED_CHROMIUM_PG_PASS_ARRIVED'||result.shipment_id!==bound.shipmentId||
        result.order_id!==bound.order.id||result.db_fingerprint!==bound.dbFingerprint||result.events?.length!==4||
        result.external_payment_executed!==false||result.external_supplier_calls!==0)
        throw Error('G6_FORWARDER_FINAL_PROOF_INVALID');
      report.stages.push({id:'FORWARDER',verdict:'PASS_SIMULATED_STAGING',via:'Chromium_UI',shipment_id:bound.shipmentId,
        evidence:'test-results/g6-canonical-forwarder/report.json'});
      report.next_stage='CUSTOMS';report.verdict='NOT_PROVEN';save();return report;
    }
    if(phase==='HUB_SHIPMENT'){
      const partialResume=resumeRun==='44203777890';
      if(!/^\d{8,}$/.test(resumeRun)||!fs.existsSync(RESUME_CANONICAL)||
         !fs.existsSync(partialResume?RESUME_SHIPMENT:RESUME_KOM_BOX))
        throw Error('G6_SHIPMENT_PRIOR_ARTIFACT_MISSING');
      const previous=JSON.parse(fs.readFileSync(RESUME_CANONICAL,'utf8'));
      const bound=partialResume
        ?validatePartialShipmentCheckpoint(previous,JSON.parse(fs.readFileSync(RESUME_SHIPMENT,'utf8')),scope)
        :validateShipmentCheckpoint(previous,JSON.parse(fs.readFileSync(RESUME_KOM_BOX,'utf8')),scope);
      report.resumed_from_run_id=resumeRun;report.order=bound.order;report.po_id=bound.poId;
      report.db_fingerprint=bound.dbFingerprint;
      report.stages=previous.stages.map(st=>({
        id:st.id,verdict:st.verdict==='PASS_SIMULATED_STAGING'?'PASS_SIMULATED_STAGING':'PREVIOUS_RUN_PASS',
        source_run_id:resumeRun,reference:bound.order.reference
      }));
      report.next_stage='HUB_SHIPMENT';save();
      const shipment=executeExisting('scripts/recette/g6-hub-shipment-chromium.js',
        HUB_SHIPMENT,{...env,PGOPTIONS:'-c default_transaction_read_only=on',
          G6_CANONICAL_ORDER_ID:bound.order.id,G6_CANONICAL_ORDER_REFERENCE:bound.order.reference,
          G6_CANONICAL_PO_ID:bound.poId,G6_CANONICAL_DB_FINGERPRINT:bound.dbFingerprint,
          G6_CANONICAL_BAG_ID:bound.bagId,G6_CANONICAL_BAG_REF:bound.bagRef,
          G6_CANONICAL_PARCEL_ID:bound.parcelId,G6_CANONICAL_ALLOCATION_ID:bound.allocationId,
          G6_CANONICAL_BOX_ID:bound.boxId,
          G6_CANONICAL_PARTIAL_SHIPMENT_ID:partialResume?bound.shipmentId:'',
          G6_CANONICAL_PARTIAL_SHIPMENT_REPORT:partialResume?RESUME_SHIPMENT:''});
      if(shipment.verdict!=='G6_HUB_SHIPMENT_SIMULATED_CHROMIUM_PG_PASS_HANDED_OVER'||
         shipment.order_id!==bound.order.id||shipment.po_id!==bound.poId||
         shipment.box_id!==bound.boxId||shipment.bag_id!==bound.bagId||
         shipment.parcel_id!==bound.parcelId||shipment.allocation_id!==bound.allocationId||
         shipment.db_fingerprint!==bound.dbFingerprint||shipment.external_supplier_calls!==0||
         shipment.external_payment_executed!==false||shipment.provenance!=='SIMULATED / STAGING ONLY'||
         !shipment.shipment_id||shipment.shipment_ref!=='SIM-STAGING-EXP-KL1WGP6'||shipment.events?.length!==3||
         (partialResume&&(shipment.shipment_id!==bound.shipmentId||shipment.resumed_from_run_id!==resumeRun||
           shipment.events[0].source_run_id!==resumeRun||shipment.events[1].source_run_id!==resumeRun||
           shipment.events[2].key!=='handover-forwarder'||shipment.events[2].source_run_id)))
        throw Error('G6_SHIPMENT_FINAL_PROOF_INVALID');
      report.stages.push({id:'HUB_SHIPMENT',verdict:'PASS_SIMULATED_STAGING',via:'Chromium_UI',
        reference:bound.order.reference,shipment_id:shipment.shipment_id,shipment_ref:shipment.shipment_ref,
        evidence:'test-results/g6-hub-shipment/report.json'});
      report.next_stage='FORWARDER_RECEIPT';report.verdict='NOT_PROVEN';save();
      console.log('[g6-canonical] same KOM-BOX dispatched and handed over by Hub; forwarder receipt NOT_PROVEN');
      return report;
    }
    if(phase==='HUB_KOM_BOX'){
      if(!/^\d{8,}$/.test(resumeRun)||!fs.existsSync(RESUME_CANONICAL)||!fs.existsSync(RESUME_CUSTOMER_BAG))
        throw Error('G6_KOM_BOX_CUSTOMER_BAG_ARTIFACT_MISSING');
      const previous=JSON.parse(fs.readFileSync(RESUME_CANONICAL,'utf8'));
      const bag=JSON.parse(fs.readFileSync(RESUME_CUSTOMER_BAG,'utf8'));
      const bound=validateKomBoxCheckpoint(previous,bag,scope);
      report.resumed_from_run_id=resumeRun;report.order=bound.order;report.po_id=bound.poId;
      report.db_fingerprint=bound.dbFingerprint;
      report.stages=previous.stages.map(st=>({
        id:st.id,verdict:st.verdict==='PASS_SIMULATED_STAGING'?'PASS_SIMULATED_STAGING':'PREVIOUS_RUN_PASS',
        source_run_id:resumeRun,reference:bound.order.reference
      }));
      report.next_stage='HUB_KOM_BOX';save();
      const box=executeExisting('scripts/recette/g6-hub-kom-box-chromium.js',
        HUB_KOM_BOX,{...env,PGOPTIONS:'-c default_transaction_read_only=on',
          G6_CANONICAL_ORDER_ID:bound.order.id,G6_CANONICAL_ORDER_REFERENCE:bound.order.reference,
          G6_CANONICAL_PO_ID:bound.poId,G6_CANONICAL_DB_FINGERPRINT:bound.dbFingerprint,
          G6_CANONICAL_BAG_ID:bound.bagId,G6_CANONICAL_BAG_REF:bound.bagRef,
          G6_CANONICAL_PARCEL_ID:bound.parcelId,G6_CANONICAL_ALLOCATION_ID:bound.allocationId});
      if(box.verdict!=='G6_KOM_BOX_SIMULATED_CHROMIUM_PG_PASS_PACKED'||box.order_id!==bound.order.id||
         box.po_id!==bound.poId||box.bag_id!==bound.bagId||box.parcel_id!==bound.parcelId||
         box.allocation_id!==bound.allocationId||box.db_fingerprint!==bound.dbFingerprint||
         box.external_supplier_calls!==0||box.external_payment_executed!==false||
         box.provenance!=='SIMULATED / STAGING ONLY'||!box.box_id||box.events?.length!==8)
        throw Error('G6_KOM_BOX_FINAL_PROOF_INVALID');
      report.stages.push({id:'HUB_KOM_BOX',verdict:'PASS_SIMULATED_STAGING',via:'Chromium_UI',
        reference:bound.order.reference,box_id:box.box_id,box_ref:box.box_ref,
        evidence:'test-results/g6-hub-kom-box/report.json'});
      report.next_stage='HUB_SHIPMENT';report.verdict='NOT_PROVEN';save();
      console.log('[g6-canonical] same sealed bag in PACKED KOM-BOX; shipment NOT_PROVEN');
      return report;
    }
    if(phase==='HUB_CUSTOMER_BAG'){
      if(!/^\d{8,}$/.test(resumeRun)||!fs.existsSync(RESUME_CANONICAL)||!fs.existsSync(RESUME_RECEIVING_READBACK))
        throw Error('G6_CUSTOMER_BAG_RECEIVING_ARTIFACT_MISSING');
      const previous=JSON.parse(fs.readFileSync(RESUME_CANONICAL,'utf8'));
      const receipt=JSON.parse(fs.readFileSync(RESUME_RECEIVING_READBACK,'utf8'));
      const bound=validateCustomerBagCheckpoint(previous,receipt,scope);
      report.resumed_from_run_id=resumeRun;report.order=bound.order;report.po_id=bound.poId;
      report.db_fingerprint=bound.dbFingerprint;
      report.stages=previous.stages.map(st=>({
        id:st.id,verdict:st.verdict==='PASS_SIMULATED_STAGING'?'PASS_SIMULATED_STAGING':'PREVIOUS_RUN_PASS',
        source_run_id:resumeRun,reference:bound.order.reference
      }));
      report.next_stage='HUB_CUSTOMER_BAG';save();
      const bag=executeExisting('scripts/recette/g6-hub-customer-bag-chromium.js',
        CUSTOMER_BAG,{...env,PGOPTIONS:'-c default_transaction_read_only=on',
          G6_CANONICAL_ORDER_ID:bound.order.id,G6_CANONICAL_ORDER_REFERENCE:bound.order.reference,
          G6_CANONICAL_PO_ID:bound.poId,G6_CANONICAL_DB_FINGERPRINT:bound.dbFingerprint,
          G6_CANONICAL_RECEIPT_REFERENCE:bound.sourceRef});
      if(bag.verdict!=='G6_CUSTOMER_BAG_SIMULATED_CHROMIUM_PG_PASS'||bag.order_id!==bound.order.id||
         bag.po_id!==bound.poId||bag.source_ref!==bound.sourceRef||
         bag.db_fingerprint!==bound.dbFingerprint||bag.provenance!=='SIMULATED / STAGING ONLY'||
         bag.external_supplier_calls!==0||bag.external_payment_executed!==false||
         !bag.bag_id||!bag.bag_ref||bag.events?.length!==3)
        throw Error('G6_CUSTOMER_BAG_FINAL_PROOF_INVALID');
      report.stages.push({id:'HUB_CUSTOMER_BAG',verdict:'PASS_SIMULATED_STAGING',via:'Chromium_UI',
        reference:bound.order.reference,bag_id:bag.bag_id,bag_ref:bag.bag_ref,
        evidence:'test-results/g6-hub-customer-bag/report.json'});
      report.next_stage='KOM_BOX';report.verdict='NOT_PROVEN';save();
      console.log('[g6-canonical] customer bag packed on SAME order; KOM-BOX NOT_PROVEN');
      return report;
    }
    if(phase==='HUB_RECEIVING_READBACK'){
      if(!/^\d{8,}$/.test(resumeRun)||!fs.existsSync(RESUME_CANONICAL)||
         !fs.existsSync(RESUME_HUB_RECEIVING))
        throw Error('G6_RECEIPT_READBACK_PRIOR_ARTIFACT_MISSING');
      const previous=JSON.parse(fs.readFileSync(RESUME_CANONICAL,'utf8'));
      const receipt=JSON.parse(fs.readFileSync(RESUME_HUB_RECEIVING,'utf8'));
      const ref='SUPPLIER_PACKAGE-';
      if(previous.scenario_id!=='M01'||previous.market!=='KM'||
         previous.verdict!=='BLOCKED'||previous.next_stage!=='HUB_RECEIVING'||
         previous.po_id!=='8353f1a3-f2a5-4c5e-b01c-95b4cb2004e3'||
         previous.order?.reference!=='KL1WGP6'||!previous.db_fingerprint||
         receipt.schema!=='komerce-g6-hub-receiving/1'||receipt.reference!=='KL1WGP6'||
         receipt.order_id!==previous.order.id||receipt.po_id!==previous.po_id||
         receipt.db_fingerprint!==previous.db_fingerprint||
         receipt.receipt?.http!==201||
         !String(receipt.receipt?.reference||'').startsWith(ref)||
         receipt.receipt?.evidence_method!=='MANUAL'||
         receipt.receipt?.evidence_ref!=='[SIMULATED / STAGING ONLY] G6-M01-RECEPTION-KL1WGP6'||
         receipt.error!=='G6_RECEIPT_SIMULATED_VENDOR_PROVENANCE_INVALID'||
         receipt.external_supplier_calls!==0||receipt.external_payment_executed!==false)
        throw Error('G6_RECEIPT_READBACK_PRIOR_UI_EVIDENCE_INVALID');
      report.resumed_from_run_id=resumeRun;report.po_id=previous.po_id;
      report.order=previous.order;report.db_fingerprint=previous.db_fingerprint;
      report.stages=previous.stages.map(st=>({
        id:st.id,verdict:'PREVIOUS_RUN_PASS',source_run_id:resumeRun,reference:previous.order.reference
      }));
      report.next_stage='HUB_RECEIVING_READBACK';save();
      const reread=executeExisting('scripts/recette/g6-hub-receiving-readback.js',
        HUB_RECEIVING_READBACK,{...env,PGOPTIONS:'-c default_transaction_read_only=on',
          G6_CANONICAL_ORDER_ID:previous.order.id,
          G6_CANONICAL_ORDER_REFERENCE:previous.order.reference,
          G6_CANONICAL_PO_ID:previous.po_id,
          G6_CANONICAL_DB_FINGERPRINT:previous.db_fingerprint,
          G6_CANONICAL_RECEIPT_REFERENCE:receipt.receipt.reference});
      if(reread.verdict!=='G6_HUB_RECEIPT_SIMULATED_CHROMIUM_HISTORICAL_UI_PG_READBACK_PASS'||
         reread.reference!=='KL1WGP6'||reread.po_id!==previous.po_id||
         reread.db_fingerprint!==previous.db_fingerprint||
         reread.physical_ref!==receipt.receipt.reference||reread.read_only!==true)
        throw Error('G6_RECEIPT_READBACK_FINAL_EVIDENCE_INVALID');
      report.stages.push({id:'HUB_RECEIVING',verdict:'PASS_SIMULATED_STAGING',
        via:'Chromium_UI_PREVIOUS_RUN_PLUS_INDEPENDENT_PG',po_id:previous.po_id,
        reference:previous.order.reference,evidence:'test-results/g6-hub-receiving-readback/report.json'});
      report.next_stage='KOM_BOX';report.verdict='NOT_PROVEN';save();
      console.log('[g6-canonical] receipt recognized from existing UI 201 + independent PG; KOM-BOX NOT_PROVEN');
      return report;
    }
    if(phase==='HUB_RECEIVING'){
      if(!/^\d{8,}$/.test(resumeRun)||!fs.existsSync(RESUME_CANONICAL)||
         !fs.existsSync(RESUME_VENDOR_SIMULATION))
        throw Error('G6_RECEIVING_PREVIOUS_VENDOR_ARTIFACT_MISSING');
      const previous=JSON.parse(fs.readFileSync(RESUME_CANONICAL,'utf8'));
      const simulated=JSON.parse(fs.readFileSync(RESUME_VENDOR_SIMULATION,'utf8'));
      const bound=validateHubReceivingCheckpoint(previous,simulated,scope);
      report.resumed_from_run_id=resumeRun;
      report.previous_staging_sha=previous.staging_sha;
      report.order=bound.order;report.po_id=bound.poId;report.db_fingerprint=bound.dbFingerprint;
      report.stages=previous.stages.map(st=>({
        id:st.id,verdict:'PREVIOUS_RUN_PASS',source_run_id:resumeRun,
        reference:bound.order.reference
      }));
      report.next_stage='HUB_RECEIVING';save();
      const received=executeExisting('scripts/recette/g6-hub-receiving-chromium.js',
        HUB_RECEIVING,{...env,G6_CANONICAL_ORDER_ID:bound.order.id,
          G6_CANONICAL_ORDER_REFERENCE:bound.order.reference,
          G6_CANONICAL_PO_ID:bound.poId,G6_CANONICAL_DB_FINGERPRINT:bound.dbFingerprint});
      if(received.verdict!=='G6_HUB_RECEIPT_SIMULATED_CHROMIUM_PASS_NOT_KOM_BOX_GO'||
         received.reference!==bound.order.reference||received.po_id!==bound.poId||
         received.db_fingerprint!==bound.dbFingerprint||
         received.physical_receipt_certified!==true||
         received.external_supplier_calls!==0||received.external_payment_executed!==false||
         received.provenance!=='SIMULATED / STAGING ONLY')
        throw Error('G6_RECEIVING_CHROMIUM_PROOF_INVALID');
      report.stages.push({id:'HUB_RECEIVING',verdict:'PASS_SIMULATED_STAGING',
        via:'Chromium_UI',po_id:bound.poId,reference:bound.order.reference,
        evidence:'test-results/g6-hub-receiving/report.json'});
      report.next_stage='KOM_BOX';report.verdict='NOT_PROVEN';save();
      console.log('[g6-canonical] same PO Hub reception PASS simulated staging; KOM-BOX NOT_PROVEN');
      return report;
    }
    if(phase==='HUB_VENDOR_SIMULATION'){
      if(!/^\d{8,}$/.test(resumeRun)||!fs.existsSync(RESUME_CANONICAL)||
         !fs.existsSync(RESUME_VENDOR_READY))
        throw Error('G6_VENDOR_SIMULATION_PRIOR_ARTIFACT_MISSING');
      const previous=JSON.parse(fs.readFileSync(RESUME_CANONICAL,'utf8'));
      const ready=JSON.parse(fs.readFileSync(RESUME_VENDOR_READY,'utf8'));
      const bound=validateVendorSimulationCheckpoint(previous,ready,scope);
      // The application changed deliberately to add simulated vendor proof.
      // Historical stages retain their own SHA; fresh current SHA, order and DB
      // identity are checked by the workflow and by the Chromium adapter.
      report.resumed_from_run_id=resumeRun;
      report.previous_staging_sha=previous.staging_sha;
      report.current_staging_sha=env.E2E_EXPECTED_DEPLOY_SHA;
      report.historical_checkpoint_revalidated_on_current_runtime=true;
      report.order=bound.order;report.po_id=bound.poId;report.db_fingerprint=bound.dbFingerprint;
      report.stages=previous.stages.map(st=>({id:st.id,verdict:'PREVIOUS_RUN_PASS',source_run_id:resumeRun,reference:bound.order.reference}));
      report.next_stage='HUB_VENDOR_SIMULATION';save();
      const vendor=executeExisting('scripts/recette/g6-hub-vendor-simulation-chromium.js',
        VENDOR_SIMULATION,{...env,G6_CANONICAL_ORDER_ID:bound.order.id,
          G6_CANONICAL_ORDER_REFERENCE:bound.order.reference,
          G6_CANONICAL_PO_ID:bound.poId,G6_CANONICAL_DB_FINGERPRINT:bound.dbFingerprint});
      if(vendor.verdict!=='G6_VENDOR_SIMULATED_SEND_AND_CONFIRM_CHROMIUM_PASS_NOT_RECEIPT_GO'||
         vendor.reference!==bound.order.reference||vendor.po_id!==bound.poId||
         vendor.db_fingerprint!==bound.dbFingerprint||
         vendor.supplier_send_certified!==true||vendor.supplier_confirmation_certified!==true||
         vendor.physical_receipt_certified!==false||vendor.external_supplier_calls!==0||
         vendor.external_payment_executed!==false||vendor.provenance!=='SIMULATED / STAGING ONLY')
        throw Error('G6_VENDOR_SIMULATION_EVIDENCE_INVALID');
      report.stages.push({id:'HUB_VENDOR_SIMULATED',verdict:'PASS_SIMULATED_STAGING',via:'Chromium_UI',
        po_id:bound.poId,reference:bound.order.reference,
        evidence:'test-results/g6-hub-vendor-simulation/report.json'});
      report.next_stage='HUB_RECEIVING';report.verdict='NOT_PROVEN';save();
      console.log('[g6-canonical] same PO simulated supplier send and confirmation PASS staging; Hub receipt NOT_PROVEN');
      return report;
    }
    if(phase==='HUB_VENDOR_READINESS'){
      if(!/^\d{8,}$/.test(resumeRun)||!fs.existsSync(RESUME_CANONICAL)||
         !fs.existsSync(RESUME_COMMITMENT))
        throw Error('G6_VENDOR_PRIOR_COMMITMENT_ARTIFACT_MISSING');
      const previous=JSON.parse(fs.readFileSync(RESUME_CANONICAL,'utf8'));
      const prior=JSON.parse(fs.readFileSync(RESUME_COMMITMENT,'utf8'));
      const bound=validateVendorReadinessCheckpoint(previous,prior,scope);
      const compatibility=verifyResumeTooling(previous.staging_sha,env.E2E_EXPECTED_DEPLOY_SHA);
      report.resumed_from_run_id=resumeRun;
      report.resume_tooling_diff=compatibility.changedFiles;
      report.order=bound.order;
      report.po_id=bound.poId;
      report.db_fingerprint=bound.dbFingerprint;
      report.stages=previous.stages.map(st=>({
        id:st.id,verdict:'PREVIOUS_RUN_PASS',source_run_id:resumeRun,
        reference:bound.order.reference
      }));
      report.next_stage='HUB_VENDOR_READINESS';save();
      const vendor=executeExisting('scripts/recette/g6-hub-vendor-readiness-chromium.js',
        VENDOR_READY,{...env,G6_CANONICAL_ORDER_ID:bound.order.id,
          G6_CANONICAL_ORDER_REFERENCE:bound.order.reference,
          G6_CANONICAL_PO_ID:bound.poId,
          G6_CANONICAL_DB_FINGERPRINT:bound.dbFingerprint});
      if(vendor.verdict!=='G6_VENDOR_SEND_UI_READY_BUT_EXTERNAL_EVENT_NOT_PROVEN'||
         vendor.reference!==bound.order.reference||vendor.po_id!==bound.poId||
         vendor.db_fingerprint!==bound.dbFingerprint||
         vendor.supplier_send_certified!==false||
         vendor.supplier_confirmation_certified!==false||
         vendor.physical_receipt_certified!==false||
         vendor.external_supplier_calls!==0||
         vendor.external_payment_executed!==false||
         vendor.screen?.external_send_form_not_submitted!==true)
        throw Error('G6_VENDOR_READONLY_SCREEN_EVIDENCE_INVALID');
      report.stages.push({id:'HUB_VENDOR_UI',verdict:'PASS_READONLY',via:'Chromium_UI',
        po_id:bound.poId,reference:bound.order.reference,
        evidence:'test-results/g6-hub-vendor-readiness/report.json'});
      report.next_stage='REAL_SUPPLIER_SEND_EVIDENCE_REQUIRED';
      report.verdict='NOT_PROVEN';save();
      console.log('[g6-canonical] vendor send screen visible, no external supplier event; M01 NOT_PROVEN');
      return report;
    }
    if(phase==='HUB_COMMITMENT'){
      if(!/^\d{8,}$/.test(resumeRun)||!fs.existsSync(RESUME_CANONICAL)||
         !fs.existsSync(RESUME_HUB_PROOF)||!fs.existsSync(RESUME_BUYER))
        throw new Error('G6_COMMITMENT_PREVIOUS_HUB_ARTIFACT_MISSING');
      if(!env.E2E_HUB_DIRECTOR_EMAIL||!env.E2E_HUB_DIRECTOR_PASSWORD||
         !env.E2E_AGENT_HUB_EMAIL||!env.E2E_AGENT_HUB_PASSWORD)
        throw new Error('G6_COMMITMENT_HUB_IDENTITIES_MISSING');
      const previous=JSON.parse(fs.readFileSync(RESUME_CANONICAL,'utf8'));
      const hub=JSON.parse(fs.readFileSync(RESUME_HUB_PROOF,'utf8'));
      const priorBuyer=JSON.parse(fs.readFileSync(RESUME_BUYER,'utf8'));
      const bound=validateCommitmentCheckpoint(previous,hub,priorBuyer,scope);
      const compatibility=verifyResumeTooling(previous.staging_sha,env.E2E_EXPECTED_DEPLOY_SHA);
      report.resumed_from_run_id=resumeRun;
      report.resume_tooling_diff=compatibility.changedFiles;
      report.db_fingerprint=bound.dbFingerprint;
      report.order=bound.order;
      report.po_id=bound.poId;
      report.stages=previous.stages.map(s=>({
        id:s.id,verdict:'PREVIOUS_RUN_PASS',source_run_id:resumeRun,reference:bound.order.reference
      }));
      report.next_stage='HUB_COMMITMENT';save();
      const commitment=executeExisting('scripts/recette/g6-hub-commitment-chromium.js',
        HUB_COMMITMENT,{...env,G6_CANONICAL_ORDER_ID:bound.order.id,
          G6_CANONICAL_ORDER_REFERENCE:bound.order.reference,
          G6_CANONICAL_PO_ID:bound.poId,
          G6_CANONICAL_DB_FINGERPRINT:bound.dbFingerprint});
      if(commitment.verdict!=='G6_HUB_COMMITMENT_AND_INTERNAL_SUBMIT_CHROMIUM_PASS_NOT_VENDOR_OR_RECEIPT_GO'||
         commitment.reference!==bound.order.reference||
         commitment.po_id!==bound.poId||
         commitment.db_fingerprint!==bound.dbFingerprint||
         commitment.external_supplier_calls!==0||commitment.external_payment_executed!==false||
         commitment.after?.commitment_count!==1||
         commitment.after?.payment_authorization_count!==0)
        throw new Error('G6_CANONICAL_HUB_COMMITMENT_PROOF_INVALID');
      report.stages.push({id:'HUB_COMMITMENT',verdict:'PASS',via:'Chromium_UI',
        reference:bound.order.reference,po_id:bound.poId,
        evidence:'test-results/g6-hub-commitment/report.json'});
      report.next_stage='VENDOR_PROOF_AND_RECEIVING';
      report.verdict='NOT_PROVEN';save();
      console.log('[g6-canonical] same order director commitment and internal PO submit PASS; vendor/physical chain NOT_PROVEN');
      return report;
    }
    if(resumeRun) {
      if(!/^\d{8,}$/.test(resumeRun)||!fs.existsSync(RESUME_BUYER))
        throw new Error('G6_CANONICAL_RESUME_ARTIFACT_MISSING');
      buyer=JSON.parse(fs.readFileSync(RESUME_BUYER,'utf8'));
      const oldCanonical=phase==='HUB_PO'&&fs.existsSync(RESUME_CANONICAL)
        ? JSON.parse(fs.readFileSync(RESUME_CANONICAL,'utf8')) : null;
      const expectedBuyerRun=String(oldCanonical?.resumed_from_run_id||resumeRun);
      if(String(buyer.run_id)!==expectedBuyerRun)
        throw new Error('G6_CANONICAL_RESUME_RUN_ID_MISMATCH');
      resumeDiff=verifyResumeTooling(buyer.runtime_sha,env.E2E_EXPECTED_DEPLOY_SHA);
      fs.mkdirSync(path.dirname(BUYER),{recursive:true});
      fs.copyFileSync(RESUME_BUYER,BUYER);
      report.resumed_from_run_id=resumeRun;
      report.resume_tooling_diff=resumeDiff.changedFiles;
    } else {
      buyer=executeExisting('scripts/recette/g6-p2-buyer-order-real-chromium.js',BUYER,env);
    }
    const order=validateBuyerProof(buyer,scope,env,{toolingEquivalent:!!resumeDiff?.equivalent});
    report.db_fingerprint=buyer.db_fingerprint;report.order=order;
    report.stages.push({id:'BUYER',verdict:'PASS',via:'Chromium_UI',
      evidence:'test-results/g6-p2-buyer-order/report.json',reference:order.reference});
    report.next_stage='RELAY_CASH';save();

    if(phase==='HUB_PO'){
      if(!fs.existsSync(RESUME_CASH)||!fs.existsSync(RESUME_CANONICAL))
        throw new Error('G6_CANONICAL_PREVIOUS_CASH_ARTIFACT_MISSING');
      const previous=JSON.parse(fs.readFileSync(RESUME_CANONICAL,'utf8'));
      const priorCash=JSON.parse(fs.readFileSync(RESUME_CASH,'utf8'));
      if(String(priorCash.run_id)!==resumeRun ||
         previous.scenario_id!==scope.id || previous.market!==scope.market ||
         previous.order?.reference!==order.reference ||
         previous.order?.id!==order.id ||
         previous.db_fingerprint!==buyer.db_fingerprint ||
         previous.buyer_cash_verdict!=='PASS' ||
         previous.verdict!=='NOT_PROVEN'){
        throw new Error('G6_CANONICAL_PREVIOUS_CASH_PROVENANCE_INVALID');
      }
      const compat=verifyResumeTooling(priorCash.sha,env.E2E_EXPECTED_DEPLOY_SHA);
      report.cash_resume_tooling_diff=compat.changedFiles;
      const paid=validateCashProof(priorCash,buyer,scope,{
        ...env,E2E_EXPECTED_DEPLOY_SHA:priorCash.sha
      });
      report.stages.push({id:'RELAY_CASH',verdict:'PASS',via:'Chromium_UI',
        reference:paid.reference,evidence:'test-results/g6-canonical-resume/g6-a-relay-cash/report.json'});
      report.next_stage='HUB_PO';save();
      if(!/^[a-f0-9-]{36}$/.test(String(buyer.buyer_id||'')))
        throw new Error('G6_CANONICAL_BUYER_ID_NOT_PROVEN');
      const hub=executeExistingHub({
        ...env,
        PGOPTIONS:'-c default_transaction_read_only=on',
        E2E_CLICKS_BASE_URL:ORIGIN,
        G6_CANONICAL_HUB_STAGE:'1',
        G6_CANONICAL_ORDER_REFERENCE:order.reference,
        G6_CANONICAL_ORDER_ID:order.id,
        G6_CANONICAL_BUYER_ID:buyer.buyer_id
      });
      const hubProof=validateHubProof(hub,order,paid);
      report.stages.push({id:'HUB_PO',verdict:'PASS',via:'Chromium_UI',
        evidence:'test-results/g6-p3-kuyiyuk/evidence.json',reference:hubProof.reference,
        readback:hubProof});
      report.next_stage='HUB_RECEIVING';
      report.hub_po_verdict='PASS';
      report.buyer_cash_verdict='PASS';
      report.verdict='NOT_PROVEN';save();
      console.log('[g6-canonical] same order buyer→cash→draft PO PASS; full M01 NOT_PROVEN: physical chain not bound');
      return report;
    }

    // Binding is the exact order returned by Chromium; not one of the hardcoded
    // historical refs. This script creates only marked test accounts and the
    // CASH business transition is still performed by a real relay UI click.
    const cash=executeExisting('scripts/recette/g6-a-relay-cash-real-chromium.js',CASH,{
      ...env,G6_CANONICAL_SCENARIO:scope.id,G6_CANONICAL_MARKET:scope.market,
      G6_CANONICAL_ORDER_REFERENCE:order.reference
    });
    const paid=validateCashProof(cash,buyer,scope,env);
    report.stages.push({id:'RELAY_CASH',verdict:'PASS',via:'Chromium_UI',
      evidence:'test-results/g6-a-relay-cash/report.json',
      reference:paid.reference,readback:paid});
    report.next_stage='HUB_PO';
    // Hub purchasing, reception, shipment, customs, final relay handover,
    // documents and financial ledgers still require order-bound adapters.
    // Never call the old fixture scripts on an unrelated order or claim GO.
    report.verdict='NOT_PROVEN';report.buyer_cash_verdict='PASS';
    save();
    console.log('[g6-canonical] buyer+cash PASS on SAME order; M01/M04/M05 overall NOT_PROVEN: Hub→retrait not bound');
  }catch(err){
    report.verdict='BLOCKED';
    report.error=String(err.message||err).slice(0,250);
    save();console.error('[g6-canonical] '+report.error);
    process.exitCode=2;
  }
  return report;
}

if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=2});
module.exports={validateGuard,validateBuyerProof,validateCashProof,validateHubProof,validateCommitmentCheckpoint,validateVendorReadinessCheckpoint,validateVendorSimulationCheckpoint,validateHubReceivingCheckpoint,validateCustomerBagCheckpoint,validateKomBoxCheckpoint,validateShipmentCheckpoint,validatePartialShipmentCheckpoint,validateForwarderCheckpoint,isToolingOnlyResumeDiff,verifyResumeTooling,main};
