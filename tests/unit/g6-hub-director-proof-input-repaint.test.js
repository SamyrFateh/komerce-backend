/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=path.resolve(__dirname,'../../scripts/recette/g6-hub-commitment-chromium.js');
describe('G6 director engagement keeps a real editable Chromium proof field',()=>{
 test('source compiles and requires real UI gestures for proof reference',()=>{
  const code=fs.readFileSync(src,'utf8');
  expect(()=>new vm.Script(code,{filename:src})).not.toThrow();
  expect(code).toContain('G6_COMMITMENT_PROOF_FIELD_NOT_EDITABLE');
  expect(code).toContain('humanFill(null,proofField,proof,{timeout:6500})');
  expect(code).toContain('humanClick(null,proofField,{timeout:6500})');
  expect(code).toContain("director.page.keyboard.type(proof,{delay:0})");
  expect(code).toContain('proofField.inputValue()===proof');
  expect(code).toContain('G6_COMMITMENT_REAL_CHROMIUM_PROOF_INPUT_BLOCKED');
  expect(code).toContain('G6_COMMITMENT_PG_AUTHORIZATION_OR_PDF_MISMATCH');
  expect(code).not.toContain('proofField.evaluate(el=>el.value');
  expect(code).not.toContain('proofField.fill(proof,{force:true})');
 });
});