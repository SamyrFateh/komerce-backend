/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const file=path.resolve(__dirname,'../../scripts/recette/g6-hub-vendor-readiness-chromium.js');
describe('G6 supplier boundary: stage-only simulated manual channel',()=>{
 test('readiness requires one staging-only other option, not external contact channels',()=>{
  const source=fs.readFileSync(file,'utf8');
  expect(source).toContain("choices.filter(x=>x==='other').length===1");
  expect(source).not.toContain("['email','whatsapp','phone','api','other'].every");
  expect(source).toContain("external_send_form_not_submitted:true");
  expect(source).toContain("G6_VENDOR_READONLY_STATE_MUTATED");
  expect(source).toContain("G6_VENDOR_UNEXPECTED_BROWSER_WRITE");
 });
});