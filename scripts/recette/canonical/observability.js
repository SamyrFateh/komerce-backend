/** @komerce-arch-lite
 * @role g6-chromium-failure-observability
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Keep Playwright trace, screenshot, full error and /api network journal (method, path, status only) on failure.
 * @impact-areas staging-only
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
// Never keep secrets: long digit runs (phone/OTP), bearer tokens, cookies, jwt-like strings.
function redact(text){
 return String(text==null?'':text)
  .replace(/\b(bearer|authorization|cookie|set-cookie|token|password)\b\s*[:=]\s*\S+/gi,'$1=[REDACTED]')
  .replace(/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/g,'[JWT]')
  .replace(/\+?\d[\d ().-]{4,}\d/g,m=>m.replace(/\D/g,'').length>=6?'[DIGITS]':m);
}
// Full message including the Playwright call log; no truncation.
function fullError(e){return redact(e&&(e.stack&&String(e.stack).includes(String(e.message||''))?e.stack:e.message)||e||'UNKNOWN');}
const STATE=new WeakMap();
// Credentials/OTP are typed and POSTed before this call: never trace login, OTP or redirect.
async function startTraceAfterAuth(ctx){
 const s=STATE.get(ctx);if(!s)return false;
 if(s.traced){if(s.paused)await resumeTrace(ctx);return true;}
 await ctx.tracing.start({screenshots:true,snapshots:true,sources:false}).catch(()=>{});
 s.traced=true;return true;
}
// Around any re-login on the same context: drop the chunk, then restart after auth.
async function pauseTrace(ctx){
 const s=STATE.get(ctx);if(!s||!s.traced||s.paused)return;
 await ctx.tracing.stopChunk().catch(()=>{});s.paused=true;
}
async function resumeTrace(ctx){
 const s=STATE.get(ctx);if(!s||!s.traced||!s.paused)return;
 await ctx.tracing.startChunk().catch(()=>{});s.paused=false;
}
function observe(browser,outDir){
 fs.mkdirSync(outDir,{recursive:true});
 const open=new Map(),log=[];let n=0;
 const AUTH=/^\/api\/auth(\/|$)/;
 const orig=browser.newContext.bind(browser);
 const stop=async(ctx,id,tmp)=>{
  if(!open.has(ctx))return;open.delete(ctx);
  for(const [i,p] of ctx.pages().entries())
   await p.screenshot({path:path.join(outDir,'failure-ctx'+id+'-p'+i+'.png'),fullPage:true,timeout:5000}).catch(()=>{});
  if(STATE.get(ctx)?.traced)await ctx.tracing.stop({path:path.join(outDir,'trace-ctx'+id+'.zip')}).catch(()=>{});
 };
 browser.newContext=async(...a)=>{
  const ctx=await orig(...a),id=++n;
  STATE.set(ctx,{traced:false,paused:false}); // trace starts only after authentication (startTraceAfterAuth)
  open.set(ctx,id);
  ctx.on('page',page=>{
   page.on('response',res=>{
    try{const u=new URL(res.url());
     if(u.pathname.startsWith('/api')&&!AUTH.test(u.pathname))log.push({ctx:id,method:res.request().method(),path:redact(u.pathname),status:res.status()});
    }catch(_){}
   });
   page.on('requestfailed',req=>{
    try{const u=new URL(req.url());
     if(u.pathname.startsWith('/api')&&!AUTH.test(u.pathname))log.push({ctx:id,method:req.method(),path:redact(u.pathname),status:'FAILED'});
    }catch(_){}
   });
  });
  const close=ctx.close.bind(ctx);
  ctx.close=async(...x)=>{await stop(ctx,id);return close(...x);};
  return ctx;
 };
 return {
  async finish(failed){
   for(const ctx of [...open.keys()])await stop(ctx,open.get(ctx));
   fs.writeFileSync(path.join(outDir,'network.jsonl'),log.map(x=>JSON.stringify(x)).join('\n')+(log.length?'\n':''));
   if(!failed)for(const f of fs.readdirSync(outDir))
    if(/^(trace-ctx\d+\.zip|failure-ctx\d+-p\d+\.png)$/.test(f))fs.rmSync(path.join(outDir,f),{force:true});
  }
 };
}
module.exports={observe,fullError,redact,startTraceAfterAuth,pauseTrace,resumeTrace};
