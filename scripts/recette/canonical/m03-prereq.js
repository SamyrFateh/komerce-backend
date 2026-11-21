/** @komerce-arch-lite
 * @role g6-m03-prerequisites-and-basket-selection
 * @domain orders
 * @layer script
 * @owner backend-core
 * @purpose Read-only M03 data prerequisites (sellable products grouped by source, local stock) and mixed-basket selection.
 * @impact-areas staging-only
 */
'use strict';
const {M01_PRODUCT_REF}=require('./scenario-profile');
const MIN_IMPORT_SOURCES=3;
// Produit vendable : prix LOCAL_ACTIVE + exposition ENABLED + SKU actif (règle per_market_minimum de la matrice).
// Source = première association admissible (priorité, ancienneté, id) ; à défaut, le propriétaire
// opérationnel central Hub explicite, comme resolveSupplierSource(... assignedSupplierId).
// Pour un SKU MANUAL central Hub, stock interne 0 != stock fournisseur indisponible :
// l'achat réel doit encore être certifié par Chromium (pas par cette lecture seule).
const SELLABLE_SQL=`
 SELECT p.id,p.product_ref,d.amount,
  COALESCE(
    (SELECT CASE WHEN s.system_key='central_hub' THEN 'central_hub' ELSE 'supplier:'||s.id::text END
       FROM product_suppliers ps JOIN suppliers s ON s.id=ps.supplier_id
      WHERE ps.product_id=p.id AND ps.is_active=TRUE AND ps.deleted_at IS NULL
        AND s.is_active=TRUE AND s.deleted_at IS NULL AND (s.owner_scope IS NULL OR s.system_key='central_hub')
      ORDER BY ps.priority ASC,ps.created_at ASC,ps.id ASC LIMIT 1),
    -- As in resolveSupplierSource(... assignedSupplierId): an explicitly manual Hub
    -- catalogue product has an operational procurement owner, not an external vendor mapping.
    (SELECT 'central_hub' FROM suppliers s
      WHERE s.id=p.procurement_supplier_id AND s.system_key='central_hub'
        AND s.is_active=TRUE AND s.deleted_at IS NULL LIMIT 1)
  ) AS source_key,
  EXISTS (SELECT 1 FROM product_skus k WHERE k.product_id=p.id AND k.is_active=TRUE
    AND (k.stock>0 OR (
      -- An internal on-demand Hub SKU starts at stock=0: no fictitious supplier stock,
      -- supplier SKU or provider identity may be generated just to make the probe green.
      k.source='MANUAL' AND k.supplier_order_identity IS NULL
      AND EXISTS (SELECT 1 FROM suppliers h WHERE h.id=p.procurement_supplier_id
        AND h.system_key='central_hub' AND h.is_active=TRUE AND h.deleted_at IS NULL)
    ))) AS import_ready,
  COALESCE((SELECT SUM(ls.qty_physical-COALESCE((SELECT SUM(a.quantity) FROM local_stock_allocations a
      WHERE a.local_stock_id=ls.id AND a.consumed_at IS NULL AND a.released_at IS NULL),0))
    FROM local_stock ls WHERE ls.product_id=p.id AND ls.market_id=m.id
      AND ls.location='KM_MAIN' AND ls.commercial_exposure='ENABLED'),0)::int AS local_available
 FROM products p
 JOIN markets m ON m.code=$1
 JOIN product_market_price_drafts d ON d.product_id=p.id AND d.market_id=m.id AND d.status='LOCAL_ACTIVE'
 JOIN product_market_exposure e ON e.product_id=p.id AND e.market_id=m.id AND e.commercial_exposure='ENABLED'
 WHERE p.lifecycle_status='active' AND p.is_active=TRUE AND p.is_available=TRUE
   AND EXISTS (SELECT 1 FROM product_skus sku WHERE sku.product_id=p.id AND sku.is_active=TRUE)
 ORDER BY p.product_ref`;
async function readSellable(client,market){
 const {rows}=await client.query(SELLABLE_SQL,[market]);
 return rows.map(r=>({id:r.id,product_ref:r.product_ref,price:Number(r.amount),
  source_key:r.source_key||null,import_ready:r.import_ready!==false,local_available:Number(r.local_available)||0}));
}
// Pur : classe les produits vendables, calcule le verdict et le panier candidat.
function classify(products){
 const local=products.filter(p=>p.local_available>=1&&p.product_ref!==M01_PRODUCT_REF);
 // Import achetable comme M01 : SKU actif avec stock fournisseur > 0 (même précondition que l'écran boutique M01).
 const imp=products.filter(p=>p.local_available<1&&p.source_key&&p.import_ready!==false);
 const bySource={};
 for(const p of products){const k=p.source_key||'NO_SOURCE';(bySource[k]=bySource[k]||[]).push(p.product_ref)}
 const importSources=new Set(imp.map(p=>p.source_key));
 const missing=[];
 if(!local.length)missing.push('LOCAL_STOCK');
 if(importSources.size<MIN_IMPORT_SOURCES)missing.push('IMPORT_SOURCES_'+importSources.size+'_OF_'+MIN_IMPORT_SOURCES);
 if(!products.some(p=>p.source_key==='central_hub'))missing.push('CENTRAL_HUB_PRODUCT');
 if(products.length<4)missing.push('SELLABLE_PRODUCTS_'+products.length+'_OF_4');
 return {sellable_count:products.length,sources:bySource,source_count:Object.keys(bySource).filter(k=>k!=='NO_SOURCE').length,
  local_exposed_available:products.filter(p=>p.local_available>=1).map(p=>({product_ref:p.product_ref,available:p.local_available})),
  local_candidates:local.map(p=>p.product_ref),import_sources:[...importSources].sort(),
  verdict:missing.length?'M03_MISSING:'+missing.join('+'):'M03_READY'};
}
// Pur : sélection déterministe d'un panier mixte (1 local + >=3 import de sources distinctes). Refus sinon.
function selectMixedBasket(products,{minSources=MIN_IMPORT_SOURCES}={}){
 const local=products.find(p=>p.local_available>=1&&p.product_ref!==M01_PRODUCT_REF);
 if(!local)throw Error('G6_M03_LOCAL_STOCK_PRODUCT_MISSING');
 const seen=new Set(),imports=[];
 // Fournisseur central Hub en premier (critère multi_sourcing), puis une ligne par source distincte.
 const pool=products.filter(p=>p.local_available<1&&p.source_key&&p.import_ready!==false&&p.product_ref!==local.product_ref)
  .sort((a,b)=>(b.source_key==='central_hub')-(a.source_key==='central_hub'));
 for(const p of pool)if(!seen.has(p.source_key)){seen.add(p.source_key);imports.push(p)}
 if(imports.length<minSources)throw Error('G6_M03_IMPORT_SOURCES_BELOW_'+minSources+'_GOT_'+imports.length);
 return Object.freeze({local:Object.freeze({...local}),imports:Object.freeze(imports.slice(0,minSources).map(p=>Object.freeze({...p})))});
}
module.exports={MIN_IMPORT_SOURCES,SELLABLE_SQL,readSellable,classify,selectMixedBasket};
