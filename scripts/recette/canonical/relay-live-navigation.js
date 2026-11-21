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
async function openRelayLive(page,{selector,timeout=30000,execute=false,entry=execute?'execute':null}={}){
 if(!page||typeof page.goto!=='function'||typeof selector!=='string'||!selector)
  throw Error('G6_RELAY_NAVIGATION_ARGUMENTS_INVALID');
 if(!isRelayPage(page.url())){
  try{
   // This canonical path is where the role-based redirect lands. Starting
   // another query-string navigation caused Playwright to be interrupted.
   await page.goto('/admin/relais-live',{waitUntil:'commit',timeout:20000});
  }catch(error){
   // ERR_ABORTED : même course que la redirection post-login (#4562) ; on vérifie ensuite l'URL atteinte.
   if(!/is interrupted by another navigation|ERR_ABORTED|frame was detached/i.test(String(error?.message||error)))
    throw error;
   // Never accept an interrupted navigation unless the browser itself reaches
   // the exact canonical staging cockpit without any API or DOM bypass.
   await page.waitForURL(u=>u.origin===BASE&&u.pathname==='/admin/relais-live',{timeout:20000,waitUntil:'commit'});
  }
 }
 await page.waitForURL(u=>u.origin===BASE&&u.pathname==='/admin/relais-live',{timeout:20000,waitUntil:'commit'});
 await page.waitForLoadState('domcontentloaded',{timeout:20000});
 // Réception : atelier d'exécution (?view=execute) ; retrait : comptoir des remises (?view=remises).
 // L'atterrissage du rôle est le Flux Relais : on y entre comme un humain, par le lien de l'écran.
 const want=entry&&ENTRIES[entry];
 if(entry&&!want)throw Error('G6_RELAY_NAVIGATION_ARGUMENTS_INVALID');
 if(want&&new URL(page.url()).searchParams.get('view')!==want.view){
  const {humanClick}=require('./actors/human-gestures');
  await humanClick(null,page.locator('a',{hasText:want.link}).first());
  await page.waitForURL(u=>u.origin===BASE&&u.pathname==='/admin/relais-live'&&u.searchParams.get('view')===want.view,{timeout:20000,waitUntil:'commit'});
  await page.waitForLoadState('domcontentloaded',{timeout:20000});
 }
 const target=page.locator(selector);
 await target.waitFor({state:'visible',timeout});
 if(!isRelayPage(page.url()))throw Error('G6_RELAY_NAVIGATION_DESTINATION_DRIFT');
 return target;
}
module.exports={openRelayLive,isRelayPage};
