/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {observe,fullError,redact}=require('../../scripts/recette/canonical/observability');
test('fullError keeps the whole call log and redacts secrets, phones and OTP',()=>{
 const log='x'.repeat(2000)+'\nwaiting for element to be visible, enabled and stable\nCookie: sid=abc +269 321 45 67 otp 123456';
 const out=fullError(new Error(log));
 expect(out.length).toBeGreaterThan(2000);
 expect(out).toContain('visible, enabled and stable');
 expect(out).not.toMatch(/sid=abc|321 45 67|123456/);
 expect(redact('/api/x?token=abcdef')).toContain('[REDACTED]');
});
test('observe journals /api method/path/status only; trace kept on failure, dropped on success',async()=>{
 for(const failed of [true,false]){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'g6obs-'));
  const handlers={};
  const page={on:(e,h)=>{handlers[e]=h},screenshot:async({path:p})=>fs.writeFileSync(p,'png')};
  const ctx={tracing:{start:async()=>{},stop:async({path:p})=>fs.writeFileSync(p,'zip')},
   pages:()=>[page],on:(e,h)=>h(page),close:async()=>{}};
  const browser={newContext:async()=>ctx};
  const obs=observe(browser,dir);
  const c=await browser.newContext();
  handlers.response({url:()=> 'https://s.invalid/api/orders/1?phone=123456789',status:()=>201,request:()=>({method:()=> 'POST'})});
  handlers.response({url:()=> 'https://s.invalid/static/a.js',status:()=>200,request:()=>({method:()=> 'GET'})});
  await c.close();await obs.finish(failed);
  const net=fs.readFileSync(path.join(dir,'network.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  expect(net).toEqual([{ctx:1,method:'POST',path:'/api/orders/1',status:201}]);
  const files=fs.readdirSync(dir);
  expect(files.includes('trace-ctx1.zip')).toBe(failed);
  expect(files.includes('failure-ctx1-p0.png')).toBe(failed);
 }
});
