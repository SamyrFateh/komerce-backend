/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ROOT=path.resolve(__dirname,'../..');
const scripts=[
 'scripts/recette/g6-hub-receiving-chromium.js',
 'scripts/recette/g6-hub-receiving-readback.js',
 'scripts/recette/g6-hub-customer-bag-chromium.js',
 'scripts/recette/g6-hub-kom-box-chromium.js'
];
describe('G6 physical Hub dynamic proof refactor: syntax and fail-closed boundaries',()=>{
 test.each(scripts)('%s compiles and retains staging owner and dynamic identity guards',file=>{
  const source=fs.readFileSync(path.join(ROOT,file),'utf8');
  expect(()=>new vm.Script(source,{filename:file})).not.toThrow();
  expect(source).toContain('G6_DYNAMIC_FRESH_ORDER');
  expect(source).toContain("GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER");
  expect(source).toContain("KOMERCE_ENV==='staging'");
  expect(source).toContain("G6_CANONICAL_DB_FINGERPRINT");
  expect(source).toContain('KL1WGP6'); // historical compatibility only, not default dynamic identity
 });
 test('dynamic final mile is migrated but remains owner-only staging and NOT_PROVEN until certified',()=>{
  const entry=fs.readFileSync(path.join(ROOT,'scripts/recette/g6-dynamic-buyer-cash.js'),'utf8');
  expect(entry).toContain("'HUB_KOM_BOX'");
  expect(entry).toContain("'CLIENT_PICKUP'].includes(toStage)");
  expect(entry).toContain("G6_DYNAMIC_OWNER_STAGING_GUARD");
  expect(entry).toContain("full_chain_certified:false,production_permitted:false");
  expect(entry).toContain("bootstrapFreshM01({toStage,adapters})");
 });
});
