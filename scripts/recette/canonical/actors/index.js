/** @komerce-arch-lite
 * @role g6-canonical-chromium-actors
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose One browser session per role and only visible Chromium gestures count as business actions.
 * @impact-areas staging-only
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const selectors=require('./selectors');
const ROLES=new Set(Object.keys(selectors));
const SENSITIVE=Object.freeze(['input[type=password]','[data-pickup-code-input]','.k-pickup-code-output']);
class ActorPool{
 constructor({browser,baseURL,outputDir}) {
  if(!browser||!/^https:\/\//.test(baseURL||'')||!outputDir)throw Error('G6_ACTOR_POOL_CONFIG_INVALID');
  this.browser=browser;this.baseURL=baseURL;this.outputDir=outputDir;this.pool=new Map();
 }
 async get(role){
  if(!ROLES.has(role))throw Error('G6_ACTOR_ROLE_UNKNOWN_'+role);
  if(this.pool.has(role))return this.pool.get(role);
  const context=await this.browser.newContext({baseURL:this.baseURL,viewport:{width:1440,height:900}});
  const page=await context.newPage(),actor=new ChromiumActor({role,context,page,outputDir:this.outputDir});
  this.pool.set(role,actor);return actor;
 }
 async close(){for(const a of this.pool.values())await a.context.close();this.pool.clear()}
}
class ChromiumActor{
 constructor({role,context,page,outputDir}){
  if(!ROLES.has(role))throw Error('G6_ACTOR_ROLE_UNKNOWN_'+role);
  this.role=role;this.context=context;this.page=page;this.outputDir=outputDir;
  this.selectors=selectors[role];
 }
 async capture(label){
  const pathname=path.join(this.outputDir,this.role,label+'.png');
  fs.mkdirSync(path.dirname(pathname),{recursive:true});
  await this.page.screenshot({path:pathname,fullPage:true,
   mask:SENSITIVE.map(s=>this.page.locator(s)),maskColor:'#000000'});
  return pathname;
 }
 async gesture({id,selector,action,requestPath,method='POST',value,expectStatuses=[200,201]}){
  if(!/^[A-Z][A-Z0-9_]*$/.test(id||'')||!selector||!['click','fill','selectOption'].includes(action)||
   !requestPath?.startsWith('/')||!['POST','PUT','PATCH','DELETE'].includes(method))
   throw Error('G6_CHROMIUM_GESTURE_CONTRACT_INVALID');
  const target=this.page.locator(selector);
  if(await target.count()!==1||!await target.isVisible())throw Error('SCREEN_MISSING_'+id);
  const before=await this.capture(id+'-before');
  // No HTTP/PG business write here: only the visible user's native UI triggers its request.
  const pending=this.page.waitForResponse(res=>{
   try{return new URL(res.url()).pathname===requestPath&&res.request().method()===method}catch(_){return false}
  },{timeout:30000});
  if(action==='click')await target.click();
  else if(action==='fill')await target.fill(String(value??''));
  else await target.selectOption(String(value??''));
  const response=await pending;
  const after=await this.capture(id+'-after');
  const http=response.status();
  if(http===429)throw Error('G6_RATE_LIMIT_429_NOT_PROVEN');
  if(!expectStatuses.includes(http))throw Error('G6_CHROMIUM_UNEXPECTED_HTTP_'+http);
  return {step:id,role:this.role,page:new URL(this.page.url()).pathname,
   selector,action,screenshots:{before,after},
   observed_request:{method,path:requestPath,status:http}};
 }
 async declareShortage(){
  throw Error('SCREEN_MISSING_RELAY_SHORTAGE_UNBOUND');
 }
}
module.exports={ActorPool,ChromiumActor,ROLES,SENSITIVE};
