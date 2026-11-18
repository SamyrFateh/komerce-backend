/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,
 '../../scripts/recette/g6-canonical-forwarder-chromium.js'),'utf8');
describe('G6 customs local delivery — repaint can close details without losing the visible UI',()=>{
 test('the shared Chromium forwarder task compiles and reopens the real summary',()=>{
  expect(()=>new vm.Script(source)).not.toThrow();
  expect(source).toContain("G6_JOURNEY_SUBMIT_HIDDEN_AFTER_REAL_UI_DISCLOSURE");
  expect(source).toContain("G6_JOURNEY_DETAILS_NOT_OPEN");
  expect(source).toContain("item.locator('summary').click({timeout:8000})");
  expect(source).toContain("submit.waitFor({state:'visible',timeout:5000})");
  expect(source).not.toContain("submit.click({force:true})");
 });
 test('the local delivery step still uses the shared visible task and PG oracle',()=>{
  const script=fs.readFileSync(path.resolve(__dirname,
   '../../scripts/recette/g6-canonical-customs-chromium.js'),'utf8');
  expect(script).toContain("await task(actor.page,title,tab)");
  expect(script).toContain("'Confirmer : Transport local'");
  expect(script).toContain("eventProof(last,now,'stage_changed'");
 });
});
