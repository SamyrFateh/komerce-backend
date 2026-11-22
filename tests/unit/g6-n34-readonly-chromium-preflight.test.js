/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {chooseSupplierFixtures,hasExactSupplierOptions}=require('../../scripts/recette/canonical/n34-screen-preflight');
const fs=require('node:fs'),path=require('node:path');
const HUB='11111111-1111-4111-8111-111111111111',REAL='22222222-2222-4222-8222-222222222222';
const hub={id:HUB,name:'Fournisseur central Hub',platform:'local',system_key:'central_hub',is_active:true,deleted_at:null};
const real={id:REAL,name:'Fournisseur réel',platform:'local',system_key:null,is_active:true,deleted_at:null};
describe('N34 read-only Chromium screen preflight: NEVER a BOUND certification',()=>{
 test('requires the unique system identity and a different real supplier',()=>{
  expect(chooseSupplierFixtures([real,hub])).toEqual({hub:{id:HUB,name:hub.name},real:{id:REAL,name:real.name,platform:'local'}});
  for(const invalid of [[],[real],[hub],[hub,hub,real],
    [{...hub,is_active:false},real],[hub,{...real,system_key:'central_hub'}],
    [hub,{...real,deleted_at:'today'}],[hub,{...real,is_active:false}]]){
   expect(()=>chooseSupplierFixtures(invalid)).toThrow(/G6_N34_/);
  }
 });
 test('selected UI options must bind exact ids and central Hub marker',()=>{
  const fixture=chooseSupplierFixtures([hub,real]);
  const good=[{id:HUB,key:'central_hub'},{id:REAL,key:''}];
  expect(hasExactSupplierOptions(good,fixture)).toBe(true);
  expect(hasExactSupplierOptions([{id:HUB,key:''},{id:REAL,key:''}],fixture)).toBe(false);
  expect(hasExactSupplierOptions([{id:HUB,key:'central_hub'}],fixture)).toBe(false);
  expect(hasExactSupplierOptions([...good,{id:HUB,key:'central_hub'}],fixture)).toBe(false);
 });
 test('probe uses read-only PostgreSQL and never submits a supplier import',()=>{
  const script=fs.readFileSync(path.join(__dirname,'../../scripts/recette/g6-n34-readonly-chromium-preflight.js'),'utf8');
  expect(script).toContain("default_transaction_read_only=on");
  expect(script).toContain("G6_N34_PREFLIGHT_ONLY");
  expect(script).toContain("await humanSelect(null,select,fixture.real.id)");
  expect(script).toContain("report.scenario_bound=false");
  expect(script).toContain("N34_UI_READONLY_PREFLIGHT_PASS_NOT_BOUND");
  expect(script).not.toMatch(/humanClick\([^\n]*submit-manual-import/);
  expect(script).not.toMatch(/page\.request\.(post|put|patch|delete)\(/);
  expect(script).not.toMatch(/\bdb\.query\(\s*['\`"]\s*(INSERT|UPDATE|DELETE|TRUNCATE)/i);
 });
});
