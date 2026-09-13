/**
 * @komerce-arch
 * @role          aliexpress-fulfillment-adapter
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        persisted Supplier Order Identity, destination, quantity
 * @outputs       live AliExpress fulfillment evidence
 * @depends       services/suppliers/aliexpress-purchase-preflight.js, services/suppliers/connectors/aliexpress-connected-connector.js, services/suppliers/connectors/aliexpress-form-body-fetch.js
 * @used-by       services/suppliers/supplier-fulfillment-readiness.js
 * @db-read       sourcing_candidates
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md
 * @impact-areas  purchasing, supplier-integration, catalog
 */
'use strict';
const preflight=require('./aliexpress-purchase-preflight');
const connected=require('./connectors/aliexpress-connected-connector');
const {formBodyFetch}=require('./connectors/aliexpress-form-body-fetch');
const provider='aliexpress';
async function resolveSupplierProductRef(db,row,identity){const native=String(identity?.payload?.product_id||'').trim();if(native)return native;const {rows}=await db.query(`SELECT DISTINCT supplier_product_id FROM sourcing_candidates WHERE product_id = $1 AND supplier_name = 'AliExpress' AND state = 'imported_to_catalog' AND supplier_product_id IS NOT NULL`,[row.product_id]);const refs=rows.map(r=>String(r.supplier_product_id||'').trim()).filter(Boolean);if(refs.length!==1){const e=new Error(`supplier_product_id AliExpress non univoque (${refs.length})`);e.code='BLOCKED_SUPPLIER_IDENTITY';throw e;}return refs[0];}
function classify(error,V){const m=String(error?.message||error||'');if(error?.code==='BLOCKED_SUPPLIER_IDENTITY'||/Supplier Order Identity|supplier_product_id|ambigu/i.test(m))return V.BLOCKED_IDENTITY;if(/stock|inventory|quantit/i.test(m))return V.OUT_OF_STOCK;const k=preflight.classifyApiError(error);return k==='auth'||k==='permission'?V.SUPPLIER_UNAVAILABLE:V.PREFLIGHT_FAILED;}
async function evaluate({db,row,identity,quantity,destination,context={},VERDICT:V,result}){const api=context.aliexpressConnected||connected,pf=context.aliexpressPreflight||preflight;let ref;try{ref=await resolveSupplierProductRef(db,row,identity);}catch(e){return result(V.BLOCKED_IDENTITY,{product_sku_id:row.id,provider:'aliexpress'},String(e.message||e));}const country=String(destination.country_code||destination.countryCode||'').trim().toUpperCase();if(!/^[A-Z]{2,3}$/.test(country))return result(V.PREFLIGHT_FAILED,{product_sku_id:row.id,provider:'aliexpress'},'destination.country_code requis');let live;try{live=(await api.fetchProducts({env:context.env||process.env,productIds:[ref],countryCode:country})).products?.[0];}catch(e){return result(classify(e,V),{product_sku_id:row.id,provider:'aliexpress',supplier_product_id:ref},String(e.message||e));}if(!live)return result(V.SUPPLIER_UNAVAILABLE,{product_sku_id:row.id,provider:'aliexpress',supplier_product_id:ref},'Produit fournisseur absent du refresh live');let unit;try{unit=pf.resolveOrderableUnit(live,row.supplier_sku,quantity,{requireOrderIdentity:true});}catch(e){return result(classify(e,V),{product_sku_id:row.id,provider:'aliexpress',supplier_product_id:ref},String(e.message||e));}let payload;try{payload=await api.invokeTop(pf.METHODS.FREIGHT,pf.buildFreightBusinessParams(unit,destination),{env:context.env||process.env,fetchImpl:formBodyFetch(context.fetchImpl||fetch)});}catch(e){const k=pf.classifyApiError(e);return result(k==='auth'||k==='permission'?V.SUPPLIER_UNAVAILABLE:V.FREIGHT_UNAVAILABLE,{product_sku_id:row.id,provider:'aliexpress',supplier_product_id:ref,supplier_unit_ref:row.supplier_unit_ref,stock_available:unit.stock_available,unit_price:unit.unit_price,currency:unit.currency,freight_error_class:k},String(e.message||e));}const freight=pf.summarizeFreightResponse(payload),evidence={product_sku_id:row.id,provider:'aliexpress',supplier_product_id:ref,supplier_unit_ref:row.supplier_unit_ref,quantity,destination_country_code:country,stock_available:unit.stock_available,unit_price:unit.unit_price,currency:unit.currency,freight};if(freight.success===false||!freight.has_options)return result(V.NOT_SHIPPABLE,evidence,freight.error||'Aucune option de fret disponible');return result(V.READY,{...evidence,place_order_invoked:false,payment_invoked:false});}
module.exports={provider,resolveSupplierProductRef,classify,evaluate};