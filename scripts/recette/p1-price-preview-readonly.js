/**
 * @komerce-arch-lite
 * @role p1-staging-km-price-readonly-diagnostic
 * @domain economic-engine
 * @layer script
 * @owner backend-core
 * @purpose Diagnose the canonical KM local price gate for one real product, without writing any business record.
 * @impact-areas staging-only, pricing, catalog
 * @db-write none
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {request}=require('@playwright/test');
const {ORIGIN}=require('../../tests/staging-p1-20/write-policy');
const PRODUCT_REF='KPR-000093';
const MARKET='KM';
const OUT=path.resolve('test-results/staging-p1-one-product/price-gate-readonly.json');

function summarizePriceResponse(status, payload={}) {
  const rawCode=payload?.code||payload?.error?.code;
  const code=typeof rawCode==='string'?rawCode.slice(0,100):null;
  if(status===404) {
    return {status:'BLOCKED_NO_LOCAL_DECISION_OR_PRODUCT',http:status,code};
  }
  if(status!==200) {
    return {status:'PREVIEW_HTTP_BLOCKED',http:status,code};
  }
  const decision=payload.decision||{};
  const economics=payload.economics||{};
  const gate=payload.market_gate||{};
  const activation=payload.activation||{};
  const decisionStatus=decision.decision_status||null;
  const allowed=activation.allowed===true;
  return {
    status:decisionStatus==='LOCAL_ACTIVE'?'PRICE_ACTIVE_VERIFY_BUYER':
      (allowed?'AWAITING_HUMAN_ACTIVATION':'BLOCKED_ECONOMIC_GATE'),
    http:status,code,
    decision_status:decisionStatus,
    local_price_amount:decision.local_price??null,
    local_price_currency:decision.currency||null,
    market_gate_status:gate.decision_status||null,
    market_gate_reason:gate.reason||null,
    activation_allowed:allowed,
    activation_reason:activation.reason||null,
    economics:{
      projected_price_kmf:economics.projected_price_kmf??null,
      variable_cost_complete_kmf:economics.variable_cost_complete_kmf??null,
      cdr_complete_kmf:economics.cdr_complete_kmf??null,
      strategy_risk:economics.strategy_risk||null,
      estimated_margin_pct:economics.estimated_margin_pct??null
    }
  };
}

async function main(env=process.env) {
  const result={schema_version:1,generated_at:new Date().toISOString(),
    product_ref:PRODUCT_REF,market:MARKET,mode:'STRICT_READ_ONLY',
    deployed_sha:null,actor_role:null,verdict:'NOT_PROVEN',
    preview:null,write_count:0};
  let ctx;
  try {
    if(env.KOMERCE_ENV!=='staging'||
      env.E2E_STAGING_BASE_URL!==ORIGIN||
      env.E2E_P1_20_HUMAN_MODE!=='read-only')
      throw Error('P1_PRICE_READONLY_STAGING_REQUIRED');
    if(!/^[a-f0-9]{40}$/.test(env.E2E_EXPECTED_DEPLOY_SHA||''))
      throw Error('PINNED_SHA_MISSING');
    if(!env.E2E_MARKET_OPERATOR_EMAIL||!env.E2E_MARKET_OPERATOR_PASSWORD)
      throw Error('MARKET_OPERATOR_SECRET_MISSING');
    ctx=await request.newContext({baseURL:ORIGIN,timeout:15000});
    const vr=await ctx.get('/health/version');
    if(vr.status()!==200)throw Error('VERSION_REQUEST_FAILED');
    const v=await vr.json();
    result.deployed_sha=String(v.commit||v.sha||'');
    if(result.deployed_sha!==env.E2E_EXPECTED_DEPLOY_SHA)throw Error('STAGING_SHA_MISMATCH');
    const ar=await ctx.post('/api/auth/login',{
      data:{email:env.E2E_MARKET_OPERATOR_EMAIL,
        password:env.E2E_MARKET_OPERATOR_PASSWORD}});
    if(ar.status()!==200)throw Error('MARKET_OPERATOR_LOGIN_'+ar.status());
    const mr=await ctx.get('/api/auth/me');
    if(mr.status()!==200)throw Error('MARKET_OPERATOR_SESSION_'+mr.status());
    const actor=await mr.json();
    result.actor_role=actor.role||null;
    if(result.actor_role!=='market_operator')throw Error('INCORRECT_ACTOR_ROLE');
    const response=await ctx.get('/api/admin/workspaces/pricing/market/KM/products/'+
      PRODUCT_REF+'/local-price/activation-preview');
    const payload=await response.json().catch(()=>({}));
    result.preview=summarizePriceResponse(response.status(),payload);
    result.verdict=result.preview.status;
    if(![200,404].includes(response.status())){
      throw Error('PREVIEW_UNEXPECTED_HTTP_'+response.status());
    }
  }catch(error){
    result.error_code=String(error.message||error).slice(0,140);
    if(result.verdict==='NOT_PROVEN')result.verdict='DIAGNOSTIC_BLOCKED';
    process.exitCode=2;
  }finally{
    if(ctx)await ctx.dispose();
    fs.mkdirSync(path.dirname(OUT),{recursive:true});
    fs.writeFileSync(OUT,JSON.stringify(result,null,2)+'\n');
    // No cookies, credentials, actor ids or authorization snapshot in report/log.
    console.log('[P1-PRICE-GATE] '+JSON.stringify(result));
  }
  return result;
}
if(require.main===module)main();
module.exports={summarizePriceResponse,main};
