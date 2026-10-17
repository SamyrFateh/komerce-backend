'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db',()=>({query:jest.fn(),pool:{end:jest.fn()}}));
const {assess,inspect}=require('../../scripts/audit-golden-staging-deep-clean');
test('foundation referenced by customs or users blocks plan',()=>{
 const x=assess(['users','customs_shipments'],[{referenced_table:'users',referencing_table:'roles'}],{users:90,roles:2,customs_shipments:2});
 expect(x.decision).toBe('BLOCKED');
 expect(x.foundation_hits).toContain('roles');
});
test('no mutation is performed, and identity remains advisory',async()=>{
 const q={query:jest.fn(async sql=>{
  if(sql.includes('current_database()'))return {rows:[{database_name:'railway',server_ip:'10.1.1.1'}]};
  if(sql.includes('FROM pg_tables'))return {rows:[{tablename:'users'},{tablename:'customs_shipments'}]};
  if(sql.includes('FROM pg_constraint'))return {rows:[]};
  if(sql.includes('count(*)'))return {rows:[{n:'2'}]};
  throw Error(sql);
 })};
 const a=await inspect(q);
 expect(a).toMatchObject({writes:0,table_counts:{users:2,customs_shipments:2}});
 expect(a.warnings.join(' ')).toContain('cannot prove staging');
 expect(q.query.mock.calls.every(([sql])=>/^SELECT\b/i.test(sql.trim()))).toBe(true);
});
