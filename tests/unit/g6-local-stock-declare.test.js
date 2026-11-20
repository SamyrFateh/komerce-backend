/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');
const F='scripts/recette/g6-local-stock-declare-chromium.js';
const src=fs.readFileSync(path.join(ROOT,F),'utf8');
const wf=fs.readFileSync(path.join(ROOT,'.github/workflows/staging-g6-local-stock-declare.yml'),'utf8');
jest.mock('../../db',()=>({query:jest.fn(),pool:{end:jest.fn()}}));
jest.mock('playwright',()=>({chromium:{}}));
jest.mock('../../scripts/recette/target-guard',()=>({confirmTarget:jest.fn()}));
jest.mock('../../scripts/recette/g6-canonical-forwarder-chromium',()=>({login:jest.fn()}));
const mod=require('../../scripts/recette/g6-local-stock-declare-chromium');
const ok={GITHUB_REPOSITORY:'SamyrFateh/komerce-backend',GITHUB_EVENT_NAME:'issues',GITHUB_ACTOR:'o',GITHUB_REPOSITORY_OWNER:'o',
 NODE_ENV:'test',KOMERCE_ENV:'staging',KOMERCE_TARGET_ENV:'staging',EXPECTED_RAILWAY_ENVIRONMENT:'staging',
 STAGING_BASE_URL:'https://komerce-backend-production.up.railway.app',G6_TARGET_MARKET:'CM'};
describe('g6 local stock declare',()=>{
 test('owner staging guard accepts staging and refuses every drift',()=>{
  expect(mod.ownerStagingGuard(ok)).toBe(true);
  for(const [k,v] of [['KOMERCE_ENV','production'],['GITHUB_ACTOR','x'],['GITHUB_EVENT_NAME','push'],
   ['STAGING_BASE_URL','https://komerce.co'],['G6_TARGET_MARKET','FR'],['EXPECTED_RAILWAY_ENVIRONMENT','production']])
   expect(mod.ownerStagingGuard({...ok,[k]:v})).toBeFalsy();
 });
 test('quantity is 10 and a single receipt mutation is allowed',()=>{
  expect(mod.QTY).toBe(10);
  expect(src).toContain('calls++===0');
  expect((src.match(/humanClick\(/g)||[]).length).toBe(2); // déclaration puis « Exposer », une mutation chacun
  expect(src).toContain('put++===0');
  expect(src).toContain("mutations:1");
 });
 test('no SQL write and no raw gesture or direct HTTP',()=>{
  expect(src).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i);
  const {assertGestureSourceUsesHelper,assertTraceStartsAfterAuth,assertStageSqlWritesIdentityOnly}=require('../../scripts/recette/canonical/chromium-policy');
  const f=path.join(ROOT,F);
  expect(assertGestureSourceUsesHelper(f)).toBe(true);
  expect(assertTraceStartsAfterAuth(f)).toBe(true);
  expect(assertStageSqlWritesIdentityOnly(f)).toBe(true);
 });
 test('candidate selection: SCREEN_MISSING verdicts and ENABLED stock preference',()=>{
  expect(mod.pickCandidate([]).verdict).toBe('SCREEN_MISSING_PRICE_OR_EXPOSURE');
  expect(mod.pickCandidate([{id:'a',stock_exposure:'DISABLED'},{id:'b',stock_exposure:null}]).candidate.id).toBe('a');
  expect(mod.pickCandidate([{id:'a',stock_exposure:'DISABLED'},{id:'b',stock_exposure:'ENABLED'}]).candidate.id).toBe('b');
 });
 test('workflow is owner-only, staging-only, per-market titles, mono-market secrets',()=>{
  for(const m of ['KM','CM','CG'])expect(wf).toContain("'[staging-op] g6-local-stock-declare-"+m+"'");
  expect(wf).toContain('github.actor == github.repository_owner');
  expect(wf).toContain('KOMERCE_ENV: staging');
  expect(wf).toContain('node scripts/recette/target-guard.js');
  expect(wf).toContain('E2E_MARKET_OPERATOR_CM_EMAIL');
  expect(wf).not.toMatch(/E2E_ADMIN/);
 });
});
