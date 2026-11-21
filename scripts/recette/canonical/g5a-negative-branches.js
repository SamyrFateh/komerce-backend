/** @komerce-arch-lite
 * @role g6-g5a-negative-branch-readbacks
 * @domain checkout
 * @layer test
 * @owner backend-core
 * @purpose Independent read-only business preconditions for N03 route unavailable and N05 Supplier Order Identity incomplete.
 * @db-read markets,relais,product_skus,products,sourcing_candidates,product_suppliers
 * @db-write none
 * @impact-areas staging-only
 */
'use strict';
const {isRelaisRoutable}=require('../../services/routing');
const {certifyCatalogProduct}=require('../../services/catalog-certification');
const fail=(code)=>{throw Error(code)};
const BRANCHES=Object.freeze({
 N03:Object.freeze(['SUSPENDED','ROUTE_MISSING']),
 N05:Object.freeze(['NO_ACTIVE_SKU','SOI_INCOMPLETE']),
});
function branchFor(scenario,value){
 const ids=BRANCHES[scenario];
 if(!ids)return null;
 const branch=String(value||ids[0]).toUpperCase();
 if(!ids.includes(branch))fail('G6_'+scenario+'_BRANCH_UNSUPPORTED_'+branch);
 return branch;
}
async function readRouteAvailability(db,marketCode){
 const {rows:[market]}=await db.query('SELECT id,lifecycle_status::text AS lifecycle_status FROM markets WHERE code=$1',[marketCode]);
 if(!market)fail('G6_N03_PREREQ_MISSING_MARKET');
 const {rows}=await db.query(`
 SELECT r.id,r.name,r.zone,r.address,r.island,r.island_code,m.code AS market_code
 FROM relais r JOIN markets m ON m.id=r.market_id
 WHERE m.id=$1 AND r.is_active=TRUE ORDER BY r.id
 `,[market.id]);
 const routable=rows.filter(r=>isRelaisRoutable(r,{marketCode}));
 return Object.freeze({market_lifecycle:market.lifecycle_status,
  active_relays:rows.length,routable_relays:routable.length,
  route_available:routable.length>0,
  resolution:'CANONICAL_IS_RELAIS_ROUTABLE'});
}
function assertRouteMissing(v){
 if(!v||v.market_lifecycle!=='ACTIVE'||v.route_available!==false||
  !Number.isSafeInteger(v.active_relays)||v.active_relays<0||v.routable_relays!==0||
  v.resolution!=='CANONICAL_IS_RELAIS_ROUTABLE')
  fail('G6_N03_PREREQ_MISSING_ROUTE_ABSENT');
 return v;
}
async function assertSupplierPublicationBlocked(db,productId,branch){
 if(!['NO_ACTIVE_SKU','SOI_INCOMPLETE'].includes(branch))fail('G6_N05_BRANCH_INVALID');
 // Canonical certification computes the actual rule used to approve publication.
 const certificate=await certifyCatalogProduct(db,productId,{requireSupplierSku:true});
 if(!certificate||certificate.row?.lifecycle_status!=='candidate'||certificate.certification?.certified!==false)
  fail('G6_N05_PREREQ_MISSING_CANDIDATE_CERTIFICATION');
 const reasons=certificate.certification.reasons||[];
 const code=branch==='NO_ACTIVE_SKU'?'active_supplier_sku_missing':'supplier_order_identity_incomplete';
 if(!reasons.includes(code))fail('G6_N05_PREREQ_MISSING_'+code.toUpperCase());
 const qty=Number(certificate.row?.active_supplier_skus||0);
 const complete=Number(certificate.row?.complete_supplier_skus||0);
 if(branch==='SOI_INCOMPLETE'&&!(qty>0&&complete<qty))
  fail('G6_N05_PREREQ_MISSING_ACTIVE_SUPPLIER_WITHOUT_SOI');
 if(branch==='NO_ACTIVE_SKU'&&qty!==0)
  fail('G6_N05_PREREQ_MISSING_ACTIVE_SUPPLIER_SKU');
 return Object.freeze({product_candidate:true,sku_complete:qty>0,
  soi_complete:qty>0&&qty===complete,
  certification_rule:code,certification_verdict:'BLOCKED',
  active_supplier_skus:qty,complete_supplier_skus:complete});
}
module.exports={BRANCHES,branchFor,readRouteAvailability,assertRouteMissing,assertSupplierPublicationBlocked};
