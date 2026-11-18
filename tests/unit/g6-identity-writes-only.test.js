/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {IDENTITY_TABLES,IDENTITY_WRITES_BY_SCRIPT,sqlWriteTables,assertStageSqlWritesIdentityOnly,assertGestureSourceUsesHelper}
 =require('../../scripts/recette/canonical/chromium-policy');
const ROOT=path.join(__dirname,'../..');
const rec=f=>path.join(ROOT,'scripts/recette',f);
const stepScripts=()=>[...fs.readdirSync(path.join(ROOT,'scripts/recette')).filter(f=>/^g6-.*chromium\.js$/.test(f)).map(rec),
 path.join(ROOT,'tests/staging-clicks/g6-p3-kuyiyuk.spec.js')];
test('the detector rejects INSERT/UPDATE/DELETE outside identity tables and accepts identity ones',()=>{
 expect(()=>assertStageSqlWritesIdentityOnly('s.js',"q('INSERT INTO orders (id) VALUES (1)')")).toThrow('G6_STAGE_SQL_WRITE_OUTSIDE_IDENTITY_TABLES');
 expect(()=>assertStageSqlWritesIdentityOnly('s.js',"q('UPDATE purchase_orders SET status=$1')")).toThrow('purchase_orders');
 expect(()=>assertStageSqlWritesIdentityOnly('s.js',"q('DELETE FROM public.scans WHERE id=1')")).toThrow('scans');
 expect(assertStageSqlWritesIdentityOnly('s.js',"q('INSERT INTO otp_codes(phone) VALUES ($1)')")).toBe(true);
 expect(assertStageSqlWritesIdentityOnly('s.js',"// UPDATE orders SET x=1\nq('SELECT 1')")).toBe(true);
});
test('no G6 step script or p3 spec writes SQL outside the identity tables',()=>{
 for(const f of stepScripts())expect(assertStageSqlWritesIdentityOnly(f)).toBe(true);
});
test('identity writes of the three real-actor scripts come only from canonical writers and stay within the allowlist',()=>{
 for(const [script,tables] of Object.entries(IDENTITY_WRITES_BY_SCRIPT)){
  for(const t of tables)expect(IDENTITY_TABLES).toContain(t);
  expect(fs.existsSync(rec(script))).toBe(true);
 }
 // Writers canoniques effectivement appelés : leurs tables écrites doivent rester dans l'allowlist.
 const writers=['services/g6-staging-buyer-identity-guard.js','scripts/recette/staging-e2e-provision.js'];
 for(const w of writers){
  const t=sqlWriteTables(fs.readFileSync(path.join(ROOT,w),'utf8'));
  for(const x of t)if(x!=='sourcing_global_access_grants')expect(IDENTITY_TABLES).toContain(x);
 }
 expect(fs.readFileSync(rec('g6-p2-buyer-order-real-chromium.js'),'utf8')).toMatch(/preseedG6BuyerOtp/);
 expect(fs.readFileSync(rec('g6-a-relay-cash-real-chromium.js'),'utf8')).toMatch(/addMembership/);
});
test('the p3 spec is covered by the gesture guard (no raw click/fill/selectOption)',()=>{
 const spec=path.join(ROOT,'tests/staging-clicks/g6-p3-kuyiyuk.spec.js');
 expect(assertGestureSourceUsesHelper(spec)).toBe(true);
 expect(()=>assertGestureSourceUsesHelper('x.js',"await page.locator('a').click();")).toThrow('G6_GESTURE_OUTSIDE_HELPER_FORBIDDEN');
 expect(()=>assertGestureSourceUsesHelper('x.js',"await page.reload({waitUntil:'load'});")).not.toThrow();
});
