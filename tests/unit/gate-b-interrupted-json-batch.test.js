'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db',()=>({query:jest.fn(),getClient:jest.fn()}));
const db=require('../../db');
const connector=require('../../services/suppliers/connectors/json-connector');
const {importJsonCatalog}=require('../../services/suppliers/catalog-import-json');
describe('Gate B interrupted refinery batch — production JSON transaction seam',()=>{
 test('staging failure rolls back atomically and leaves durable FAILED batch evidence',async()=>{
  const profile={profile_id:'GATE_B',profile_version:1,supplier_name:'GateB',source_type:'json',currency:{default:'USD',resolution_policy:'SOURCE_THEN_DEFAULT',allowed:['USD']},identity:{supplier_id_field:'id'},media:{gallery_source_field:'images',thumbnail_fallback:true},weight:{source_field:'weight',source_unit:null,target_unit:'kg',unknown_unit_policy:'PRESERVE_RAW_AND_OMIT'},policies:{unsupported_video:'QUARANTINE_PRODUCT',lossy_mapping:'QUARANTINE_PRODUCT',duplicate_relation:'DEDUPLICATE_AND_AUDIT',asset_reuse:'ALLOW_AND_AUDIT',missing_brand:'ALLOW_NULL',missing_image:'ALLOW_WITH_WARNING',unknown_fields:'PRESERVE_RAW'},batch:{max_products:5000,max_file_bytes:20000000,allow_empty_products:false,max_invalid_pct:30,max_quarantined_pct:50,max_field_bytes:65536,max_depth:12}};
  const source={products:[{id:'p1',title:'Product one',price:10,stock:1,images:['https://example.test/p1.jpg']}]};
  const pre=connector.preflight({source,import_profile:profile});
  expect(pre.profile.supplier_name).toBe('GateB');
  db.query.mockResolvedValueOnce({rows:[{id:'batch-1'}]}).mockResolvedValueOnce({rows:[]});
  const calls=[];
  const client={query:jest.fn(async(sql)=>{calls.push(sql);if(/^BEGIN/.test(sql))return {rows:[]};if(/INSERT INTO sourcing_candidates/.test(sql))throw Object.assign(new Error('injected staging crash'),{code:'INJECTED_CRASH'});if(/^ROLLBACK/.test(sql))return {rows:[]};return {rows:[]};}),release:jest.fn()};
  db.getClient.mockResolvedValue(client);
  const result=await importJsonCatalog({supplier_name:'GateB',source_type:'json',import_profile:profile,source},null);
  expect(result).toMatchObject({status:500,body:{import_id:'batch-1',status:'FAILED'}});
  expect(calls).toContain('BEGIN');
  expect(calls).toContain('ROLLBACK');
  expect(calls).not.toContain('COMMIT');
  expect(db.query.mock.calls[1][0]).toMatch(/SET status='FAILED'/);
  expect(db.query.mock.calls[1][1]).toEqual(['batch-1','INJECTED_CRASH','injected staging crash']);
  expect(client.release).toHaveBeenCalled();
 });
});
