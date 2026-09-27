'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db',()=>({pool:{end:jest.fn()}}));
jest.mock('pg',()=>({Pool:jest.fn()}));
jest.mock('../../scripts/catalog-712-transfer',()=>({
  assertRuntime:jest.fn(()=>({source_host:'ali-e2e-200-postgres.railway.internal',dest_host:'postgres.railway.internal'})),
  loadBundle:jest.fn(),
}));

const audit=require('../../scripts/catalog-712-production-readonly-audit');
const transfer=require('../../scripts/catalog-712-transfer');
const {Pool}=require('pg');

describe('catalog 712 production readonly audit',()=>{
  test('summarize counts ready rows without mutating',()=>{
    const row={
      supplier_name:'AliExpress',supplier_product_id:'a1',state:'imported_to_catalog',
      product_id:1,decision:'TEST',lifecycle_status:'candidate',is_active:false,
      content_source:'manual',needs_review:false,boutique_category_key:'Tech',
      boutique_subcategory_key:'Audio',media_count:1,active_skus:1,complete_skus:1,
      enabled_markets:0,
    };
    expect(audit.summarize([row],1)).toEqual(expect.objectContaining({
      expected:1,rows:1,distinct_supplier_identities:1,distinct_product_ids:1,
      imported_to_catalog:1,ready:1,enabled_market_exposure:0,rejected_or_excluded:0,
    }));
  });

  test('run derives exact supplier ids from certified bundle then reads destination',async()=>{
    transfer.loadBundle.mockResolvedValue({
      total:712,
      products:[
        ...Array.from({length:200},(_,i)=>({supplier_name:'AliExpress',supplier_product_id:`ali-${i+1}`})),
        ...Array.from({length:512},(_,i)=>({supplier_name:'CJdropshipping',supplier_product_id:`cj-${i+1}`})),
      ],
    });
    const query=jest.fn()
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[]});
    const end=jest.fn();
    Pool.mockImplementation(()=>({query,end}));

    const out=await audit.run({
      DATABASE_URL:'postgres://u:p@ali-e2e-200-postgres.railway.internal:5432/source',
      KOMERCE_CATALOG_DEST_DATABASE_URL:'postgres://u:p@Postgres.railway.internal:5432/prod',
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][1][1]).toHaveLength(200);
    expect(query.mock.calls[1][1][1]).toHaveLength(512);
    expect(out.source_bundle_total).toBe(712);
    expect(out.total.expected).toBe(712);
    expect(out.writes).toBe(false);
    expect(end).toHaveBeenCalled();
  });
});
