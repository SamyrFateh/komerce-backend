'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {
  isDedicatedE2E,config,reconcileTarget,
}=require('../../scripts/recette/reconcile-staging-logistics-e2e');

const ORIGIN='https://komerce-backend-production.up.railway.app';
const ADMIN='e2e-admin@komerce.test';
const HUB='e2e-agent-hub@komerce.test';
const RELAY='e2e-agent-relais@komerce.test';
const HUB_PASS='OpaqueAgentHub123';
const RELAY_PASS='OpaqueAgentRelay123';
const ENV={
  KOMERCE_ENV:'staging', E2E_STAGING_BASE_URL:ORIGIN,
  E2E_LOGISTICS_RECONCILE_MODE:'reconcile',
  E2E_ADMIN_EMAIL:ADMIN, E2E_ADMIN_PASSWORD:'OpaqueAdmin123',
  E2E_AGENT_HUB_EMAIL:HUB, E2E_AGENT_HUB_PASSWORD:HUB_PASS,
  E2E_AGENT_RELAIS_EMAIL:RELAY, E2E_AGENT_RELAIS_PASSWORD:RELAY_PASS,
};
const fakeResponse=(status,payload={})=>({
  status,
  json:async()=>payload,
  headers:{get:()=>status===200?'__Host-kmrc_jwt=eyJ.abc.signature; Path=/; HttpOnly':null},
});

test('only explicit staging test addresses can be password reset',()=>{
  expect(isDedicatedE2E(HUB)).toBe(true);
  expect(isDedicatedE2E('operator.km.e2e@komerce.test')).toBe(true);
  expect(isDedicatedE2E('e2e.chromium.agent@recette.komerce.invalid')).toBe(true);
  for(const email of ['agent@komerce.km','e2e@komerce.km','real-agent@komerce.test',
    'agent@recette.komerce.invalid','e2e@evil.test','']) {
    expect(isDedicatedE2E(email)).toBe(false);
  }
});
test('reconcile refuses runtime outside the known Railway staging host',()=>{
  expect(()=>config(ENV).targets).not.toThrow();
  expect(()=>config({...ENV,KOMERCE_ENV:'production'})).toThrow('STAGING_ONLY');
  expect(()=>config({...ENV,E2E_STAGING_BASE_URL:'https://komerce.co'})).toThrow('STAGING_ONLY');
  expect(()=>config({...ENV,E2E_AGENT_RELAIS_EMAIL:'real@komerce.km'})).toThrow('NOT_DEDICATED_E2E_EMAIL_AGENT_RELAIS');
});
test('weak GitHub secret is never applied as an admin password reset',()=>{
  expect(()=>config({...ENV,E2E_AGENT_HUB_PASSWORD:'short'})).toThrow('PASSWORD_POLICY_NOT_MET_AGENT_HUB');
});

describe('Hub/Relay per-E2E-account reconciliation',()=>{
  const ORIG_FETCH=global.fetch;
  afterEach(()=>{global.fetch=ORIG_FETCH;});
  test('read-only audit reports 401 without writing',async()=>{
    const calls=[];
    global.fetch=jest.fn(async(url,opts)=>{
      calls.push({url:String(url),method:opts.method||'GET'});
      if(String(url).includes('/api/admin/users?'))return fakeResponse(200,{users:[{id:'hub-e2e-id',email:HUB,role:'agent_hub'}]});
      if(String(url).endsWith('/api/auth/login'))return fakeResponse(401);
      throw Error('UNEXPECTED_TEST_REQUEST');
    });
    const result=await reconcileTarget('__Host-kmrc_jwt=opaque-cookie',{label:'agent_hub',email:HUB,password:HUB_PASS},'audit');
    expect(result).toEqual({role:'agent_hub',status:'LOGIN_401_RECONCILE_REQUIRED'});
    expect(calls.map(x=>x.method)).toEqual(['GET','POST']);
  });
  test('reset only the exact E2E identity, then prove actual login succeeds',async()=>{
    const calls=[];
    let attempts=0;
    global.fetch=jest.fn(async(url,opts)=>{
      calls.push({url:String(url),method:opts.method||'GET',body:opts.body,origin:opts.headers.Origin});
      if(String(url).includes('/api/admin/users?'))return fakeResponse(200,{users:[{id:'hub-e2e-id',email:HUB,role:'agent_hub'}]});
      if(String(url).endsWith('/api/auth/login')){
        attempts++;
        return attempts===1?fakeResponse(401):fakeResponse(200,{user:{role:'agent_hub'}});
      }
      if(String(url).endsWith('/api/admin/users/hub-e2e-id/password'))return fakeResponse(200,{success:true});
      throw Error('UNEXPECTED_TEST_REQUEST');
    });
    const result=await reconcileTarget('__Host-kmrc_jwt=opaque-cookie',{label:'agent_hub',email:HUB,password:HUB_PASS},'reconcile');
    expect(result.status).toBe('LOGIN_CONFIRMED_AFTER_ADMIN_RESET');
    expect(result.http_status).toBe(200);
    const resets=calls.filter(x=>x.method==='PUT');
    expect(resets).toHaveLength(1);
    expect(resets[0].url).toBe(ORIGIN+'/api/admin/users/hub-e2e-id/password');
    expect(resets[0].origin).toBe(ORIGIN);
    expect(JSON.parse(resets[0].body)).toEqual({password:HUB_PASS});
    expect(JSON.stringify(result)).not.toContain(HUB_PASS);
  });
  test('an account with an unexpected role is never changed',async()=>{
    const methods=[];
    global.fetch=jest.fn(async(url,opts)=>{
      methods.push(opts.method||'GET');
      return fakeResponse(200,{users:[{id:'a',email:HUB,role:'admin'}]});
    });
    const result=await reconcileTarget('opaque',{label:'agent_hub',email:HUB,password:HUB_PASS},'reconcile');
    expect(result.status).toBe('UNEXPECTED_ACCOUNT_ROLE');
    expect(methods).toEqual(['GET']);
  });
  test('missing Hub/Relay account is not silently created',async()=>{
    global.fetch=jest.fn(async()=>fakeResponse(200,{users:[]}));
    const result=await reconcileTarget('opaque',{label:'agent_relais',email:RELAY,password:RELAY_PASS},'reconcile');
    expect(result.status).toBe('ACCOUNT_NOT_FOUND');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
