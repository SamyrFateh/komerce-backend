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
module.exports={marketProfile,PROFILES};
