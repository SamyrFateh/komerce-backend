'use strict';
/** @test-kind unit @test-runner jest @test-requires none */

const { normalizeCjProduct } = require('../../services/suppliers/connectors/cj-connector');
const { normalizeDsProduct } = require('../../services/suppliers/connectors/aliexpress-connector');
const { buildNormalizedSourceContractSnapshot } = require('../../services/suppliers/normalized-product');
const { planSkuReconciliation } = require('../../services/catalog-promotion/sku');
const { upsertCandidateFromCatalogImport, archiveMissingCandidatesFromCatalogImport } = require('../../services/sourcing-candidate-import-service');
const { recordPageSuccess, recordError } = require('../../services/suppliers/catalog-sync-checkpoint');

const cj={pid:'p-cj',productNameEn:'Gloves',bigImage:'https://x.test/a.jpg',sellPrice:5,categoryName:'Sports > Gloves',productKeyEn:'Color',description:'Useful riding gloves for daily use.',variants:[
 {vid:'v1',variantSku:'CJ-A',variantKey:'Black',variantSellPrice:5,inventories:[{totalInventory:3}]},
 {vid:'v2',variantSku:'CJ-B',variantKey:'White',variantSellPrice:6,inventories:[{totalInventory:4}]}
]};
const feed={product_id:'10001',product_title:'Speaker',product_main_image_url:'https://x.test/a.jpg',target_sale_price:'9.9',target_sale_price_currency:'USD',first_level_category_name:'Electronics'};
const ali={result:{ae_item_base_info_dto:{product_id:'10001',subject:'Speaker',currency_code:'USD',detail:'Portable wireless speaker for everyday use.'},ae_item_sku_info_dtos:{ae_item_sku_info_d_t_o:[
 {id:'a1',sku_code:'AE-A',sku_available_stock:3,offer_sale_price:'9.9',currency_code:'USD',ae_sku_property_dtos:{ae_sku_property_d_t_o:[{sku_property_id:14,sku_property_name:'Color',property_value_definition_name:'Black'}]}},
 {id:'a2',sku_code:'AE-B',sku_available_stock:4,offer_sale_price:'10.9',currency_code:'USD',ae_sku_property_dtos:{ae_sku_property_d_t_o:[{sku_property_id:14,sku_property_name:'Color',property_value_definition_name:'White'}]}}
]}}};

const providers=[
 ['CJdropshipping',()=>normalizeCjProduct(JSON.parse(JSON.stringify(cj)))],
 ['AliExpress',()=>normalizeDsProduct(JSON.parse(JSON.stringify(ali)),JSON.parse(JSON.stringify(feed)))]
];

function candidateInput(provider,product){
 return {importId:'imp',supplierName:provider,product,normalized:{komerce_category:'autre',estimated_weight_kg:1,estimated_volume_m3:.001,purchase_price_kmf:1000,target_margin_pct:40,data_sources:{}},normalizedSourceContract:buildNormalizedSourceContractSnapshot(product),scan:{scan_result:{},sourcing_decision:'KEEP',reason:'ok',recommended_action:'import',confidence:'high'},verdict:{label:'Eligible'},autoState:'scanned',autoRejectedReason:null,userId:null};
}

describe.each(providers)('Gate C lifecycle composition — %s',(provider,make)=>{
 test('reordered payload converges to the same supplier/SKU reconciliation identities',()=>{
   const a=make(); const b=make(); b.sellable_units=[...b.sellable_units].reverse(); b.media=[...b.media].reverse();
   expect(new Set(b.sellable_units.map(x=>x.supplier_sku))).toEqual(new Set(a.sellable_units.map(x=>x.supplier_sku)));
   const existing=a.sellable_units.map((u,i)=>({id:`sku-${i}`,supplier_sku:u.supplier_sku,source:'SUPPLIER',variant_combo:u.option_values,stock:u.stock_available,is_active:true,supplier_unit_ref:u.supplier_unit_ref||null,supplier_order_identity:u.supplier_order_identity||null}));
   const plan=planSkuReconciliation(existing,b.sellable_units);
   expect(plan.toCreate).toHaveLength(0); expect(plan.toDeactivate).toHaveLength(0); expect(plan.toUpdate).toHaveLength(a.sellable_units.length);
 });

 test('interruption checkpoint does not advance; resume persists the same provider identity',async()=>{
   const failed={query:jest.fn().mockResolvedValueOnce({rows:[]})};
   await recordError(failed,{supplierName:provider,syncKey:'gate-c',categoryId:'fixture',error:'injected crash'});
   expect(failed.query.mock.calls[0][0]).not.toContain('next_page =');

   const checkpoint={query:jest.fn().mockResolvedValueOnce({rows:[{next_page:2,completed:false,last_request_id:'resume'}]})};
   const row=await recordPageSuccess(checkpoint,{supplierName:provider,syncKey:'gate-c',categoryId:'fixture',page:1,totalPages:2,totalRecords:1,accepted:1,requestId:'resume'});
   expect(row.next_page).toBe(2);

   const p=make();
   const q={query:jest.fn().mockResolvedValueOnce({rows:[{id:'cand-stable',was_updated:false,data_sources:{}}]})};
   const persisted=await upsertCandidateFromCatalogImport(q,candidateInput(provider,p));
   expect(persisted.row.id).toBe('cand-stable');
   expect(q.query.mock.calls[0][0]).toContain('ON CONFLICT (supplier_name, supplier_product_id)');
 });

 test('disappearance archives explicitly and return reactivates the same supplier identity',async()=>{
   const archiveQ={query:jest.fn().mockResolvedValueOnce({rows:[{id:'cand-stable',supplier_product_id:make().supplier_product_id,state:'scanned'}]}).mockResolvedValue({rows:[]})};
   expect(await archiveMissingCandidatesFromCatalogImport(archiveQ,{supplierName:provider,importedIds:['other'],userId:null,importId:'full-snapshot'})).toBe(1);
   expect(archiveQ.query.mock.calls[0][0]).toContain("SET state = 'archived'");

   const p=make();
   const returnQ={query:jest.fn().mockResolvedValueOnce({rows:[{id:'cand-stable',was_updated:true,state:'scanned',data_sources:{}}]}).mockResolvedValueOnce({rows:[]})};
   const returned=await upsertCandidateFromCatalogImport(returnQ,candidateInput(provider,p));
   expect(returned.row.id).toBe('cand-stable'); expect(returned.row.state).toBe('scanned');
   expect(returnQ.query.mock.calls[0][0]).not.toContain("state IN ('imported_to_catalog', 'rejected', 'archived')");
 });
});
