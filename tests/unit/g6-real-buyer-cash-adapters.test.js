/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {createRealBuyerCashAdapters}=require('../../scripts/recette/canonical/real-buyer-cash-adapters');
const env={
 GITHUB_EVENT_NAME:'issues',GITHUB_ACTOR:'SamyrFateh',
 GITHUB_REPOSITORY_OWNER:'SamyrFateh',GITHUB_REPOSITORY:'SamyrFateh/komerce-backend',
 GITHUB_RUN_ID:'45123456789',NODE_ENV:'test',KOMERCE_ENV:'staging',
 KOMERCE_TARGET_ENV:'staging',EXPECTED_RAILWAY_ENVIRONMENT:'staging',
 STAGING_BASE_URL:'https://komerce-backend-production.up.railway.app',
 G6_CANONICAL_SCENARIO:'M01',G6_TARGET_MARKET:'KM',
 E2E_EXPECTED_DEPLOY_SHA:'a'.repeat(40),
 DATABASE_URL:'postgresql://redacted.invalid/not-connected',
 E2E_ADMIN_EMAIL:'admin@example.invalid',E2E_ADMIN_PASSWORD:'not-real'
};
const db={query:jest.fn()};
describe('G6 real Chromium/PG adapter — strict scope and no historical fallback',()=>{
 test('rejects non-owner issues, production and unsupported markets without DB access',()=>{
  for(const change of [
   {GITHUB_ACTOR:'other'},{GITHUB_EVENT_NAME:'workflow_dispatch'},
   {GITHUB_REPOSITORY:'untrusted/repo'},{KOMERCE_ENV:'production'},
   {KOMERCE_TARGET_ENV:'production'},{G6_TARGET_MARKET:'CM'},
   {G6_CANONICAL_SCENARIO:'N01'},{E2E_EXPECTED_DEPLOY_SHA:'invalid'},
   {GITHUB_RUN_ID:'7'},{DATABASE_URL:''}
  ]){
   expect(()=>createRealBuyerCashAdapters({db,env:{...env,...change}}))
    .toThrow('G6_REAL_BUYER_CASH_OWNER_STAGING_GUARD');
  }
  expect(db.query).not.toHaveBeenCalled();
 });
 test('does not dispatch HUB or final-mile scripts through legacy hardcoded fixtures',async()=>{
  const a=createRealBuyerCashAdapters({db,env});
  for(const stageId of ['UNMIGRATED','FAKE_STAGE']){
   await expect(a.executeStage({stageId,context:{}}))
    .rejects.toThrow('G6_DYNAMIC_DOWNSTREAM_STAGE_NOT_MIGRATED_'+stageId);
  }
  expect(db.query).not.toHaveBeenCalled();
 });
 test('HUB_PO refuses to proceed without an attested fresh buyer checkpoint',async()=>{
  const a=createRealBuyerCashAdapters({db,env});
  await expect(a.executeStage({stageId:'HUB_PO',context:{
   order_id:'550e8400-e29b-41d4-a716-446655440000'
  }})).rejects.toThrow('G6_DYNAMIC_BUYER_CHECKPOINT_MISSING');
  expect(db.query).not.toHaveBeenCalled();
 });
 test.each(['HUB_COMMITMENT','HUB_VENDOR_READINESS','HUB_VENDOR_SIMULATION','HUB_RECEIVING','HUB_RECEIVING_READBACK','HUB_CUSTOMER_BAG','HUB_KOM_BOX','HUB_SHIPMENT','FORWARDER','CUSTOMS','RELAY_RECEIPT','CLIENT_PICKUP'])(
  '%s refuses to run without authenticated previous Hub checkpoint',async stageId=>{
   const a=createRealBuyerCashAdapters({db,env});
   await expect(a.executeStage({stageId,context:{}}))
    .rejects.toThrow('G6_DYNAMIC_BUYER_CHECKPOINT_MISSING');
  }
 );
 test('physical receipt is read only for stages after HUB_RECEIVING',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const src=fs.readFileSync(path.resolve(__dirname,
   '../../scripts/recette/canonical/real-buyer-cash-adapters.js'),'utf8');
  expect(src).toContain("const receipt=needsReceipt?report('HUB_RECEIVING').data:null");
  const start=src.indexOf('const needsReceipt=');
  const end=src.indexOf(';',start);
  const text=src.slice(start,end);
  for(const stage of ['HUB_COMMITMENT','HUB_VENDOR_READINESS','HUB_VENDOR_SIMULATION','HUB_RECEIVING'])
   expect(text).not.toContain("'"+stage+"'");
  for(const stage of ['HUB_RECEIVING_READBACK','HUB_CUSTOMER_BAG','HUB_KOM_BOX'])
   expect(text).toContain("'"+stage+"'");
 });
 test('requires database adapter and stage evidence',()=>{
  expect(()=>createRealBuyerCashAdapters({env})).toThrow('G6_DYNAMIC_DATABASE_REQUIRED');
 });
});
