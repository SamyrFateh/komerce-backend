'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {inspect,forged}=require('./v32-catalog-auth-oracle');
const u=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const ids={km:{id:u(1),code:'KM'},cm:{id:u(2),code:'CM'},
 user:u(3),without:u(4),membership:u(5),product:u(6)};
const product={id:ids.product,is_active:true,price_kmf:'10000.00',name:'test'};
const row=(market,exposure,by=ids.user)=>({market_id:market,
 commercial_exposure:exposure,decided_by:by});
const audit=action=>({market_id:ids.km.id,actor_user_id:ids.user,
 capability:'catalog.expose',action});
function catalog(){
 return {contract:'komerce-catalog-market-auth-physical/v32',
  mode:'CATALOG',realOwnerCalled:true,canonicalPg:true,noExternalNetwork:true,
  noProductionAccess:true,authenticatedHttpRouteTested:false,ids,
  before:{product,records:[],audits:[]},defaultKm:'DISABLED',defaultCm:'DISABLED',
  enabled:{allowed:true,marketId:ids.km.id},kmVisible:true,cmVisible:false,
  afterEnable:{product,records:[row(ids.km.id,'ENABLED')],
   audits:[audit('CATALOG_PRODUCT_EXPOSED')]},
  disabled:{allowed:true,marketId:ids.km.id},finalKm:'DISABLED',finalCm:'DISABLED',
  afterDisable:{product,records:[row(ids.km.id,'DISABLED')],
   audits:[audit('CATALOG_PRODUCT_EXPOSED'),audit('CATALOG_PRODUCT_HIDDEN')]}}
}
const denial={allowed:false,code:'MARKET_MEMBERSHIP_REQUIRED',status:403};
function auth(){
 return {contract:'komerce-catalog-market-auth-physical/v32',
  mode:'AUTH',realOwnerCalled:true,canonicalPg:true,noExternalNetwork:true,
  noProductionAccess:true,authenticatedHttpRouteTested:false,ids,
  before:{product,records:[],audits:[]},
  authorized:{allowed:true,marketId:ids.km.id,membershipId:ids.membership},
  otherMarket:{...denial},noMembership:{...denial},
  missingCapability:{...denial},unauthorizedProduct:{...denial},
  afterDenied:{product,records:[],audits:[]},
  afterRevocation:{...denial},revokedExposure:{...denial},
  final:{product,records:[],audits:[],membership:{status:'REVOKED'}}}
}
test('no exposure is fail-closed; authorised KM expose then disable cannot touch CM or global product',()=>{
 assert.deepEqual(inspect(catalog()).signals,[]);
});
test('independent catalogue oracle catches erroneous market spill despite successful owner response',()=>{
 assert.ok(forged(catalog()).signals.includes('CAT2_EXPOSURE_LEAKED_TO_ANOTHER_MARKET'));
});
test('global catalogue mutation is not justified by a market exposure decision',()=>{
 const c=catalog();c.afterEnable.product={...product,price_kmf:'1'};
 assert.ok(inspect(c).signals.includes('CAT4_GLOBAL_CATALOG_PRODUCT_MUTATED_BY_MARKET_EXPOSURE'));
});
test('active membership and proper capability authorises only KM, no membership elsewhere',()=>{
 assert.deepEqual(inspect(auth()).signals,[]);
});
test('successful fake unauthorized operation plus foreign market write remains detected',()=>{
 const f=forged(auth()).signals;
 assert.ok(f.includes('AUTH2_MARKET_OR_MEMBERSHIP_ISOLATION_BROKEN'));
 assert.ok(f.includes('AUTH4_REJECTED_ACTION_CREATED_CATALOG_OR_AUDIT_WRITES'));
});
test('post revocation authorization is rejected even with valid old capability',()=>{
 const a=auth();a.afterRevocation={allowed:true,marketId:ids.km.id};
 assert.ok(inspect(a).signals.includes('AUTH3_REVOKED_MEMBERSHIP_STILL_AUTHORIZED'));
});
test('owner success alone does not justify missing audit',()=>{
 const c=catalog();c.afterDisable.audits=[];
 assert.ok(inspect(c).signals.includes('CAT5_MARKET_EXPOSURE_AUDIT_INCOMPLETE'));
});
test('missing independent PG observations fail as tool errors',()=>{
 const c=catalog();delete c.before.product;
 assert.throws(()=>inspect(c),/V32_ORACLE_TOOL_ERROR/);
});
