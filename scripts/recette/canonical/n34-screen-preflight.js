/** @komerce-arch-lite
 * @role g6-n34-readonly-screen-planning
 * @domain sourcing
 * @layer test
 * @owner backend-core
 * @purpose Select exactly one protected central Hub supplier and a distinct real source; no DB write or scenario PASS.
 * @impact-areas staging-only, sourcing, catalog
 */
'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=code=>{throw Error('G6_N34_'+code)};
function chooseSupplierFixtures(rows){
 if(!Array.isArray(rows))fail('SUPPLIERS_NOT_LIST');
 const active=rows.filter(r=>r?.is_active===true&&r.deleted_at==null&&UUID.test(String(r.id||'')));
 const hubs=active.filter(s=>s.system_key==='central_hub');
 if(hubs.length!==1)fail('CENTRAL_IDENTITY_NOT_UNIQUE');
 const hub=hubs[0];
 if(hub.name!=='Fournisseur central Hub'||hub.platform!=='local')fail('CENTRAL_IDENTITY_DRIFT');
 const real=active.filter(s=>s.id!==hub.id&&s.system_key==null&&
   typeof s.name==='string'&&s.name.trim()&&typeof s.platform==='string'&&s.platform.trim())
   .sort((a,b)=>a.id.localeCompare(b.id))[0];
 if(!real)fail('REAL_SUPPLIER_MISSING');
 return Object.freeze({hub:{id:hub.id,name:hub.name},real:{id:real.id,name:real.name,platform:real.platform}});
}
function hasExactSupplierOptions(options, fixtures){
 if(!Array.isArray(options)||!fixtures?.hub?.id||!fixtures?.real?.id)return false;
 if(options.filter(o=>o.id===fixtures.hub.id&&o.key==='central_hub').length!==1)return false;
 if(options.filter(o=>o.id===fixtures.real.id&&o.key==='').length!==1)return false;
 if(options.some(o=>o.id===fixtures.hub.id&&o.key!== 'central_hub'))return false;
 return true;
}
module.exports={chooseSupplierFixtures,hasExactSupplierOptions};
