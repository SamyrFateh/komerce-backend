#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role          staging-e2e-hub-market-grant
 * @domain        auth-identity
 * @layer         tooling
 * @criticality   high
 * @inputs        dedicated E2E identities and passwords, ACTIVE market assignment, team delegation endpoints
 * @outputs       safe audit/result codes, single E2E Hub membership with scoped read capabilities
 * @depends       native fetch, auth API, team-delegation API, dashboard context API
 * @used-by       .github/workflows/staging-hub-e2e-market-grant.yml
 * @db-read       none
 * @db-write      none
 * @db-txn        canonical API routes own all mutations
 * @doctrine      dedicated_e2e_only, staging_only, least_privilege, no_global_grant, immutable_audit
 * @impact-areas  staging, auth-identity, market-delegation
 * @version       2026-11
 */
const ORIGIN='https://komerce-backend-production.up.railway.app';
const MARKET='KM';
const CAPABILITIES=Object.freeze(['operations.read','logistics.read']);
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
  const admin=await login(env.E2E_ADMIN_EMAIL,env.E2E_ADMIN_PASSWORD,'admin');
  const hub=await login(env.E2E_AGENT_HUB_EMAIL,env.E2E_AGENT_HUB_PASSWORD,'agent_hub');
  const operator=await login(env.E2E_MARKET_OPERATOR_EMAIL,env.E2E_MARKET_OPERATOR_PASSWORD,'market_operator');
  const lookup=await request('/api/admin/users?role=agent_hub&search='+
    encodeURIComponent(env.E2E_AGENT_HUB_EMAIL)+'&limit=100',{cookie:admin});
  if(lookup.status!==200)throw Error('E2E_HUB_USER_LOOKUP_FAILED');
  const candidates=(lookup.data?.users||[]).filter(u=>
    String(u.email||'').toLowerCase()===String(env.E2E_AGENT_HUB_EMAIL).toLowerCase()&&u.role==='agent_hub');
  if(candidates.length!==1)throw Error('HUB_E2E_ACCOUNT_NOT_UNIQUE');
  const memberUserId=candidates[0].id;

  const team=await request('/api/market-delegation/markets/'+MARKET+'/team',{cookie:operator});
  if(team.status!==200)throw Error('MARKET_TEAM_READ_UNAUTHORIZED_'+team.status);
  if(team.data.market?.code!==MARKET)throw Error('MARKET_TEAM_MISMATCH');
  const existing=(team.data.members||[]).filter(m=>m.user_id===memberUserId&&m.status==='ACTIVE');
  if(existing.length>1)throw Error('HUB_MULTIPLE_ACTIVE_MEMBERSHIPS');
  const hasCaps=existing.length===1&&CAPABILITIES.every(c=>existing[0].capabilities.includes(c));
  const before=await request('/api/admin/dashboard/context',{cookie:hub});
  const alreadyVisible=before.status===200 &&
    Array.isArray(before.data?.access?.allowedMarkets)&&
    before.data.access.allowedMarkets.includes(MARKET);
  if(hasCaps&&alreadyVisible)return {status:'HUB_E2E_SCOPED_VERIFIED',changed:false,
    memberActive:true,market:MARKET,sha:sha.slice(0,12)};
  if(settings.HUB_MARKET_GRANT_MODE==='audit'){
    return {status:'HUB_E2E_MARKET_GRANT_REQUIRED',changed:false,
      memberActive:existing.length===1,contextStatus:before.status,market:MARKET,sha:sha.slice(0,12)};
  }

  // A genuinely delegated market operator, not global admin, must authorize
  // the least-privilege grant on an ACTIVE assignment.
  const grantable=team.data.actor_grantable_capabilities||[];
  if(!CAPABILITIES.every(c=>grantable.includes(c)))
    throw Error('OPERATOR_CANNOT_GRANT_MINIMAL_HUB_CAPABILITIES');
  if(existing.length===1){
    const authority=team.data.actor_capabilities||[];
    if(!authority.includes('team.grant')||!authority.includes('team.revoke'))
      throw Error('OPERATOR_CANNOT_REPLACE_MEMBERSHIP_CAPABILITIES');
    const next=[...new Set([...existing[0].capabilities,...CAPABILITIES])].sort();
    const res=await request('/api/market-delegation/markets/'+MARKET+'/team/'+
      encodeURIComponent(existing[0].membership_id)+'/capabilities',{
      method:'PUT',cookie:operator,body:{capabilities:next}
    });
    if(res.status!==200)throw Error('HUB_MEMBERSHIP_GRANT_FAILED_'+res.status);
  }else{
    if(!(team.data.actor_capabilities||[]).includes('team.invite'))
      throw Error('OPERATOR_TEAM_INVITE_DENIED');
    const res=await request('/api/market-delegation/markets/'+MARKET+'/team/invitations',{
      method:'POST',cookie:operator,body:{email:env.E2E_AGENT_HUB_EMAIL,
        capabilities:CAPABILITIES}
    });
    if(res.status!==201||res.data?.kind!=='membership')
      throw Error('HUB_DIRECT_MEMBERSHIP_FAILED_'+res.status);
  }
  const after=await request('/api/admin/dashboard/context',{cookie:hub});
  if(after.status!==200 || !(after.data?.access?.allowedMarkets||[]).includes(MARKET))
    throw Error('HUB_CONTEXT_NOT_AVAILABLE_AFTER_MEMBERSHIP');
  const updated=await deployedVersion();
  if(updated!==sha)throw Error('STAGING_SHA_CHANGED_DURING_GRANT');
  return {status:'HUB_E2E_SCOPED_VERIFIED',changed:true,market:MARKET,
    memberActive:true,sha:sha.slice(0,12)};
}
async function main(){
  try {
    const result=await execute();
    console.log('[hub-e2e-scope] '+JSON.stringify(result));
    if(result.status!=='HUB_E2E_SCOPED_VERIFIED')process.exitCode=2;
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
