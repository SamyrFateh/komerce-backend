/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {centralHubOnOrderSql,isCentralHubOnOrderSku}=require('../../services/central-hub-on-order');
const {sellableCatalogUnitSql}=require('../../services/catalog-public-view');
const {adjustStock}=require('../../services/product-stock-service');

const ROOT=path.join(__dirname,'../..');
describe('M03 — source manual Hub sold on order',()=>{
 test('source contract requires exact manual SKU, stock zero, active Hub and imported candidate',()=>{
   const sql=centralHubOnOrderSql('product','unit');
   expect(sql).toContain("unit.source='MANUAL'");
   expect(sql).toContain('unit.stock=0');
   expect(sql).toContain('unit.supplier_order_identity IS NULL');
   expect(sql).toContain("hub.system_key='central_hub'");
   expect(sql).toContain("hub_sc.state='imported_to_catalog'");
   expect(sql).toContain("hub_sc.normalized_source_contract->>'source_kind'='central_hub_manual'");
   expect(sql).toContain('hub_sc.supplier_id=product.procurement_supplier_id');
   expect(()=>centralHubOnOrderSql('p); DROP TABLE orders;--','k')).toThrow('CENTRAL_HUB_SQL_ALIAS_INVALID');
 });
 test('checkout authority refuses unverified or absent SKU',async()=>{
   const db={query:jest.fn().mockResolvedValue({rows:[{eligible:false}]})};
   expect(await isCentralHubOnOrderSku(db,'p','sku')).toBe(false);
   expect(await isCentralHubOnOrderSku(db,'p',null)).toBe(false);
   expect(db.query).toHaveBeenCalledTimes(1);
 });
 test('only a true database verdict qualifies, with bound product and SKU ids',async()=>{
   const db={query:jest.fn().mockResolvedValue({rows:[{eligible:true}]})};
   expect(await isCentralHubOnOrderSku(db,'p-hub','sku-manual')).toBe(true);
   expect(db.query.mock.calls[0][1]).toEqual(['p-hub','sku-manual']);
 });
 test('public catalog allows verified Hub zero-stock SKU without relaxing third-party stock',()=>{
   const sql=sellableCatalogUnitSql('p');
   expect(sql).toContain('sellable_sku.stock > 0');
   expect(sql).toContain('sellable_sku.stock=0');
   expect(sql).toContain("sellable_sku.source='MANUAL'");
   expect(sql).toContain("hub.system_key='central_hub'");
   expect(sql).toContain('unsafe_sku.stock > 0');
 });
 test('stock writer never debits or restores a flagged on-order import',async()=>{
   const db={query:jest.fn()};
   const lines=[{product_id:'p-hub',sku_id:'sku-hub',quantity:2,inventory_model:'SKU',procure_on_order:true}];
   await adjustStock(db,lines,'decrement');
   await adjustStock(db,lines,'increment');
   expect(db.query).not.toHaveBeenCalled();
 });
 test('stock writer refuses a malformed on-order snapshot',async()=>{
   const db={query:jest.fn()};
   await expect(adjustStock(db,[{product_id:'p',quantity:1,inventory_model:'SKU',procure_on_order:true}],'increment'))
     .rejects.toThrow('CENTRAL_HUB_ON_ORDER_INVALID_SNAPSHOT');
   expect(db.query).not.toHaveBeenCalled();
 });
 test('migration snapshots the on-order mode, protects INSERT and immutability',()=>{
   const migration=fs.readFileSync(path.join(ROOT,'migrations/424_manual_central_hub_procure_on_order.sql'),'utf8');
   expect(migration).toContain('procure_on_order boolean NOT NULL DEFAULT FALSE');
   expect(migration).toContain("fulfillment_source='IMPORT'");
   expect(migration).toContain('BEFORE INSERT OR UPDATE ON public.order_items');
   expect(migration).toContain("source_kind'='central_hub_manual'");
   expect(migration).not.toContain('UPDATE public.product_skus');
 });
 test('payment, cancellation and backorder use the frozen line flag symmetrically',()=>{
   const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
   expect(read('services/order-payment-confirmation.js')).toContain("items.filter(item => item.procure_on_order !== true)");
   expect(read('services/order-status-machine.js')).toContain("items.filter(item => item.procure_on_order !== true)");
   expect(read('services/parcel-operations.js')).toContain("boItems.filter(item => item.procure_on_order !== true)");
   expect(read('services/order-checkout-persistence.js')).toContain('fulfillment_source, procure_on_order');
 });
});
