#!/usr/bin/env node
'use strict';

/**
 * @komerce-arch
 * @role staging-logistics-e2e-password-reconcile
 * @domain auth-identity
 * @layer tooling
 * @criticality high
 * @inputs GitHub E2E_* credentials, E2E_ADMIN_* credentials, staging-only host
 * @outputs safe per-role status (no email, ID, cookie, JWT, password or hash)
 * @depends native fetch, canonical /api/auth/login and /api/admin/users/:id/password
 * @used-by .github/workflows/staging-e2e-logistics-reconcile.yml
 * @db-write none (all writes through existing authenticated audited admin API)
 * @doctrine per-user-only, e2e-identity-only, staging-only, never-global-password-reset
 * @impact-areas auth-identity, staging-only
 */
const ORIGIN='https://komerce-backend-production.up.railway.app';
const SAFE_ACCOUNT_DOMAINS=new Set(['komerce.test','recette.komerce.invalid']);
const TARGETS=Object.freeze([
  {label:'agent_hub',emailKey:'E2E_AGENT_HUB_EMAIL',passKey:'E2E_AGENT_HUB_PASSWORD'},
  {label:'agent_relais',emailKey:'E2E_AGENT_RELAIS_EMAIL',passKey:'E2E_AGENT_RELAIS_PASSWORD'},
]);

function isDedicatedE2E(email){
  const m=String(email||'').trim().toLowerCase().match(/^([^@\s]+)@([^@\s]+)$/);
  return Boolean(m && SAFE_ACCOUNT_DOMAINS.has(m[2]) && /(?:e2e|rct1|recette)/.test(m[1]));
}

function config(env=process.env){
  if(env.KOMERCE_ENV!=='staging' || env.E2E_STAGING_BASE_URL!==ORIGIN) throw Error('STAGING_ONLY');
  const mode=env.E2E_LOGISTICS_RECONCILE_MODE;
  if(!['audit','reconcile'].includes(mode))throw Error('INVALID_MODE');
  if(!env.E2E_ADMIN_EMAIL || !env.E2E_ADMIN_PASSWORD)throw Error('ADMIN_SECRETS_MISSING');
  const targets=TARGETS.map(t=>({...t,
    email:String(env[t.emailKey]||'').trim().toLowerCase(),
    password:String(env[t.passKey]||''),
  }));
  for(const t of targets){
    if(!isDedicatedE2E(t.email))throw Error('NOT_DEDICATED_E2E_EMAIL_'+t.label.toUpperCase());
    if(!t.password)throw Error('MISSING_PASSWORD_'+t.label.toUpperCase());
    if(t.password.length<8 || !/[A-Z]/.test(t.password) || !/[0-9]/.test(t.password)) {
      throw Error('PASSWORD_POLICY_NOT_MET_'+t.label.toUpperCase());
    }
  }
  return {mode,adminEmail:env.E2E_ADMIN_EMAIL,adminPassword:env.E2E_ADMIN_PASSWORD,targets};
}

