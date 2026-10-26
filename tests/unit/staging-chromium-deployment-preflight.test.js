'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {inspect,checkEnv,readVersion,ORIGIN}=
  require('../../scripts/recette/staging-chromium-deployment-preflight');
const SHA='44a07b0bc330d9e9e733748e43aa06330c365a1e';
const ENV={E2E_EXPECTED_DEPLOY_SHA:SHA,E2E_STAGING_BASE_URL:ORIGIN};
const response=(status,sha)=>({
  ok:status===200,status,json:async()=>({commit:sha})
});

test('rejects untrusted targets and missing expected SHA',()=>{
  expect(checkEnv(ENV)).toBe(SHA);
  expect(()=>checkEnv({...ENV,E2E_STAGING_BASE_URL:'https://komerce.co'}))
    .toThrow('UNTRUSTED_STAGING_ORIGIN');
  expect(()=>checkEnv({...ENV,E2E_EXPECTED_DEPLOY_SHA:''}))
    .toThrow('EXPECTED_COMMIT_SHA_INVALID');
});
test('actual deployed staging SHA is authoritative, not branch name',async()=>{
  const fetcher=jest.fn(async()=>response(200,SHA));
  const report=await inspect(ENV,{fetcher,now:()=>0,wait:async()=>{},timeoutMs:0});
  expect(report.status).toBe('DEPLOY_SHA_MATCHED');
  expect(report.observed_sha).toBe(SHA);
  expect(fetcher.mock.calls[0][0]).toBe(ORIGIN+'/health/version');
});
test('stale deployment fails closed and is never declared green',async()=>{
  const fetcher=jest.fn(async()=>response(200,'b83d4386f3e78d19835457261edb9506f1b37f31'));
  let clock=0;
  const report=await inspect(ENV,{fetcher,now:()=>clock,wait:async()=>{clock+=5000;},timeoutMs:10000});
  expect(report.status).toBe('DEPLOY_SHA_NOT_READY');
  expect(report.observed_sha).not.toBe(SHA);
  expect(report.attempts).toBeGreaterThanOrEqual(2);
});
test('waits for deployment until SHA is exact; never accepts arbitrary SHA',async()=>{
  const fetcher=jest.fn()
    .mockResolvedValueOnce(response(200,'b83d4386f3e78d19835457261edb9506f1b37f31'))
    .mockResolvedValueOnce(response(200,SHA));
  let clock=0;
  const report=await inspect(ENV,{fetcher,now:()=>clock,wait:async()=>{clock+=5000;},timeoutMs:10000});
  expect(report.status).toBe('DEPLOY_SHA_MATCHED');
  expect(report.attempts).toBe(2);
});
test('missing SHA and HTTP errors do not masquerade as aligned deployment',async()=>{
  expect(await readVersion(async()=>response(200,'local'))).toMatchObject({
    status:'VERSION_MISSING_SHA',sha:null
  });
  const report=await inspect(ENV,{
    fetcher:async()=>response(503,null),now:()=>0,wait:async()=>{},timeoutMs:0
  });
  expect(report.status).toBe('DEPLOY_SHA_NOT_READY');
});
