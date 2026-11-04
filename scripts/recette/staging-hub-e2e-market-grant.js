#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role          staging-e2e-hub-market-grant
 * @domain        auth-identity
 * @layer         tooling
 * @criticality   high
 * @inputs        dedicated E2E identities, staging, central Hub endpoints
 * @outputs       read-only central Hub proof without market-team grants
 * @depends       native fetch, auth API, Hub board and dossier, dashboard context
 * @used-by       .github/workflows/staging-hub-e2e-market-grant.yml
 * @db-read       none
 * @db-write      none
 * @db-txn        none; POST login only; business calls GET
 * @doctrine      central_hub_roles_remain_global, staging_only, read_only
 * @impact-areas  staging, auth-identity, market-delegation
 * @version       2026-11
 */
const ORIGIN='https://komerce-backend-production.up.railway.app';
const MARKET='KM';
const {isDedicatedE2E}=require('./reconcile-staging-logistics-e2e');

function checkEnv(env=process.env) {
  if(env.KOMERCE_ENV!=='staging'||env.E2E_STAGING_BASE_URL!==ORIGIN)
    throw new Error('STAGING_ONLY');
  if(!['audit','reconcile'].includes(env.HUB_MARKET_GRANT_MODE))
    throw new Error('MODE_INVALID');
  const required=['E2E_ADMIN_EMAIL','E2E_ADMIN_PASSWORD','E2E_MARKET_OPERATOR_EMAIL',
    'E2E_MARKET_OPERATOR_PASSWORD','E2E_AGENT_HUB_EMAIL','E2E_AGENT_HUB_PASSWORD'];
  if(required.some(k=>!env[k]))throw new Error('E2E_SECRETS_MISSING');
  if(!isDedicatedE2E(env.E2E_AGENT_HUB_EMAIL))throw new Error('HUB_E2E_ACCOUNT_NOT_DEDICATED');
  return env;
}
async function request(path,{method='GET',body,cookie}={}){
  const url=new URL(path,ORIGIN);
  if(url.origin!==ORIGIN)throw Error('UNTRUSTED_ORIGIN');
  const headers={'Accept':'application/json'};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(cookie){headers.Cookie=cookie;headers.Origin=ORIGIN;}
  const res=await fetch(url,{method,headers,
    body:body===undefined?undefined:JSON.stringify(body),
    signal:AbortSignal.timeout(25000),redirect:'manual'});
  const data=await res.json().catch(()=>({}));
  return {status:res.status,data,cookie:res.headers.get('set-cookie')||''};
}
function cookieOf(res){
  const part=res.cookie.split(';',1)[0];
  if(!/^__Host-kmrc_jwt=[a-zA-Z0-9._-]+$/.test(part))throw Error('E2E_SESSION_COOKIE_MISSING');
  return part;
}
async function login(email,password,role){
  const r=await request('/api/auth/login',{method:'POST',body:{email,password}});
  if(r.status!==200||r.data?.user?.role!==role)throw Error('E2E_LOGIN_ROLE_INVALID_'+role.toUpperCase());
  return cookieOf(r);
}
async function deployedVersion(){
  const r=await request('/health/version');
  const sha=String(r.data?.commit||r.data?.sha||'');
  if(r.status!==200||!/^[0-9a-f]{40}$/i.test(sha))throw Error('STAGING_SHA_UNVERIFIED');
  return sha;
}
async function execute(env=process.env){
  const settings=checkEnv(env);
  const sha=await deployedVersion();
  // Only login writes session state; all subsequent business requests are GET.
  const hub=await login(env.E2E_AGENT_HUB_EMAIL,env.E2E_AGENT_HUB_PASSWORD,'agent_hub');
  const admin=await login(env.E2E_ADMIN_EMAIL,env.E2E_ADMIN_PASSWORD,'admin');
  const operator=await login(env.E2E_MARKET_OPERATOR_EMAIL,env.E2E_MARKET_OPERATOR_PASSWORD,'market_operator');
  const checks=[];
  const record=(name,response,expected,valid=()=>true)=>{
    checks.push({name,pass:response.status===expected&&Boolean(valid(response.data)),http_status:response.status});
  };

  const context=await request('/api/admin/dashboard/context',{cookie:hub});
  record('HUB_CONTEXT_CENTRAL',context,200,d=>
    d?.access?.mode==='hub' &&
    Array.isArray(d.access.allowedMarkets) &&
    d.access.allowedMarkets.includes(MARKET) &&
    !d.access.capabilities?.includes('dashboard.global.read'));

  const board=await request('/api/hub/board',{cookie:hub});
  record('HUB_GLOBAL_BOARD',board,200,d=>
    d?.scope==='HUB_GLOBAL' &&
    Array.isArray(d.markets) && d.markets.includes(MARKET) &&
    Array.isArray(d.orders));
  const marketCodes=Array.isArray(board.data?.markets)?board.data.markets:[];
  record('HUB_CONTEXT_COVERS_ACTIVE_MARKETS',context,200,d=>
    Array.isArray(d?.access?.allowedMarkets) &&
    marketCodes.every(m=>d.access.allowedMarkets.includes(m)));

  // No market membership is granted or required. At least KM plus a second active market.
  const secondary=marketCodes.find(code=>code!==MARKET);
  const checkedMarkets=[MARKET,...(secondary?[secondary]:[])];
  for(const marketCode of checkedMarkets){
    const dossier=await request('/api/hub/dossier?market='+encodeURIComponent(marketCode),{cookie:hub});
    record('HUB_DOSSIER_'+marketCode,dossier,200,d=>
      d?.market?.code===marketCode && Array.isArray(d.orders));
  }

  // Hub must not inherit market-team or central admin privileges.
  record('HUB_TEAM_MARKET_FORBIDDEN',
    await request('/api/market-delegation/markets/'+MARKET+'/team',{cookie:hub}),403);
  record('HUB_GLOBAL_ADMIN_FORBIDDEN',
    await request('/api/market-delegation/central/team-matrix',{cookie:hub}),403);
  record('MARKET_OPERATOR_HUB_ADMIN_FORBIDDEN',
    await request('/api/hub/administration',{cookie:operator}),403);
  record('ADMIN_CENTRAL_MATRIX',
    await request('/api/market-delegation/central/team-matrix',{cookie:admin}),200);
  record('HUB_ADMINISTRATIVE_READ',
    await request('/api/hub/administration',{cookie:hub}),200);

  checks.push({name:'SHA_STABLE',pass:(await deployedVersion())===sha,http_status:null});
  return {
    status:checks.every(c=>c.pass)?'HUB_E2E_CENTRAL_VERIFIED':'HUB_E2E_CENTRAL_NOT_VERIFIED',
    changed:false,
    mode:settings.HUB_MARKET_GRANT_MODE==='reconcile'?'audit_only_no_grants':'audit',
    market:MARKET,markets_checked:checkedMarkets,sha:sha.slice(0,12),checks,
  };
}
async function main(){
  try {
    const result=await execute();
    console.log('[hub-e2e-scope] '+JSON.stringify(result));
    if(result.status!=='HUB_E2E_CENTRAL_VERIFIED')process.exitCode=2;
  }catch(e){
    // Fixed internal codes only; never serialize request bodies, cookies,
    // identities, membership IDs or passwords.
    const msg=/^[A-Z0-9_]+$/.test(e.message||'')?e.message:'E2E_SCOPE_CHECK_FAILED';
    console.error('[hub-e2e-scope] '+msg);
    process.exitCode=2;
  }
}
if(require.main===module)main();
module.exports={checkEnv,execute};