async function request(path,{method='GET',body,cookie}={}){
  const url=new URL(path,ORIGIN);
  if(url.origin!==ORIGIN)throw Error('UNTRUSTED_URL');
  const headers={'Accept':'application/json'};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(cookie){headers.Cookie=cookie;headers.Origin=ORIGIN;}
  const response=await fetch(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body),
    redirect:'manual',signal:AbortSignal.timeout(20000)});
  if(response.status>=300 && response.status<400)throw Error('UNEXPECTED_REDIRECT_'+response.status);
  return response;
}
async function json(response){
  return response.json().catch(()=>({}));
}
function tokenCookie(response) {
  const setCookie=response.headers.get('set-cookie')||'';
  const candidate=setCookie.split(';',1)[0];
  if(!/^__Host-kmrc_jwt=[a-zA-Z0-9._-]+$/.test(candidate))throw Error('STAGING_AUTH_COOKIE_MISSING');
  return candidate;
}
async function authenticate(email,password,expectedRole){
  const response=await request('/api/auth/login',{method:'POST',body:{email,password}});
  if(response.status!==200)return {status:response.status,role:null,cookie:null};
  const payload=await json(response);
  const role=payload?.user?.role||null;
  const cookie=tokenCookie(response);
  return {status:response.status,role,cookie};
}
async function requireAdmin(configured){
  const admin=await authenticate(configured.adminEmail,configured.adminPassword);
  if(admin.status!==200 || admin.role!=='admin')throw Error('E2E_ADMIN_LOGIN_OR_ROLE_INVALID');
  const meResponse=await request('/api/auth/me',{cookie:admin.cookie});
  const me=await json(meResponse);
  if(meResponse.status!==200 || me.role!=='admin' ||
     String(me.email||'').toLowerCase()!==String(configured.adminEmail).toLowerCase()) {
    throw Error('ADMIN_SESSION_NOT_CONFIRMED');
  }
  return admin.cookie;
}
async function verifyDeployedRevision(env=process.env){
  const expected=String(env.E2E_EXPECTED_DEPLOY_SHA||'').trim();
  if(!/^[0-9a-f]{40}$/.test(expected))throw Error('EXPECTED_GIT_SHA_REQUIRED');
  const result=await request('/health/version');
  if(result.status!==200)throw Error('STAGING_VERSION_ENDPOINT_FAILED');
  const version=await json(result);
  const actual=String(version.commit||version.sha||'');
  if(!actual.startsWith(expected.slice(0,8)))throw Error('STAGING_DEPLOY_SHA_MISMATCH');
}
async function lookupExactE2E(cookie,target){
  const search=new URLSearchParams({role:target.label,search:target.email,limit:'100'});
  const resp=await request('/api/admin/users?'+search,{cookie});
  if(resp.status!==200)throw Error('ADMIN_USERS_READ_FAILED_'+resp.status);
  const data=await json(resp);
  const found=(Array.isArray(data.users)?data.users:[])
    .filter(user=>String(user.email||'').trim().toLowerCase()===target.email);
  if(found.length!==1)return {status:found.length===0?'ACCOUNT_NOT_FOUND':'AMBIGUOUS_E2E_IDENTITY'};
  const user=found[0];
  if(user.role!==target.label || !isDedicatedE2E(user.email))return {status:'UNEXPECTED_ACCOUNT_ROLE'};
  return {status:'FOUND',id:user.id};
}
async function reconcileTarget(cookie,target,mode){
  const found=await lookupExactE2E(cookie,target);
  if(found.status!=='FOUND')return {role:target.label,status:found.status};
  const before=await authenticate(target.email,target.password);
  if(before.status===200){
    return {role:target.label,status:before.role===target.label?'ALREADY_ALIGNED':'LOGIN_ROLE_MISMATCH'};
  }
  if(before.status!==401)return {role:target.label,status:'LOGIN_UNEXPECTED_HTTP',http_status:before.status};
  if(mode==='audit')return {role:target.label,status:'LOGIN_401_RECONCILE_REQUIRED'};
  const updated=await request('/api/admin/users/'+encodeURIComponent(found.id)+'/password',{
    method:'PUT',cookie,body:{password:target.password}});
  if(updated.status!==200) {
    const body=await json(updated);
    return {role:target.label,status:'ADMIN_PASSWORD_RESET_REJECTED',
      http_status:updated.status,error_code:typeof body.code==='string'?body.code:null};
  }
  const after=await authenticate(target.email,target.password);
  return {role:target.label,
    status:after.status===200 && after.role===target.label?'LOGIN_CONFIRMED_AFTER_ADMIN_RESET':'LOGIN_STILL_FAILED',
    http_status:after.status};
}
async function main(env=process.env){
  let settings;
  try{settings=config(env);}
  catch(error){console.error('[logistics-e2e] '+error.message);process.exitCode=2;return;}
  try{
    await verifyDeployedRevision(env);
    const cookie=await requireAdmin(settings);
    const results=[];
    for(const target of settings.targets){
      // Keep role-by-role diagnostics but never serialize request payloads.
      const r=await reconcileTarget(cookie,target,settings.mode);
      results.push(r);
      console.log('[logistics-e2e] '+JSON.stringify(r));
    }
    const good=results.every(r=>settings.mode==='audit'
      ? r.status==='ALREADY_ALIGNED'
      : ['ALREADY_ALIGNED','LOGIN_CONFIRMED_AFTER_ADMIN_RESET'].includes(r.status));
    console.log('[logistics-e2e] '+JSON.stringify({mode:settings.mode,
      status:good?'E2E_LOGIN_VERIFIED':'E2E_LOGIN_INCOMPLETE'}));
    if(!good)process.exitCode=2;
  }catch(error){
    // Error strings used here are fixed internal codes, never response bodies.
    const allowed=/^(?:STAGING_|EXPECTED_|E2E_ADMIN_|ADMIN_SESSION_|STAGING_DEPLOY_|ADMIN_USERS_|UNEXPECTED_REDIRECT_|UNTRUSTED_|STAGING_AUTH_)/;
    console.error('[logistics-e2e] '+(allowed.test(error.message)?error.message:'CHECK_FAILED'));
    process.exitCode=2;
  }
}
if(require.main===module)main();
module.exports={isDedicatedE2E,config,lookupExactE2E,reconcileTarget,verifyDeployedRevision,main};
