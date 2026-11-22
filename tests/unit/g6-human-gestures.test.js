/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {humanClick,humanFill,GestureBlockedError}=require('../../scripts/recette/canonical/actors/human-gestures');
const {assertTraceStartsAfterAuth,assertGestureSourceUsesHelper,validateChromiumScriptSources}=require('../../scripts/recette/canonical/chromium-policy');
function fakePage({samples,locators}){
 const h={};let i=0;
 const page={
  on:(e,f)=>{(h[e]=h[e]||[]).push(f)},off:(e,f)=>{h[e]=(h[e]||[]).filter(x=>x!==f)},
  evaluate:async()=>samples[Math.min(i++,samples.length-1)],
  locator:jest.fn(()=>locators.shift()),
  emit:(e,x)=>(h[e]||[]).forEach(f=>f(x))
 };
 return page;
}
const stable={signal:true,ready:true,epoch:'3',size:10};
const req=(m,p)=>({method:()=>m,url:()=> 'https://s.invalid'+p});
test('no new attempt after a mutation request left: BLOCKED with proof',async()=>{
 const click=jest.fn();const page=fakePage({samples:[stable],locators:[{click},{click}]});
 click.mockImplementationOnce(async()=>{page.emit('request',req('POST','/api/purchasing/po/1/submit'));throw Error('element detached');});
 const err=await humanClick(page,'[data-x]').catch(e=>e);
 expect(err).toBeInstanceOf(GestureBlockedError);
 expect(err.verdict).toBe('BLOCKED');
 expect(err.proof.mutations).toEqual([{method:'POST',path:'/api/purchasing/po/1/submit'}]);
 expect(click).toHaveBeenCalledTimes(1);
});
test('re-locates after a rerender and retries once when nothing was sent',async()=>{
 const stale={click:jest.fn(async()=>{throw Error('detached')})},fresh={click:jest.fn(async()=>{})};
 const page=fakePage({samples:[stable],locators:[stale,fresh]});
 const r=await humanClick(page,'[data-hlc-action="a"]');
 expect(r.attempts).toBe(2);
 expect(page.locator).toHaveBeenCalledTimes(2);
 expect(fresh.click).toHaveBeenCalledTimes(1);
});
test('only one retry, then the original error is raised',async()=>{
 const mk=()=>({click:jest.fn(async()=>{throw Error('boom')})});
 const a=mk(),b=mk(),c=mk();
 const page=fakePage({samples:[stable],locators:[a,b,c]});
 await expect(humanClick(page,'[data-x]')).rejects.toThrow('boom');
 expect(c.click).not.toHaveBeenCalled();
});
test('waits for data-hlc-ready before gesturing',async()=>{
 const click=jest.fn(async()=>{});
 const page=fakePage({samples:[{...stable,ready:false},{...stable,ready:false},{...stable,epoch:'4'},{...stable,epoch:'4'}],locators:[{click}]});
 await humanClick(page,'[data-x]');
 expect(click).toHaveBeenCalledTimes(1);
});
test('HTTP confirmation is observed in the browser; unexpected status is BLOCKED, no re-click',async()=>{
 const click=jest.fn(),fill=jest.fn();
 const page=fakePage({samples:[stable],locators:[{click}]});
 page.waitForResponse=()=>Promise.resolve({status:()=>500,request:()=>({method:()=> 'POST'}),url:()=> 'https://s.invalid/api/x'});
 await expect(humanClick(page,'[data-x]',{mutation:{method:'POST',path:'/api/x'}})).rejects.toThrow('G6_GESTURE_BLOCKED_HTTP_500');
 expect(click).toHaveBeenCalledTimes(1);
 const inp={fill,inputValue:async()=> 'other'};
 const p2=fakePage({samples:[stable],locators:[inp,inp]});
 await expect(humanFill(p2,'[data-y]','value')).rejects.toThrow('G6_GESTURE_FILL_VALUE_NOT_STABLE');
});
test('fill accepts display formatting (spaces) but still rejects a different value',async()=>{
 const inp={fill:jest.fn(),inputValue:async()=> '32 12 345'};
 await expect(humanFill(fakePage({samples:[stable],locators:[inp,inp]}),'[data-p]','3212345')).resolves.toBeDefined();
 const bad={fill:jest.fn(),inputValue:async()=> '32 12 346'};
 await expect(humanFill(fakePage({samples:[stable],locators:[bad,bad]}),'[data-p]','3212345')).rejects.toThrow('G6_GESTURE_FILL_VALUE_NOT_STABLE');
});
test('humanGoto: aborted navigation accepted only if target URL reached, otherwise one retry',async()=>{
 const {humanGoto}=require('../../scripts/recette/canonical/actors/human-gestures');
 let url='https://s.invalid/admin/hub-live?view=execute',calls=0;
 const page={goto:async()=>{calls++;throw Error('net::ERR_ABORTED');},waitForLoadState:async()=>{},url:()=>url};
 await expect(humanGoto(page,'/admin/hub-live?view=execute')).resolves.toBeNull();
 expect(calls).toBe(1);
 url='https://s.invalid/admin/other';calls=0;
 await expect(humanGoto(page,'/admin/hub-live?view=execute')).rejects.toThrow('ERR_ABORTED');
 expect(calls).toBe(2);
 const p2={goto:async()=>{throw Error('net::ERR_NAME_NOT_RESOLVED');},waitForLoadState:async()=>{},url:()=>url};
 await expect(humanGoto(p2,'/x')).rejects.toThrow('ERR_NAME_NOT_RESOLVED');
});
test('chromium-policy validates every discovered Chromium script (no fixed count)',()=>{
 expect(()=>assertGestureSourceUsesHelper('s.js',"await page.locator('#a').click();")).toThrow('G6_GESTURE_OUTSIDE_HELPER_FORBIDDEN');
 expect(()=>assertGestureSourceUsesHelper('s.js',"await x.fill('v');")).toThrow('G6_GESTURE_OUTSIDE_HELPER_FORBIDDEN');
 expect(assertGestureSourceUsesHelper('s.js',"// .click() in comment\nawait humanClick(page,'#a');")).toBe(true);
 const fs=require('node:fs'),path=require('node:path');
 const scripts=fs.readdirSync(path.join(__dirname,'../../scripts/recette'))
  .filter(file=>/^g6-.*chromium\\.js$/.test(file));
 expect(scripts.length).toBeGreaterThanOrEqual(39);
 expect(validateChromiumScriptSources()).toBe(scripts.length);
});
test('chromium-policy: trace may start only after authentication completes',()=>{
 expect(()=>assertTraceStartsAfterAuth('s.js',"const c=await b.newContext();await c.tracing.start({});")).toThrow('G6_TRACE_STARTED_OUTSIDE_HELPER');
 expect(()=>assertTraceStartsAfterAuth('s.js',"const c=await b.newContext();await startTraceAfterAuth(c);await page.waitForURL(u=>1);")).toThrow('G6_TRACE_BEFORE_AUTH_COMPLETE');
 expect(()=>assertTraceStartsAfterAuth('s.js',"const c=await b.newContext();await page.waitForURL(u=>1);")).toThrow('G6_TRACE_AFTER_AUTH_MISSING');
 expect(assertTraceStartsAfterAuth('s.js',"const c=await b.newContext();await page.waitForURL(u=>1);await startTraceAfterAuth(c);")).toBe(true);
});
