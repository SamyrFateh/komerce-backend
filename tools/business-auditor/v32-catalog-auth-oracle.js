'use strict';
/** Independent physical SQL oracle. Never import application code or reuse a
 * service verdict as the expected state. Membership + market scope != role.
 */
const tool=s=>{throw Error('V32_ORACLE_TOOL_ERROR: '+s)};
const eq=(a,b)=>String(a)===String(b);
function productSame(a,b){
 return a&&b&&eq(a.id,b.id)&&a.is_active===b.is_active&&
  Number(a.price_kmf)===Number(b.price_kmf)&&a.name===b.name;
}
function shape(x){
 if(x?.contract!=='komerce-catalog-market-auth-physical/v32'||
  !['CATALOG','AUTH'].includes(x.mode)||
  !x.realOwnerCalled||!x.canonicalPg||!x.noExternalNetwork||
  x.noProductionAccess!==true||x.authenticatedHttpRouteTested!==false||
  !x.ids?.km?.id||!x.ids?.cm?.id||eq(x.ids.km.id,x.ids.cm.id)||
  !x.ids.user||!x.ids.product||!x.before||!Array.isArray(x.before.records)||
  !x.before.product)tool('source, independent markets or SQL observations absent');
}
const byMarket=(rows,id)=>rows.filter(r=>eq(r.market_id,id));
function catalogOracle(x){
 shape(x);
 if(x.mode!=='CATALOG'||!x.afterEnable?.product||!x.afterDisable?.product)
  tool('missing physical exposure observations');
 const s=[],ids=x.ids;
 if(x.before.records.length!==0||x.defaultKm!=='DISABLED'||x.defaultCm!=='DISABLED')
  s.push('CAT0_MISSING_EXPOSURE_DEFAULT_NOT_DISABLED');
 const km=byMarket(x.afterEnable.records,ids.km.id),cm=byMarket(x.afterEnable.records,ids.cm.id);
 if(!x.enabled?.allowed||!eq(x.enabled.marketId,ids.km.id)||
  km.length!==1||km[0].commercial_exposure!=='ENABLED'||
  !eq(km[0].decided_by,ids.user)||!x.kmVisible)
  s.push('CAT1_ENABLED_DECISION_NOT_PERSISTED_IN_TARGET_MARKET');
 if(cm.length!==0||x.cmVisible!==false||
  byMarket(x.afterDisable.records,ids.cm.id).length!==0||x.finalCm!=='DISABLED')
  s.push('CAT2_EXPOSURE_LEAKED_TO_ANOTHER_MARKET');
 const final=byMarket(x.afterDisable.records,ids.km.id);
 if(!x.disabled?.allowed||!eq(x.disabled.marketId,ids.km.id)||
  final.length!==1||final[0].commercial_exposure!=='DISABLED'||
  x.finalKm!=='DISABLED')
  s.push('CAT3_DISABLE_DID_NOT_REVERSE_MARKET_EXPOSURE');
 if(!productSame(x.before.product,x.afterEnable.product)||
  !productSame(x.before.product,x.afterDisable.product))
  s.push('CAT4_GLOBAL_CATALOG_PRODUCT_MUTATED_BY_MARKET_EXPOSURE');
 const audit=x.afterDisable.audits||[];
 if(audit.length!==2||!audit.every(a=>eq(a.market_id,ids.km.id)&&
  eq(a.actor_user_id,ids.user)&&a.capability==='catalog.expose')||
  audit[0].action!=='CATALOG_PRODUCT_EXPOSED'||
  audit[1].action!=='CATALOG_PRODUCT_HIDDEN')
  s.push('CAT5_MARKET_EXPOSURE_AUDIT_INCOMPLETE');
 return {contract:'komerce-independent-catalog-market-exposure-oracle/v32',
  signals:[...new Set(s)],violation:s.length>0,
  expectedMarket:ids.km.code,foreignMarket:ids.cm.code,
  activeExposureCount:km.length,foreignExposureCount:cm.length,
  afterDisableExposureCount:final.length,
  auditCount:audit.length,fullMarketplacePublicationCertified:false};
}
function authOracle(x){
 shape(x);
 if(x.mode!=='AUTH'||!x.afterDenied||!x.final)tool('authorization snapshots missing');
 const ids=x.ids,s=[];
 if(!x.authorized?.allowed||!eq(x.authorized.marketId,ids.km.id)||
  !eq(x.authorized.membershipId,ids.membership))
  s.push('AUTH1_VALID_MEMBERSHIP_CAPABILITY_REJECTED');
 for(const d of [x.otherMarket,x.noMembership,x.missingCapability,x.unauthorizedProduct]){
  if(!d||d.allowed!==false||d.status!==403||
   d.code!=='MARKET_MEMBERSHIP_REQUIRED')
   s.push('AUTH2_MARKET_OR_MEMBERSHIP_ISOLATION_BROKEN');
 }
 if(!x.afterRevocation||x.afterRevocation.allowed!==false||
  x.afterRevocation.status!==403||
  x.afterRevocation.code!=='MARKET_MEMBERSHIP_REQUIRED'||
  !x.revokedExposure||x.revokedExposure.allowed!==false||
  x.revokedExposure.status!==403)
  s.push('AUTH3_REVOKED_MEMBERSHIP_STILL_AUTHORIZED');
 if(x.before.records.length||x.afterDenied.records.length||
  x.final.records.length||x.before.audits.length||
  x.afterDenied.audits.length||x.final.audits.length||
  !productSame(x.before.product,x.afterDenied.product)||
  !productSame(x.before.product,x.final.product))
  s.push('AUTH4_REJECTED_ACTION_CREATED_CATALOG_OR_AUDIT_WRITES');
 if(x.final.membership?.status!=='REVOKED')
  s.push('AUTH5_REVOKED_STATUS_NOT_RECORDED');
 return {contract:'komerce-independent-market-membership-oracle/v32',
  signals:[...new Set(s)],violation:s.length>0,
  crossMarket:ids.cm.code,targetMarket:ids.km.code,
  unauthorizedWrites:x.final.records.length,
  positiveAuthorized:Boolean(x.authorized.allowed),
  rawHttpAuthenticationCertified:false};
}
function inspect(x){
 return x?.mode==='CATALOG'?catalogOracle(x):x?.mode==='AUTH'?authOracle(x):
  tool('unsupported mode');
}
function forged(x){
 const fake=structuredClone(x);
 if(x.mode==='CATALOG'){
  fake.afterEnable.records.push({market_id:x.ids.cm.id,
   decided_by:x.ids.user,commercial_exposure:'ENABLED'});
  fake.cmVisible=true;
  return {name:'FORGED_CROSS_MARKET_EXPOSURE',signals:inspect(fake).signals};
 }
 if(x.mode==='AUTH'){
  fake.missingCapability={allowed:true,marketId:x.ids.km.id,status:null,code:null};
  fake.afterDenied.records.push({market_id:x.ids.cm.id,
   decided_by:x.ids.without,commercial_exposure:'ENABLED'});
  return {name:'FORGED_UNAUTHORISED_WRITER_AND_FOREIGN_MARKET',signals:inspect(fake).signals};
 }
 tool('missing forged fixture');
}
module.exports={inspect,catalogOracle,authOracle,forged};
