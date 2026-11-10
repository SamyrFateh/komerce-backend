'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {makeOwnership,scanLinks,ident}=require('../../scripts/recette/hub-v1-orphan-refs-preview');
const UUID=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const run='71B671EB';
function inventory({other=[],supplierIds=[UUID(1),UUID(2)],sourceId='api:whatsapp:E2E-HUB-V1-71B671EB',roots=[]}={}){
  return {
    run,roots,verdict:'HOLD_ORPHANED_FIXTURE_ROOTS',external_fixture_consumers:[],
    owned_roots_outside_fk_graph:[
      {table:'suppliers',count:supplierIds.length,ids:supplierIds,truncated:false,invalid_ids:0},
      {table:'sourcing_sources',count:1,ids:[sourceId],truncated:false,invalid_ids:0},
      ...other,
    ],
  };
}
test('deux fournisseurs et une source par RUN8 orphelin exactement',()=>{
  const own=makeOwnership([{run8:run}], [inventory()]);
  expect(own.supplierIds).toEqual([UUID(1),UUID(2)]);
  expect(own.sourceIds).toEqual(['api:whatsapp:E2E-HUB-V1-'+run]);
  expect(own.counts).toEqual([{run8:run,suppliers:2,sources:1}]);
});
test('refuse commandes présentes, racines inattendues, source étrangère et id invalide',()=>{
  const marker=[{run8:run}];
  for(const bad of [
    inventory({roots:[{id:UUID(9)}]}),
    inventory({other:[{table:'products',count:1,ids:[UUID(3)]}]}),
    inventory({sourceId:'api:whatsapp:OTHER'}),
    inventory({supplierIds:['not-a-uuid',UUID(2)]}),
    inventory({supplierIds:[UUID(1)]}),
  ]) expect(()=>makeOwnership(marker,[bad])).toThrow();
  expect(()=>ident('users;DROP TABLE')).toThrow('ORPHAN_PREVIEW_UNSAFE_SQL_IDENTIFIER');
});
function fakeClient({linked=0,triggered=false}={}){
  const queries=[];
  return {
    queries,
    query:jest.fn(async(sql,params=[])=>{
      queries.push(sql);
      if(sql.includes('SELECT id::text AS id,name FROM suppliers')) return{rows:[
        {id:UUID(1),name:'E2E-HUB-V1-71B671EB-SUP-01'},
        {id:UUID(2),name:'E2E-HUB-V1-71B671EB-SUP-02'}]};
      if(sql.includes('FROM pg_constraint c')) return {rows:[{
        parent_table:'suppliers',child_table:'purchase_lines',constraint_name:'purchase_supplier_fk',
        parent_columns:['id'],child_columns:['supplier_id'],
      }]};
      if(sql.includes('FROM information_schema.columns'))return{rows:[
        {table_name:'purchase_lines',column_name:'supplier_id',udt_name:'uuid'},
        {table_name:'sourcing_observations',column_name:'source_id',udt_name:'text'},
      ]};
      if(sql.includes('FROM pg_trigger'))return{rows:triggered?[{table_name:'suppliers',trigger_name:'no_delete'}]:[]};
      if(sql.includes('FROM public."purchase_lines"'))return{rows:linked?[{marker:UUID(1),n:linked}]:[]};
      if(sql.includes('FROM public."sourcing_observations"'))return{rows:[]};
      throw Error('UNEXPECTED_SQL:'+sql.slice(0,120));
    })
  };
}
test('scan lit les FK et colonnes source sans supprimer et détecte les références réelles',async()=>{
  const own=makeOwnership([{run8:run}],[inventory()]);
  const c=fakeClient({linked:2});
  const out=await scanLinks(c,own);
  expect(out.refs).toEqual([{run8:run,table:'purchase_lines',column:'supplier_id',relation:'FOREIGN_KEY',rows:2}]);
  expect(out.fk_edges_checked).toBe(1);
  expect(c.queries.filter(s=>s.includes('FROM public."purchase_lines"'))).toHaveLength(1);
  expect(c.queries.every(sql=>/^\s*SELECT\b/.test(sql))).toBe(true);
  expect(out.trigger_tables).toEqual([]);
});
test('une table cible avec trigger DELETE devient un HOLD visible',async()=>{
  const own=makeOwnership([{run8:run}],[inventory()]);
  const out=await scanLinks(fakeClient({triggered:true}),own);
  expect(out.trigger_tables).toEqual(['suppliers']);
});
