/**
 * @komerce-arch-lite
 * @role staging-chromium-navigation-replay
 * @domain dashboard
 * @layer e2e
 * @owner backend-core
 * @purpose Distinguish an anchor that has not reappeared after reload from a real failed click.
 * @impact-areas dashboard, staging-only
 */
'use strict';

/**
 * Replays a link discovered in an asynchronously rendered canonical dashboard.
 * The discovery snapshot is a hint, not proof that the same anchor is already
 * present after the previous click triggers a fresh page navigation.
 *
 * No mutation: only a normal visible <a> click. Caller classifies the outcome.
 */
async function clickDiscoveredLink(page, {href,sourcePath,pathname,expectedDestination=null,
  reappearTimeout=5000,clickTimeout=5000,settleTimeout=8000}) {
  const anchor=page.locator('a[href='+JSON.stringify(href)+']').first();
  try {
    await anchor.waitFor({state:'visible',timeout:reappearTimeout});
  } catch(error) {
    return {kind:'LINK_MISSING_AFTER_REVISIT',source:sourcePath,href,
      actual:pathname(page.url()),detail:String(error.message||error).slice(0,170)};
  }
  try {
    await anchor.click({timeout:clickTimeout});
  } catch(error) {
    return {kind:'CLICK_FAILED_ON_VISIBLE_LINK',source:sourcePath,href,
      actual:pathname(page.url()),detail:String(error.message||error).slice(0,170)};
  }
  // Le clic peut transiter par / avant que le routeur de rôle n'atteigne
  // l'écran final. Attendre la destination autorisée connue, mais conserver
  // toute divergence finale comme FAIL (aucune correction artificielle d'URL).
  if(expectedDestination && pathname(page.url())!==expectedDestination){
    await page.waitForURL(url=>pathname(String(url))===expectedDestination,{timeout:settleTimeout})
      .catch(()=>{});
  } else if(pathname(page.url())===sourcePath){
    await page.waitForURL(url=>pathname(String(url))!==sourcePath,{timeout:settleTimeout})
      .catch(()=>{});
  }
  return {kind:'CLICKED',source:sourcePath,href,actual:pathname(page.url())};
}
module.exports={clickDiscoveredLink};
