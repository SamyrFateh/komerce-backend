'use strict';
/** @test-kind unit @test-runner jest @test-requires none
 *  @brief G2 fail-closed: Chromium and both HTTP action runners cannot bypass staging HOLD.
 */
const fs=require('fs');
const path=require('path');
const auth=require('../../scripts/recette/hub-v1-staging-target-authorization');
const http=require('../../scripts/recette/hub-v1-http-action-runner');
const physical=require('../../scripts/recette/hub-v1-http-physical-chain');
const ROOT=path.resolve(__dirname,'../..');
const STAGING='https://komerce-backend-production.up.railway.app';
const RUN='A1B2C3D4';

afterEach(()=>jest.restoreAllMocks());

test('HTTP PO and physical chains reject HOLD before authentication or database mutation',async()=>{
  const gate=jest.spyOn(auth,'authorizeOfficialStaging')
    .mockRejectedValue(new Error('STAGING_PREFLIGHT_HOLD_BLOCKS_ALL_WRITES'));
  const db={query:jest.fn(),getClient:jest.fn(),pool:{end:jest.fn()}};
  const env={HTTP_RUNNER_BASE_URL:STAGING,HTTP_RUNNER_RUN8:RUN};
  await expect(http.run({db,run8:RUN,env}))
    .rejects.toThrow('STAGING_PREFLIGHT_HOLD_BLOCKS_ALL_WRITES');
  await expect(physical.run({db,run8:RUN,env}))
    .rejects.toThrow('STAGING_PREFLIGHT_HOLD_BLOCKS_ALL_WRITES');
  expect(gate).toHaveBeenCalledTimes(2);
  expect(gate).toHaveBeenNthCalledWith(1,{db,run:RUN,env});
  expect(gate).toHaveBeenNthCalledWith(2,{db,run:RUN,env});
  expect(db.query).not.toHaveBeenCalled();
  expect(db.getClient).not.toHaveBeenCalled();
});

test.each([
  ['.github/workflows/hub-v1-http-actions-staging.yml','Runner HTTP d\'actions'],
  ['.github/workflows/hub-v1-clicks-staging.yml','Clics Chromium'],
])('%s executes hard HOLD after pinned SHA and before any business action',file=>{
  const yaml=fs.readFileSync(path.join(ROOT,file),'utf8');
  const pin=yaml.indexOf('node scripts/recette/resolve-staging-deploy-pin.js');
  const hold=yaml.indexOf('node scripts/recette/hub-v1-staging-transactional-preflight.js');
  const action=yaml.indexOf(file.includes('http-actions')?'Runner HTTP d\'actions':'Clics Chromium');
  expect(pin).toBeGreaterThan(0);
  expect(hold).toBeGreaterThan(pin);
  expect(action).toBeGreaterThan(hold);
  expect(yaml).toContain('HUB_V1_E2E_APPLY_MODE: approved');
  expect(yaml).toContain('HUB_V1_CERTIFICATION_RUN: ${{ inputs.run8 }}');
  expect(yaml).not.toContain('inputs.allow_distribution');
  expect(yaml).toContain("ALLOW_DISTRIBUTION: '0'");
});

test('real Chromium spec checks official staging authorization before first login',()=>{
  const src=fs.readFileSync(path.join(ROOT,'tests/staging-clicks/hub-v1-clicks.spec.js'),'utf8');
  const before=src.indexOf('test.beforeAll(async () =>');
  const gate=src.indexOf('.authorizeOfficialStaging({ db, run: RUN8 })');
  const login=src.indexOf("test('Hub : reception fournisseur");
  expect(before).toBeGreaterThan(0);
  expect(gate).toBeGreaterThan(before);
  expect(login).toBeGreaterThan(gate);
  expect(src).toContain('.assertEphemeralTarget(process.env.DATABASE_URL, [])');
});

test('Chromium cannot hide NOT_REACHABLE_IN_UI or NOT_RUN under a green suite',()=>{
  const src=fs.readFileSync(path.join(ROOT,'tests/staging-clicks/hub-v1-clicks.spec.js'),'utf8');
  expect(src).toContain("row.verdict!=='CLICK_PASS'");
  expect(src).toContain("CHROMIUM_CLICKS_BLOCKED_NOT_PROVEN");
  expect(src).toContain("HUB_V1_CHROMIUM_GESTURES_NOT_PROVEN");
  expect(src).toContain("SQL_READBACK_PENDING");
  expect(src).toContain("evidence.never_claims='G2_CHROMIUM_STAGING_PASS'");
  const persist=src.indexOf('save();',src.indexOf('test.afterAll(async () =>'));
  const refusal=src.indexOf("throw new Error('HUB_V1_CHROMIUM_GESTURES_NOT_PROVEN:");
  expect(persist).toBeGreaterThan(0);
  expect(refusal).toBeGreaterThan(persist);
});

test('localhost cannot reuse Railway database even with HTTP_RUNNER_ALLOW_LOCAL=1',async()=>{
  const {assertEphemeralTarget}=require('../../scripts/recette/hub-v1-certification-runner');
  const db={query:jest.fn(),getClient:jest.fn()};
  const remote='postgres://u:password@railway.example:5432/railway';
  const env={
    HTTP_RUNNER_BASE_URL:'http://localhost:3987',
    HTTP_RUNNER_ALLOW_LOCAL:'1',
    DATABASE_URL:remote,
  };
  expect(()=>assertEphemeralTarget(remote,[])).toThrow('HUB_V1_RUNNER_LOCAL_EPHEMERAL_DATABASE_ONLY');
  await expect(http.run({db,run8:RUN,env})).rejects.toThrow('HUB_V1_RUNNER_LOCAL_EPHEMERAL_DATABASE_ONLY');
  await expect(physical.run({db,run8:RUN,env})).rejects.toThrow('HUB_V1_RUNNER_LOCAL_EPHEMERAL_DATABASE_ONLY');
  expect(db.query).not.toHaveBeenCalled();
  expect(db.getClient).not.toHaveBeenCalled();
});
