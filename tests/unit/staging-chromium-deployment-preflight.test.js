'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {inspect,checkEnv,readVersion,isToolingOnlyPath,ORIGIN}=
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
  const report=await inspect(ENV,{fetcher,now:()=>clock,wait:async()=>{clock+=5000;},
    timeoutMs:10000,compareRuntime:async()=>({equivalent:false,reason:'RUNTIME_FILES_CHANGED'})});
  expect(report.status).toBe('DEPLOY_SHA_NOT_READY');
  expect(report.observed_sha).not.toBe(SHA);
  expect(report.attempts).toBeGreaterThanOrEqual(2);
});
test('waits for deployment until SHA is exact; never accepts arbitrary SHA',async()=>{
  const fetcher=jest.fn()
    .mockResolvedValueOnce(response(200,'b83d4386f3e78d19835457261edb9506f1b37f31'))
    .mockResolvedValueOnce(response(200,SHA));
  let clock=0;
  const report=await inspect(ENV,{fetcher,now:()=>clock,wait:async()=>{clock+=5000;},
    timeoutMs:10000,compareRuntime:async()=>({equivalent:false,reason:'RUNTIME_FILES_CHANGED'})});
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

test('Railway skip-build is allowed only for verified test/tooling-only changes',async()=>{
  const deployed='7b136f27bd3cbc4610c37652dfcbcae0655c2678';
  const diff=['tests/staging-canonical/link-replay.js',
    'tests/staging-canonical/real-navigation.spec.js',
    'tests/unit/staging-chromium-link-replay.test.js'];
  const report=await inspect(ENV,{
    fetcher:async()=>response(200,deployed),now:()=>0,wait:async()=>{},timeoutMs:0,
    compareRuntime:async(actual,runner)=>{
      expect(actual).toBe(deployed);
      expect(runner).toBe(SHA);
      return {equivalent:true,changedFiles:diff};
    }
  });
  expect(report).toMatchObject({status:'DEPLOY_RUNTIME_EQUIVALENT',
    expected_sha:SHA,observed_sha:deployed,tooling_diff:diff});
});
test('runtime-file differences never count as harmless skipped builds',async()=>{
  const deployed='b83d4386f3e78d19835457261edb9506f1b37f31';
  const report=await inspect(ENV,{
    fetcher:async()=>response(200,deployed),now:()=>0,wait:async()=>{},timeoutMs:0,
    compareRuntime:async()=>({equivalent:false,changedFiles:['services/dashboard-admin-context.js'],
      reason:'RUNTIME_FILES_CHANGED'})
  });
  expect(report.status).toBe('DEPLOY_SHA_NOT_READY');
  expect(report.reason).toBe('RUNTIME_FILES_CHANGED');
});
test('runtime classification is fail-closed for arbitrary files',()=>{
  for(const file of ['tests/unit/demo.test.js','scripts/recette/audit.js',
    'docs/doctrine.md','.github/workflows/chromium.yml',
    'playwright.staging-canonical.config.js','playwright.staging-interactive.config.js'])expect(isToolingOnlyPath(file)).toBe(true);
  for(const file of ['server.js','services/dashboard-admin-context.js',
    'public/dashboards/canonical/js/app.js','migrations/300.sql',
    'scripts/fix-schema.js','package.json','db.js'])expect(isToolingOnlyPath(file)).toBe(false);
});
