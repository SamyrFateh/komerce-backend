/** @komerce-arch-lite
 * @role g6-staging-relay-navigation
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose Open the real relay cockpit while tolerating its same-route post-login redirect.
 * @impact-areas staging-only
 */
'use strict';
const BASE='https://komerce-backend-production.up.railway.app';
function isRelayPage(url){
 try {const parsed=new URL(String(url));return parsed.origin===BASE&&parsed.pathname==='/admin/relais-live';}
 catch(_){return false}
}
const ENTRIES={execute:{view:'execute',link:'Atelier réception'},remises:{view:'remises',link:/^\s*Remises\s*$/}};
const isInterrupted=error=>/is interrupted by another navigation|ERR_ABORTED|frame was detached/i.test(String(error?.message||error));
// A post-login redirect can abort both goto() AND the first waitForURL().
// Never retry a mutation or navigate a second time: observe the browser's
// *actual* origin/path/view, with at most three bounded read-only waits.
async function waitForRelayURL(page,view=null){
 const matches=url=>{
  try {const u=new URL(String(url));return u.origin===BASE&&u.pathname==='/admin/relais-live'&&
    (!view||u.searchParams.get('view')===view);}
  catch(_){return false;}
 };
 for(let attempt=0;attempt<3;attempt++){
  if(matches(page.url()))return;
  try{
   await page.waitForURL(u=>matches(u),{timeout:20000,waitUntil:'commit'});
  }catch(error){
   if(!isInterrupted(error))throw error;
   if(matches(page.url()))return;
   if(attempt===2)throw Error('G6_RELAY_NAVIGATION_RACE_UNRESOLVED',{cause:error});
   continue;
  }
  if(matches(page.url()))return;
 }
 throw Error('G6_RELAY_NAVIGATION_DESTINATION_DRIFT');
}
async function openRelayLive(page,{selector,timeout=30000,execute=false,entry=execute?'execute':null}={}){
 if(!page||typeof page.goto!=='function'||typeof selector!=='string'||!selector)
  throw Error('G6_RELAY_NAVIGATION_ARGUMENTS_INVALID');
 if(!isRelayPage(page.url())){
  try{
   // This canonical path is where the role-based redirect lands. Starting
   // another query-string navigation caused Playwright to be interrupted.
   await page.goto('/admin/relais-live',{waitUntil:'commit',timeout:20000});
  }catch(error){
   // Only a navigation race is recoverable; the destination is still verified.
   if(!isInterrupted(error))throw error;
  }
 }
 await waitForRelayURL(page);
 await page.waitForLoadState('domcontentloaded',{timeout:20000});
 // Réception : atelier d'exécution (?view=execute) ; retrait : comptoir des remises (?view=remises).
 // L'atterrissage du rôle est le Flux Relais : on y entre comme un humain, par le lien de l'écran.
 const want=entry&&ENTRIES[entry];
 if(entry&&!want)throw Error('G6_RELAY_NAVIGATION_ARGUMENTS_INVALID');
 if(want&&new URL(page.url()).searchParams.get('view')!==want.view){
  const {humanClick}=require('./actors/human-gestures');
  await humanClick(null,page.locator('a',{hasText:want.link}).first());
  await waitForRelayURL(page,want.view);
  await page.waitForLoadState('domcontentloaded',{timeout:20000});
 }
 const target=page.locator(selector);
 await target.waitFor({state:'visible',timeout});
 if(!isRelayPage(page.url()))throw Error('G6_RELAY_NAVIGATION_DESTINATION_DRIFT');
 return target;
}
module.exports={openRelayLive,isRelayPage};
