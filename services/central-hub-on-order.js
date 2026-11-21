/** @komerce-arch-lite
 * @role central-hub-on-order-eligibility
 * @domain catalog
 * @layer service
 * @owner backend-core
 * @purpose Fail-closed source for a manual Hub SKU sold for later physical procurement, never local stock.
 * @db-read products, product_skus, suppliers, sourcing_candidates
 * @db-write none
 * @impact-areas catalog, checkout, payments, returns, purchasing
 */
'use strict';

function alias(value){
 if(typeof value!=='string'||!/^[a-z][a-z0-9_]*$/i.test(value))
  throw Error('CENTRAL_HUB_SQL_ALIAS_INVALID');
 return value;
}

/** A qualified stock-zero unit is a procurement promise, not a stock reservation. */
function centralHubOnOrderSql(productAlias='p',skuAlias='k'){
 const p=alias(productAlias),k=alias(skuAlias);
 return `(
   ${p}.inventory_model='SKU'
   AND ${k}.product_id=${p}.id
   AND ${k}.is_active=TRUE AND ${k}.stock=0
   AND ${k}.source='MANUAL'
   AND ${k}.supplier_order_identity IS NULL
   AND EXISTS (
    SELECT 1 FROM suppliers hub
     WHERE hub.id=${p}.procurement_supplier_id AND hub.system_key='central_hub'
       AND hub.is_active=TRUE AND hub.deleted_at IS NULL
   )
   AND EXISTS (
    SELECT 1 FROM sourcing_candidates hub_sc
     WHERE hub_sc.product_id=${p}.id
       AND hub_sc.supplier_id=${p}.procurement_supplier_id
       AND hub_sc.state='imported_to_catalog'
       AND hub_sc.normalized_source_contract->>'source_kind'='central_hub_manual'
   )
 )`;
}

async function isCentralHubOnOrderSku(dbClient,productId,skuId){
 if(!productId||!skuId)return false;
 const {rows:[row]}=await dbClient.query(
  `SELECT ${centralHubOnOrderSql('p','k')} AS eligible
    FROM products p JOIN product_skus k ON k.product_id=p.id
   WHERE p.id=$1 AND k.id=$2`,[productId,skuId]);
 return row?.eligible===true;
}

module.exports={centralHubOnOrderSql,isCentralHubOnOrderSku};
