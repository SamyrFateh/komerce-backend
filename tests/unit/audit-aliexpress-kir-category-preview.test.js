'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db',()=>({query:jest.fn(),pool:{end:jest.fn()}}));
jest.mock('../../services/pricing-engine',()=>({loadGlobalConfig:jest.fn()}));
const {preview,audit}=require('../../scripts/audit-aliexpress-kir-category-preview');
const config={categories:{
  materials:{key:'materials',is_active:true,classification_terms:{'car key case':12}},
  default:{key:'default',is_active:true,classification_terms:{}},
}};
describe('AliExpress KIR category preview (read only)',()=>{
  test('matches saved object against current category without writing',()=>{
    const out=preview([{id:3,candidate_ref:'KSC-1',supplier_product_id:'1005010574838342',
      product_name:'Car Zinc Alloy Leather Key Case Cover',komerce_category:null,
      scan_result:{sourcing_decision:'WATCH'}}],config,['1005010574838342']);
    expect(out.items[0].prediction).toMatchObject({key:'materials',confidence:'high',source:'mapped'});
    expect(out.items[0].saved_customs_category).toBeNull();
  });
  test('reports an absent supplier ID instead of simulating invented evidence',()=>{
    const out=preview([],config,['missing']);
    expect(out).toMatchObject({present:0,missing_supplier_product_ids:['missing'],items:[]});
  });
  test('rejects non-AliExpress KIR before reading candidates',async()=>{
    const query=jest.fn().mockResolvedValue({rows:[{id:1,run_ref:'KIR-000007',provider:'CJdropshipping'}]});
    await expect(audit('KIR-000007',[],{query,loadConfig:jest.fn()})).rejects.toThrow('KIR_NOT_ALIEXPRESS');
    expect(query).toHaveBeenCalledTimes(1);
  });
  test('uses persisted membership and does not issue writes',async()=>{
    const query=jest.fn()
      .mockResolvedValueOnce({rows:[{id:7,run_ref:'KIR-000007',provider:'AliExpress',source_total:20}]})
      .mockResolvedValueOnce({rows:[{id:3,candidate_ref:'C-1',supplier_product_id:'42',
        product_name:'Toy Car Model',scan_result:{}}]});
    const out=await audit('KIR-000007',['42'],{query,loadConfig:async()=>config});
    expect(out).toMatchObject({db_writes:0,provider_api_calls:0});
    expect(out.items[0].prediction.key).toBeNull();
    expect(query.mock.calls.map(c=>c[0].trim().split(/\\s+/)[0])).toEqual(['SELECT','WITH']);
  });
});
