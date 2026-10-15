'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db',()=>({query:jest.fn(),pool:{end:jest.fn()}}));
const {inspect}=require('../../scripts/audit-kir-commercial-category-preview');

test('commercial proposal is separated from an unresolved customs decision',async()=>{
  const result=await inspect('KIR-000007',['1005010574838342'],{
    audit:jest.fn().mockResolvedValue({run_ref:'KIR-000007',missing_supplier_product_ids:[],items:[
      {candidate_ref:'KSC-000128',supplier_product_id:'1005010574838342',
        title:'Car Zinc Alloy Leather Key Case Cover',saved_customs_category:null,prediction:{key:null}},
    ]}),
    resolve:jest.fn().mockResolvedValue({category:'auto',subcategory:'accessoires'}),
    query:{query:jest.fn()},
  });
  expect(result.items[0].commercial_proposal).toEqual({
    category:'auto',subcategory:'accessoires',status:'PROPOSED_NOT_APPLIED',
  });
  expect(result.items[0]).toMatchObject({customs_validated:false,safe_to_promote:false,customs_category:null});
  expect(result.db_writes).toBe(0);
});
test('unknown commercial identity remains human review, never forced',async()=>{
  const result=await inspect('KIR-000007',['2'],{
    audit:async()=>({run_ref:'KIR-000007',missing_supplier_product_ids:[],items:[{
      candidate_ref:'KSC-000138',supplier_product_id:'2',title:'Unknown',
      saved_customs_category:null,prediction:{key:null},
    }]}),
    resolve:async()=>({category:null,subcategory:null}),
    query:{query:jest.fn()},
  });
  expect(result.items[0].commercial_proposal.status).toBe('REVIEW_REQUIRED');
  expect(result.items[0].safe_to_promote).toBe(false);
});
