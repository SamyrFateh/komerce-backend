/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const file=path.resolve(__dirname,'../../scripts/recette/g6-hub-vendor-readiness-chromium.js');
describe('G6 staging supplier-readiness UI repaint',()=>{
 test('real pointer then keyboard gesture, never direct browser API or forced click',()=>{
  const source=fs.readFileSync(file,'utf8');
  expect(()=>new vm.Script(source,{filename:file})).not.toThrow();
  expect(source).toContain('await humanClick(null,send,{timeout:7000})');
  expect(source).toContain("await humanPress(null,send,'Enter',{timeout:7000})");
  expect(source).toContain('G6_VENDOR_SEND_ACTION_DISABLED_ON_RETRY');
  expect(source).toContain('G6_VENDOR_READONLY_STATE_MUTATED');
  expect(source).toContain('external_send_form_not_submitted:true');
  expect(source).not.toContain('send.click({force:true})');
  expect(source).not.toContain("page.request.post");
 });
});