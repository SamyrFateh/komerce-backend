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

const ROOT=path.resolve(__dirname,'../..');
const OUT=path.join(ROOT,'test-results/g6-canonical-replay');
const REPORT=path.join(OUT,'report.json');
const BUYER=path.join(ROOT,'test-results/g6-p2-buyer-order/report.json');
const CASH=path.join(ROOT,'test-results/g6-a-relay-cash/report.json');
const RESUME_BUYER=path.join(ROOT,'test-results/g6-canonical-resume/g6-p2-buyer-order/report.json');
const RESUME_CASH=path.join(ROOT,'test-results/g6-canonical-resume/g6-a-relay-cash/report.json');
const RESUME_CANONICAL=path.join(ROOT,'test-results/g6-canonical-resume/g6-canonical-replay/report.json');
const HUB_PROOF=path.join(ROOT,'test-results/g6-p3-kuyiyuk/evidence.json');
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
  'tests/staging-clicks/g6-p3-kuyiyuk.spec.js',
  'tests/unit/g6-canonical-journey-replay.test.js',
  'docs/recette/PARCOURS_REFERENCE_UNIQUE.md'
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
    if(!['BUYER_CASH','HUB_PO'].includes(phase) || (phase==='HUB_PO'&&(scope.id!=='M01'||scope.market!=='KM')))
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
    if(phase==='HUB_PO'&&!resumeRun)throw new Error('G6_CANONICAL_HUB_REQUIRES_PREVIOUS_CASH_PROOF');
    if(resumeRun) {
      if(!/^\d{8,}$/.test(resumeRun)||!fs.existsSync(RESUME_BUYER))
        throw new Error('G6_CANONICAL_RESUME_ARTIFACT_MISSING');
      buyer=JSON.parse(fs.readFileSync(RESUME_BUYER,'utf8'));
      if(String(buyer.run_id)!==resumeRun)
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
module.exports={validateGuard,validateBuyerProof,validateCashProof,validateHubProof,isToolingOnlyResumeDiff,verifyResumeTooling,main};
