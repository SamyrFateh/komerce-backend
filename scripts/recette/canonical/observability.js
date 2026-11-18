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
function observe(browser,outDir){
 fs.mkdirSync(outDir,{recursive:true});
 const open=new Map(),log=[];let n=0;
 const orig=browser.newContext.bind(browser);
 const stop=async(ctx,id,tmp)=>{
  if(!open.has(ctx))return;open.delete(ctx);
  for(const [i,p] of ctx.pages().entries())
   await p.screenshot({path:path.join(outDir,'failure-ctx'+id+'-p'+i+'.png'),fullPage:true,timeout:5000}).catch(()=>{});
  await ctx.tracing.stop({path:path.join(outDir,'trace-ctx'+id+'.zip')}).catch(()=>{});
 };
 browser.newContext=async(...a)=>{
  const ctx=await orig(...a),id=++n;
  await ctx.tracing.start({screenshots:true,snapshots:true,sources:false}).catch(()=>{});
  open.set(ctx,id);
  ctx.on('page',page=>{
   page.on('response',res=>{
    try{const u=new URL(res.url());
     if(u.pathname.startsWith('/api'))log.push({ctx:id,method:res.request().method(),path:redact(u.pathname),status:res.status()});
    }catch(_){}
   });
   page.on('requestfailed',req=>{
    try{const u=new URL(req.url());
     if(u.pathname.startsWith('/api'))log.push({ctx:id,method:req.method(),path:redact(u.pathname),status:'FAILED'});
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
module.exports={observe,fullError,redact};
