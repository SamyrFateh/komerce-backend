/** @komerce-arch-lite
 * @role g6-canonical-human-gestures
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Unified Chromium gestures: wait for render-ready, relocate, retry once ONLY if no mutation left, never re-click after a mutation.
 * @impact-areas staging-only
 */
'use strict';
const SAFE=new Set(['GET','HEAD','OPTIONS']);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class GestureBlockedError extends Error{
 constructor(code,proof){
  super(code+' '+JSON.stringify(proof));
  this.name='GestureBlockedError';this.verdict='BLOCKED';this.proof=proof;
 }
}
function resolve(page,target){
 return {loc:typeof target==='string'?page.locator(target):target};
}
// Prefer the cockpit's own signal; otherwise require two identical DOM samples.
async function waitReady(page,{timeout=8000,interval=120}={}){
 const sample=()=>page.evaluate(()=>{
  const e=document.querySelector('[data-render-epoch],[data-hlc-ready]');
  return {signal:!!e,ready:!e||e.getAttribute('data-hlc-ready')!=='false',
   epoch:e?e.getAttribute('data-render-epoch'):null,
   size:document.body?document.body.getElementsByTagName('*').length:0};
 }).catch(()=>null);
 const end=Date.now()+timeout;let prev=null;
 while(Date.now()<end){
  const cur=await sample();
  if(cur&&cur.ready&&prev&&prev.ready&&cur.epoch===prev.epoch&&cur.size===prev.size)return true;
  prev=cur;await sleep(interval);
 }
 return false;
}
async function gesture(page,target,{action,args=[],mutation=null,readyTimeout,verify=null}){
 const pg=page||target.page(),label=typeof target==='string'?target:'<locator>';
 const mutations=[];
 const onRequest=req=>{
  try{const u=new URL(req.url());
   if(!SAFE.has(req.method())&&u.pathname.startsWith('/api'))mutations.push({method:req.method(),path:u.pathname});
  }catch(_){}
 };
 pg.on('request',onRequest);
 let response=null;
 if(mutation)response=pg.waitForResponse(r=>{
   try{const u=new URL(r.url());
    return r.request().method()===(mutation.method||'POST')&&
     (mutation.pathRe?mutation.pathRe.test(u.pathname):u.pathname===mutation.path);
   }catch(_){return false}
  },{timeout:mutation.timeout||30000}).catch(()=>null);
 let attempts=0,cause=null;
 try{
  for(;attempts<2;){
   attempts++;
   await waitReady(pg,{timeout:readyTimeout});
   try{
    const {loc}=resolve(pg,target);                   // relocated from the data-* selector on every attempt
    await loc[action](...args);
    if(verify)await verify(loc);
    cause=null;break;
   }catch(e){
    cause=e;
    // Any mutation already sent (even if the gesture threw): never gesture again.
    if(mutations.length||attempts>=2)break;
   }
  }
  const proof={action,selector:label,attempts,mutations,
   cause:cause?String(cause.message||cause):null};
  if(cause&&mutations.length)throw new GestureBlockedError('G6_GESTURE_BLOCKED_MUTATION_SENT',proof);
  if(cause)throw cause;
  let seen=null;
  if(mutation){
   const res=await response;
   if(!res)throw new GestureBlockedError('G6_GESTURE_BLOCKED_NO_RESPONSE',proof);
   seen={status:res.status(),method:res.request().method(),path:new URL(res.url()).pathname};
   const ok=mutation.statuses||[200,201];
   if(!ok.includes(seen.status))throw new GestureBlockedError('G6_GESTURE_BLOCKED_HTTP_'+seen.status,{...proof,response:seen});
  }
  return {attempts,mutations,response:seen};
 }finally{pg.off('request',onRequest);}
}
// Navigation GET (pas une mutation) : une navigation client encore en cours (redirection après login)
// peut annuler page.goto (net::ERR_ABORTED). On attend la fin du chargement ; si l'URL visée est atteinte,
// c'est accepté, sinon une seule nouvelle navigation.
async function humanGoto(page,url,opts={}){
 const target=u=>{try{const a=new URL(u),b=new URL(url,a.origin);return a.pathname===b.pathname&&a.search===b.search;}catch(_){return false;}};
 for(let i=0;i<2;i++){
  try{return await page.goto(url,opts);}
  catch(err){
   if(!/ERR_ABORTED|frame was detached|interrupted by another navigation/i.test(String(err&&err.message)))throw err;
   await page.waitForLoadState(opts.waitUntil==='load'?'load':'domcontentloaded',{timeout:15000}).catch(()=>{});
   if(target(page.url()))return null;
   if(i===1)throw err;
  }
 }
}
const humanClick=(page,target,{mutation=null,...opts}={})=>
 gesture(page,target,{action:'click',args:[opts],mutation});
// The value is never logged; it is only compared after fill.
const humanFill=(page,target,value,{mutation=null,...opts}={})=>
 gesture(page,target,{action:'fill',args:[value,opts],mutation,
  verify:async loc=>{let v;try{v=await loc.inputValue({timeout:2000});}catch(_){return;}
   // Les champs à format d'affichage (téléphone « 32 12 345 ») ajoutent des espaces : comparaison hors espaces.
   const n=x=>String(x).replace(/\s+/g,'');
   if(n(v)!==n(value))throw Error('G6_GESTURE_FILL_VALUE_NOT_STABLE');}});
const humanSelect=(page,target,value,{mutation=null,...opts}={})=>
 gesture(page,target,{action:'selectOption',args:[value,opts],mutation});
const humanCheck=(page,target,{mutation=null,...opts}={})=>
 gesture(page,target,{action:'check',args:[opts],mutation});
const humanPress=(page,target,key,{mutation=null,...opts}={})=>
 gesture(page,target,{action:'press',args:[key,opts],mutation});
// EXCEPTION EXPLICITE au « pas de reclic » : réservée au scénario négatif N07 (double clic volontaire sur
// Commander). C'est un seul geste natif dblclick (deux clics rapprochés), jamais une relance après erreur.
// Aucune retentative : le geste est tenté une fois ; il n'est pas utilisable par les scénarios nominaux.
async function humanDoubleClickOnce(page,target,{allowedFor,scenario=process.env.G6_CANONICAL_SCENARIO,...opts}={}){
 if(allowedFor!=='N07'||scenario!=='N07')throw Error('G6_DOUBLE_CLICK_EXCEPTION_N07_ONLY');
 const pg=page||target.page(),mutations=[];
 const onRequest=req=>{try{const u=new URL(req.url());
  if(!SAFE.has(req.method())&&u.pathname.startsWith('/api'))mutations.push({method:req.method(),path:u.pathname});}catch(_){}};
 pg.on('request',onRequest);
 try{
  await waitReady(pg,{timeout:opts.readyTimeout});
  const {loc}=resolve(pg,target);
  await loc.dblclick(opts.timeout?{timeout:opts.timeout}:{});
  return {attempts:1,mutations,double_click:true};
 }finally{pg.off('request',onRequest);}
}
module.exports={humanGoto,humanClick,humanFill,humanSelect,humanCheck,humanPress,humanDoubleClickOnce,waitReady,GestureBlockedError};
