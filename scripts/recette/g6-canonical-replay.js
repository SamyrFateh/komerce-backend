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
const {spawnSync}=require('node:child_process');
const {resolveCanonicalReplay}=require('./g6-canonical-journey-binding');

const ROOT=path.resolve(__dirname,'../..');
const OUT=path.join(ROOT,'test-results/g6-canonical-replay');
const REPORT=path.join(OUT,'report.json');
const BUYER=path.join(ROOT,'test-results/g6-p2-buyer-order/report.json');
const CASH=path.join(ROOT,'test-results/g6-a-relay-cash/report.json');
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

function validateBuyerProof(buyer, scope, env) {
  if(buyer.verdict!=='G6_P2_REAL_OTP_CHROMIUM_ORDER_CREATED_NO_EXTERNAL_EFFECTS' ||
      buyer.market!==scope.market || buyer.order?.market!==scope.market ||
      buyer.order?.scope!=='G6-BUYER' || buyer.order?.payment_status==='paid' ||
      buyer.order?.payment_mode!=='cash_relais' ||
      !VALID_REF.test(String(buyer.order?.reference||'')) ||
      !buyer.order?.id || !buyer.db_fingerprint ||
      buyer.runtime_sha!==env.E2E_EXPECTED_DEPLOY_SHA ||
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
    report.scenario_id=scope.id;report.market=scope.market;
    report.source_matrix_version=scope.source_version;
    report.staging_sha=env.E2E_EXPECTED_DEPLOY_SHA;
    save();

    // No new buyer flow: invoke the SAME approved staging Chromium adapter.
    const buyer=executeExisting('scripts/recette/g6-p2-buyer-order-real-chromium.js',BUYER,env);
    const order=validateBuyerProof(buyer,scope,env);
    report.db_fingerprint=buyer.db_fingerprint;report.order=order;
    report.stages.push({id:'BUYER',verdict:'PASS',via:'Chromium_UI',
      evidence:'test-results/g6-p2-buyer-order/report.json',reference:order.reference});
    report.next_stage='RELAY_CASH';save();

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
module.exports={validateGuard,validateBuyerProof,validateCashProof,main};
