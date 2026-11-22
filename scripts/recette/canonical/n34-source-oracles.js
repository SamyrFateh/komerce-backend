/** @komerce-arch-lite
 * @role g6-n34-readonly-source-oracles
 * @domain purchasing
 * @layer test
 * @owner backend-core
 * @purpose Independent PostgreSQL evidence for N34a central Hub identity and N34b explicit real supplier provenance. No mutations, no scenario PASS.
 * @db-read suppliers, products, sourcing_candidates
 * @db-write none
 * @impact-areas staging-only, sourcing, catalog, purchasing
 */
'use strict';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const assert=(yes,code)=>{if(!yes)throw Error('G6_N34_'+code)};

/**
 * This is a READ-ONLY invariant. Actual attempts to alter/deactivate/delete
 * the central Hub must still be executed as guarded, refused UI/API gestures
 * before the N34a Chromium scenario can be certified.
 */
async function centralHubIdentity(db){
 assert(db&&typeof db.query==='function','DB_REQUIRED');
 const {rows}=await db.query(
  `SELECT id, name, platform, owner_scope, auto_order, is_active, deleted_at
     FROM suppliers WHERE system_key='central_hub' ORDER BY id`
 );
 assert(rows.length===1,'CENTRAL_HUB_COUNT_'+rows.length);
 const row=rows[0];
 assert(row.name==='Fournisseur central Hub'&&row.platform==='local'&&
  row.owner_scope==='hub'&&row.auto_order===false&&row.is_active===true&&
  row.deleted_at===null,'CENTRAL_HUB_IDENTITY_INVALID');
 return {central_hub_id:row.id,identity_unchanged:true,rows:1,db_write:false};
}

/**
 * N34b needs two identities from the real Chromium journey: product ID
 * (published Catalogue product) and sourcing candidate ID (selected supplier
 * in the UI). Never substitute the central Hub identity for a missing ID.
 */
async function explicitSupplierProvenance(db,{productId,candidateId,expectedSupplierId}={}){
 assert(db&&typeof db.query==='function','DB_REQUIRED');
 assert([productId,candidateId,expectedSupplierId].every(x=>UUID.test(String(x||''))),
  'EXPLICIT_SOURCE_IDS_REQUIRED');
 const {rows}=await db.query(
  `SELECT p.id AS product_id,p.procurement_supplier_id,
          s.system_key,s.is_active,s.deleted_at,
          sc.id AS candidate_id,sc.supplier_id AS candidate_supplier_id
     FROM products p
     JOIN suppliers s ON s.id=p.procurement_supplier_id
     JOIN sourcing_candidates sc ON sc.id=$2::uuid AND sc.product_id=p.id
    WHERE p.id=$1::uuid`,
  [productId,candidateId]
 );
 assert(rows.length===1,'EXPLICIT_SOURCE_NOT_FOUND_OR_AMBIGUOUS');
 const item=rows[0];
 assert(item.procurement_supplier_id===expectedSupplierId&&
  item.candidate_supplier_id===expectedSupplierId&&
  item.system_key!=='central_hub'&&item.is_active===true&&
  item.deleted_at===null,'EXPLICIT_SOURCE_REPLACED_OR_INACTIVE');
 return {product_id:productId,candidate_id:candidateId,
  selected_supplier_id:expectedSupplierId,preserved:true,db_write:false};
}

module.exports={centralHubIdentity,explicitSupplierProvenance};
