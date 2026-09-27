'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {recordPageSuccess,recordError}=require('../../services/suppliers/catalog-sync-checkpoint');
describe('Gate A real checkpoint seam',()=>{
 test('successful page advances to exactly next page and preserves resume evidence',async()=>{
  const q={query:jest.fn().mockResolvedValueOnce({rows:[{next_page:4,completed:false,last_request_id:'req-3'}]})};
  const row=await recordPageSuccess(q,{supplierName:'CJdropshipping',syncKey:'gate-a',categoryId:'cat',page:3,totalPages:5,totalRecords:500,accepted:100,requestId:'req-3'});
  expect(row.next_page).toBe(4); expect(q.query.mock.calls[0][0]).toContain('next_page = $4');
 });
 test('failure records error without advancing checkpoint',async()=>{
  const q={query:jest.fn().mockResolvedValueOnce({rows:[]})};
  await recordError(q,{supplierName:'AliExpress',syncKey:'gate-a',categoryId:'feed',error:'HTTP 429'});
  const sql=q.query.mock.calls[0][0]; expect(sql).toContain('last_error = $4'); expect(sql).not.toContain('next_page =');
 });
});
