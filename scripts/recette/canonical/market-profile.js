/** @komerce-arch-lite
 * @role g6-canonical-market-profile
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Single source for the G6 dynamic runner market parameters (G6_TARGET_MARKET in KM|CM|CG).
 * @impact-areas staging-only
 */
'use strict';
const PROFILES=Object.freeze({
 KM:Object.freeze({code:'KM',label:'KM · Comores',dial:'+269',currency:'KMF'}),
 CM:Object.freeze({code:'CM',label:'CM · Cameroun',dial:'+237',currency:'XAF'}),
 CG:Object.freeze({code:'CG',label:'CG · Congo',dial:'+242',currency:'XAF'})
});
// Unset keeps the historical KM behaviour; any other unknown value is refused.
function marketProfile(env=process.env){
 const raw=env.G6_TARGET_MARKET;
 const code=raw===undefined||raw===''?'KM':String(raw).trim().toUpperCase();
 if(!Object.hasOwn(PROFILES,code))throw Error('G6_UNSUPPORTED_MARKET');
 return PROFILES[code];
}
// Option du sélecteur de marché de l'admin : libellés issus de la base (« CG · République du Congo »…),
// donc reconnue par son code (valeur ou préfixe « CG · »), jamais par un libellé figé.
async function marketOption(profile,select){
 const opts=await select.locator('option').evaluateAll(es=>es.map(e=>({v:e.value||'',t:(e.textContent||'').trim()})));
 const c=profile.code;
 const o=opts.find(x=>x.v.toUpperCase()===c)||opts.find(x=>x.t.startsWith(c+' ·')||x.t.startsWith(c+' -')||x.t.startsWith(c+' '));
 if(!o)throw Error('G6_MARKET_OPTION_MISSING_'+c);
 return {value:o.v};
}
module.exports={marketProfile,marketOption,PROFILES};
