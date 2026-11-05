'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {exactRefs,validateRoots,inspect}=require('../../scripts/recette/hub-v1-fixture-dependency-inventory');
const RUN='ABC12345';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const roots=exactRefs(RUN).map((reference,i)=>({
  id:uuid(i+1),reference,simulation_scope:'E2E-HUB-V1',
  buyer_email:'e2e-hub-v1-abc12345@komerce.test',payment_mode:'cash_relais',
}));
function mockClient({orders=roots,edges=[],children={}}={}){
  const statements=[];
  const client={query:jest.fn(async(sql)=>{
    statements.push(sql);
    if(sql==='BEGIN READ ONLY'||sql==='ROLLBACK')return{rows:[]};
    if(sql.includes('FROM public.orders o JOIN public.users'))return{rows:orders};
    if(sql.includes('FROM pg_constraint c'))return{rows:edges};
    for(const [table,data] of Object.entries(children)){
      if(sql.includes('FROM public."'+table+'"'))return{rows:data};
    }
    throw Error('UNEXPECTED_QUERY:'+sql.slice(0,100));
  })};
  return{client,statements};
}
test('RUN8 + quatre références exactes ; aucun raccourci vers RCT1 ou vrai client',()=>{
  expect(exactRefs(RUN)).toEqual([
    'E2E-HUB-V1-ABC12345-KOM-101','E2E-HUB-V1-ABC12345-KOM-102',
    'E2E-HUB-V1-ABC12345-KOM-103','E2E-HUB-V1-ABC12345-LOCAL',
  ]);
  expect(()=>exactRefs('ABC-12345')).toThrow('HUB_V1_RUN8_INVALID');
  expect(()=>validateRoots([{...roots[0],simulation_scope:null}],RUN))
    .toThrow('HUB_V1_FIXTURE_ROOT_OWNERSHIP_MISMATCH');
  expect(()=>validateRoots([{...roots[0],buyer_email:'real@email.com'}],RUN))
    .toThrow('HUB_V1_FIXTURE_ROOT_OWNERSHIP_MISMATCH');
  expect(()=>validateRoots([roots[0],roots[0]],RUN))
    .toThrow('HUB_V1_FIXTURE_ROOT_OWNERSHIP_MISMATCH');
});
test('graphe FK profondeur 2 : commandes vers lignes puis sous-lignes, sans aucune écriture',async()=>{
  const edge=(parent,child,column)=>({
    constraint_name:'fk_'+parent+'_'+child,
    parent_table:parent,child_table:child,
    parent_columns:['id'],child_columns:[column],child_has_uuid_id:true,
  });
  const {client,statements}=mockClient({
    edges:[edge('orders','order_items','order_id'),
      edge('order_items','purchase_lines','order_item_id')],
    children:{order_items:[{id:uuid(11)}],purchase_lines:[{id:uuid(22)}]},
  });
  const report=await inspect(client,RUN);
  expect(report.verdict).toBe('HOLD_FK_GRAPH_ONLY_NOT_CERTIFIED_FOR_DELETE');
  expect(report.roots).toHaveLength(4);
  expect(report.discovered_tables).toEqual([
    {table:'order_items',count:1},{table:'orders',count:4},{table:'purchase_lines',count:1},
  ]);
  expect(report.delete_performed).toBe(false);
  expect(report.cleanup_certified).toBe(false);
  expect(statements[0]).toBe('BEGIN READ ONLY');
  expect(statements.at(-1)).toBe('ROLLBACK');
  expect(statements.slice(1,-1).every(s=>/^\s*SELECT\b/.test(s))).toBe(true);
  expect(statements.join('\n')).not.toMatch(/\b(DELETE|UPDATE|INSERT|TRUNCATE|DROP)\b/i);
});
test('table sans id UUID = relation opaque et HOLD, pas de suppression silencieuse',async()=>{
  const {client}=mockClient({
    edges:[{constraint_name:'fk_join',parent_table:'orders',
      child_table:'shipment_order_links',child_columns:['order_id'],
      parent_columns:['id'],child_has_uuid_id:false}],
    children:{shipment_order_links:[{n:2}]},
  });
  const report=await inspect(client,RUN);
  expect(report.verdict).toBe('HOLD_OPAQUE_RELATIONS');
  expect(report.opaque_dependencies).toMatchObject([{
    table:'shipment_order_links',rows:2,reason:'NO_UUID_ID_CANNOT_ATTRIBUTE_RECURSIVELY',
  }]);
});
test('même en cas de collision commande réelle, rollback garanti',async()=>{
  const {client,statements}=mockClient({orders:[{...roots[0],simulation_scope:null}]});
  await expect(inspect(client,RUN)).rejects.toThrow('HUB_V1_FIXTURE_ROOT_OWNERSHIP_MISMATCH');
  expect(statements).toEqual(expect.arrayContaining(['BEGIN READ ONLY','ROLLBACK']));
});
test('aucune fixture présente : aucune suppression et aucun GO implicite',async()=>{
  const {client}=mockClient({orders:[]});
  const report=await inspect(client,RUN);
  expect(report.verdict).toBe('EMPTY_FIXTURE_NO_CLEANUP_NEEDED');
  expect(report.roots).toHaveLength(0);
  expect(report.delete_performed).toBe(false);
  expect(report.cleanup_certified).toBe(false);
});
