'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {validateNormalizedProduct,partitionValid,buildNormalizedSourceContractSnapshot}=require('../../services/suppliers/normalized-product');
function base(){return{schema_version:'2',supplier_name:'Fixture',supplier_product_id:'p1',product_name:'Fixture product',currency:'USD',purchase_price:10,raw_payload:{provider_only:'kept',nested:{x:1}},option_axes:[{key:'size',display_name:'Size',values:['S','M'],display_order:0}],sellable_units:[{supplier_sku:'sku-s',supplier_unit_ref:'u-s',option_values:{size:'S'},stock_available:1,purchase_price:10,currency:'USD',is_active:true},{supplier_sku:'sku-m',supplier_unit_ref:'u-m',option_values:{size:'M'},stock_available:2,purchase_price:11,currency:'USD',is_active:true}]};}
describe('Gate A V2 drift torture on canonical validator',()=>{
 test('unknown provider field is rejected from V2 while raw provenance remains independently preservable',()=>{
  const p=base();p.provider_surprise='new-field';const v=validateNormalizedProduct(p);expect(v.valid).toBe(false);expect(v.errors.join(' ')).toMatch(/provider_surprise|propriété non autorisée|inconnue/i);expect(p.raw_payload.provider_only).toBe('kept');
 });
 test('field type drift fails closed',()=>{const p=base();p.purchase_price='ten';expect(validateNormalizedProduct(p).valid).toBe(false);});
 test('duplicate supplier SKU fails closed',()=>{const p=base();p.sellable_units[1].supplier_sku='sku-s';const v=validateNormalizedProduct(p);expect(v.valid).toBe(false);expect(v.errors.join(' ')).toMatch(/supplier_sku dupliqué/);});
 test('supplier SKU attribute change remains same product identity with changed canonical snapshot',()=>{
  const before=base();const after=base();after.sellable_units[0].stock_available=9;after.sellable_units[0].purchase_price=12;
  const a=buildNormalizedSourceContractSnapshot(before),b=buildNormalizedSourceContractSnapshot(after);
  expect(a.supplier_product_id).toBe(b.supplier_product_id);expect(a.sellable_units[0]).not.toEqual(b.sellable_units[0]);
 });
 test('mixed malformed batch isolates invalid product without silent loss',()=>{const good=base(),bad=base();bad.supplier_product_id='p2';bad.currency='XYZ';const out=partitionValid([good,bad]);expect(out.valid).toHaveLength(1);expect(out.invalid).toHaveLength(1);expect(out.valid.length+out.invalid.length).toBe(2);});
});
