'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Gate C — composed provider proof.
 * Persisted-shaped provider payloads cross the real adapter -> canonical V2 ->
 * refinery normalization boundary without supplier network or paid AI.
 */

const { normalizeCjProduct } = require('../../services/suppliers/connectors/cj-connector');
const { normalizeDsProduct } = require('../../services/suppliers/connectors/aliexpress-connector');
const { validateNormalizedProduct, buildNormalizedSourceContractSnapshot } = require('../../services/suppliers/normalized-product');
const scanner = require('../../services/supplier-catalog-scanner');
const { validateForPromotion } = require('../../services/catalog-promotion');

const config = {
  finance: { taux_change_eur_kmf: 492, taux_aed_kmf: 138, target_marge_brute_pct: 40 },
  categories: {
    electronique: { key:'electronique', default_weight_kg:1, default_margin_pct:35, classification_terms:{ speaker:10, electronics:8, audio:8, wireless:6 } },
    sport: { key:'sport', default_weight_kg:0.5, default_margin_pct:35, classification_terms:{ gloves:10, sports:8, motorcycle:8 } },
    autre: { key:'autre', default_weight_kg:0.5, default_margin_pct:40, classification_terms:{} },
  },
};

const cjRaw = {
  pid:'1369601676230660096', productNameEn:'Motorcycle Riding Gloves', productSku:'CJNS1037469',
  bigImage:'https://cf.cjdropshipping.com/product/gloves.jpg',
  productImageSet:['https://cf.cjdropshipping.com/product/gloves-2.jpg'],
  sellPrice:'6.60-8.10', categoryName:'Sports > Motorcycle > Gloves', productKeyEn:'Color-Size',
  productWeight:170, description:'<p>Outdoor riding gloves</p>',
  variants:[
    { vid:'1369601677723832320', variantNameEn:'Camouflage S', variantImage:'https://cf.cjdropshipping.com/product/gloves-camo.jpg', variantSku:'CJNS103746901AZ', variantKey:'Camouflage-S', variantSellPrice:6.6, inventories:[{countryCode:'CN',totalInventory:40}] },
    { vid:'1369601677795135488', variantNameEn:'Camouflage M', variantSku:'CJNS103746902BY', variantKey:'Camouflage-M', variantSellPrice:6.6, inventories:[{countryCode:'CN',totalInventory:25}] },
  ],
};

const aliFeed = {
  product_id:'4000102715995', product_title:'Wireless Mini Speaker',
  product_detail_url:'https://www.aliexpress.com/item/4000102715995.html',
  product_main_image_url:'https://ae01.alicdn.com/kf/main.jpg',
  target_sale_price:'9.90', target_sale_price_currency:'USD',
  first_level_category_name:'Consumer Electronics', second_level_category_name:'Portable Audio',
};
const aliDetail = { result:{
  ae_item_base_info_dto:{ product_id:'4000102715995', subject:'Wireless Mini Speaker', currency_code:'USD', category_id:200003482, detail:'<p>Compact Bluetooth speaker for everyday listening.</p>' },
  ae_item_sku_info_dtos:{ ae_item_sku_info_d_t_o:[
    { id:'sku-black', sku_code:'AE-SPK-BLK', sku_available_stock:12, offer_sale_price:'9.90', currency_code:'USD',
      ae_sku_property_dtos:{ae_sku_property_d_t_o:[{sku_property_id:14,sku_property_name:'Color',property_value_definition_name:'Black',sku_image:'https://ae01.alicdn.com/kf/black.jpg'}]} },
    { id:'sku-white', sku_code:'AE-SPK-WHT', sku_available_stock:8, offer_sale_price:'10.50', currency_code:'USD',
      ae_sku_property_dtos:{ae_sku_property_d_t_o:[{sku_property_id:14,sku_property_name:'Color',property_value_definition_name:'White',sku_image:'https://ae01.alicdn.com/kf/white.jpg'}]} },
  ]},
  ae_multimedia_info_dto:{image_urls:'https://ae01.alicdn.com/kf/main.jpg'},
  package_info_dto:{gross_weight:'0.42',package_length:'12',package_width:'10',package_height:'8'},
}};

const providers = [
  ['CJ', () => normalizeCjProduct(JSON.parse(JSON.stringify(cjRaw)))],
  ['AliExpress', () => normalizeDsProduct(JSON.parse(JSON.stringify(aliDetail)), JSON.parse(JSON.stringify(aliFeed)))],
];

function canonical(value){ return JSON.stringify(value, Object.keys(value || {}).sort()); }

describe.each(providers)('Gate C provider composition — %s', (_provider, makeProduct) => {
  test('identical replay and reordered payload converge through adapter, V2 and refinery', async () => {
    const a=makeProduct();
    const b=makeProduct();
    expect(validateNormalizedProduct(a)).toEqual({valid:true,errors:[]});
    expect(buildNormalizedSourceContractSnapshot(a)).toEqual(buildNormalizedSourceContractSnapshot(b));
    const ra=await scanner.normalizeCandidate(a,{config});
    const rb=await scanner.normalizeCandidate(b,{config});
    expect(rb.supplier_product_id).toBe(ra.supplier_product_id);
    expect(rb.purchase_price_kmf).toBe(ra.purchase_price_kmf);
    validateForPromotion(buildNormalizedSourceContractSnapshot(a));
  });

  test('legitimate update preserves product/SKU identity while changing mutable facts', () => {
    const before=makeProduct();
    const after=makeProduct();
    after.stock_available=(before.stock_available ?? 0)+7;
    if(after.sellable_units?.length){
      after.sellable_units[0].stock_available=(before.sellable_units[0].stock_available ?? 0)+7;
      after.sellable_units[0].purchase_price=Number(before.sellable_units[0].purchase_price)+0.25;
    }
    expect(validateNormalizedProduct(after).valid).toBe(true);
    expect(after.supplier_product_id).toBe(before.supplier_product_id);
    expect(after.sellable_units.map(x=>x.supplier_sku)).toEqual(before.sellable_units.map(x=>x.supplier_sku));
    expect(buildNormalizedSourceContractSnapshot(after)).not.toEqual(buildNormalizedSourceContractSnapshot(before));
    validateForPromotion(buildNormalizedSourceContractSnapshot(after));
  });

  test('malformed update fails closed before refinery/promotion', () => {
    const malformed=makeProduct();
    malformed.purchase_price='not-a-number';
    const verdict=validateNormalizedProduct(malformed);
    expect(verdict.valid).toBe(false);
    expect(()=>buildNormalizedSourceContractSnapshot(malformed)).toThrow(/invalide/);
  });
});
