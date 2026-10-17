'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db',()=>({query:jest.fn(),pool:{end:jest.fn()}}));
const {gate}=require('../../scripts/audit-golden-post-purge-foundation');
test('read only gate reports preserved mappings and clean transient tables',async()=>{
 const query=jest.fn(async sql=>{
  if(sql.includes('current_database()'))return {rows:[{database_name:'railway',database_user:'test'}]};
  if(sql.includes('FROM pg_tables'))return {rows:['orders','products','sourcing_candidates','supplier_commercial_category_mappings','boutique_categories','boutique_subcategories','business_rules','sourcing_sources'].map(tablename=>({tablename}))};
  if(sql.includes('count(*)::int AS n FROM'))return {rows:[{n:0}]};
  if(sql.includes('GROUP BY provider,status'))return {rows:[{provider:'cjdropshipping',status:'CONFIRMED',n:12},{provider:'aliexpress',status:'CONFIRMED',n:8}]};
  if(sql.includes('AS rangement_active'))return {rows:[{rangement_active:true}]};
  if(sql.includes('WHERE key IN'))return {rows:[{key:'CANONICAL_MARGIN_WRITER_ENABLED',value:{value:1}},{key:'CANONICAL_MARGIN_WRITE_PROVISIONAL',value:{value:0}}]};
  if(sql.includes('AS sources'))return {rows:[{sources:5,autopilot_enabled:0}]};
  throw Error(sql);
 });
 const result=await gate({query});
 expect(result).toMatchObject({gate:'FOUNDATION_READY',writes:0,transient_counts:{orders:0,products:0,sourcing_candidates:0}});
 expect(query.mock.calls.every(([sql])=>/^SELECT\b/i.test(sql.trim()))).toBe(true);
});
test('missing key mapping blocks Golden restart',async()=>{
 const query=jest.fn(async sql=>{
  if(sql.includes('current_database()'))return {rows:[{}]};
  if(sql.includes('FROM pg_tables'))return {rows:[]};
  throw Error(sql);
 });
 const result=await gate({query});
 expect(result.gate).toBe('HOLD');
 expect(result.reasons).toContain('CJ_CONFIRMED_MAPPINGS_MISSING');
});
