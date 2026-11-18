/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const file=path.resolve(__dirname,'../../scripts/recette/g6-p2-buyer-order-real-chromium.js');
describe('G6 buyer OTP never silently bypasses Chromium form validation',()=>{
 test('script compiles and records the real UI submit eligibility before a request',()=>{
  const s=fs.readFileSync(file,'utf8');
  expect(()=>new vm.Script(s,{filename:file})).not.toThrow();
  const eligibility=s.indexOf("record('OTP_UI_FORM_PRECHECK'");
  const click=s.indexOf("await page.locator('#k-id-phone-cta').click()");
  expect(eligibility).toBeGreaterThan(0);
  expect(click).toBeGreaterThan(eligibility);
  expect(s).toContain('G6_OTP_CHROMIUM_FORM_NOT_SUBMITTABLE');
  expect(s).toContain(String.raw`replace(/\D/g,'')`);
  expect(s).not.toContain(String.raw`replace(/\\D/g,'')`);
  expect('326 62 88'.replace(/\D/g,'')).toBe('3266288');
  expect(s).toContain('G6_OTP_REQUEST_WITHOUT_RESPONSE');
  expect(s).toContain('G6_OTP_UI_CLICK_DID_NOT_SEND_REQUEST');
 });
 test('form preflight and screenshots never log OTP code, phone digits or bypass action',()=>{
  const s=fs.readFileSync(file,'utf8');
  const start=s.indexOf("const eligibility=await page.locator('#k-id-step-phone')");
  const end=s.indexOf("  const otpPath=",start);
  const block=s.slice(start,end);
  expect(block).toContain("phone_length");
  expect(block).not.toContain('phoneValue');
  expect(block).not.toContain('phoneData');
  expect(block).not.toContain('.evaluate(el => el.click');
  expect(block).not.toContain('page.request.post');
 });
});
