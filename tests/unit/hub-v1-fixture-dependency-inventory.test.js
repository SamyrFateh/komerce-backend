'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {exactRefs,validateRoots,inspect,buildCleanupInventory}=require('../../scripts/recette/hub-v1-fixture-dependency-inventory');
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

function cleanupClient({orders=roots, owned={}, fkEdges=[], graphEdges=[], children={}, immutable=[], externalConsumers={}}={}) {
  const statements=[];
  const client={query:jest.fn(async(sql)=>{
    statements.push(sql);
    if(sql.startsWith('BEGIN TRANSACTION')||sql==='ROLLBACK')return{rows:[]};
    if(sql.includes('FROM public.orders o JOIN public.users'))return{rows:orders};
    if(sql.includes('FROM pg_constraint c')&&sql.includes('array_to_json'))return{rows:graphEdges};
    if(sql.includes('FROM pg_constraint c')&&sql.includes('AS delete_rule'))return{rows:fkEdges};
    if(sql.includes('FROM pg_trigger t'))return{rows:immutable};
    // Every scalar SQL count returns exactly one row, as PostgreSQL does.
    if(sql.includes('COUNT(*)::int AS n FROM order_items oi'))return{rows:[{n:externalConsumers.products||0}]};
    if(sql.includes('COUNT(*)::int AS n FROM orders o JOIN relais r'))return{rows:[{n:externalConsumers.relais||0}]};
    if(sql.includes('COUNT(*)::int AS n FROM orders o JOIN users u'))return{rows:[{n:externalConsumers.users||0}]};
    if(sql.includes('COUNT(*)::int AS n FROM purchase_lines pl'))return{rows:[{n:externalConsumers.purchase_orders||0}]};
    for(const [table, rows] of Object.entries(children)){
      if(sql.includes('FROM public."'+table+'"'))return{rows};
    }
    for(const [table, data] of Object.entries(owned)){
      const tableQuery={
        users:'FROM users WHERE lower(email)',relais:'FROM relais WHERE name =',
        suppliers:'FROM suppliers WHERE name LIKE',products:'FROM products WHERE product_ref LIKE',
      }[table];
      if(tableQuery&&sql.includes(tableQuery))return{rows:data};
    }
    if(/^\s*SELECT\b/.test(sql))return{rows:[]};
    throw Error('UNEXPECTED_NON_READ_QUERY:'+sql);
  })};
  return{client,statements};
}

test('inventaire complet : une seule photographie READ ONLY, racines hors FK, preuve immuable et empreinte',async()=>{
  const immutable=[{table_name:'orders',trigger_name:'order_evidence_no_delete',on_delete:true,on_update:false}];
  const {client,statements}=cleanupClient({
    owned:{users:[{id:uuid(10)}],relais:[{id:uuid(11)}],products:[{id:uuid(12)}]},
    immutable,
  });
  const report=await buildCleanupInventory(client,RUN);
  expect(report.verdict).toBe('HOLD_IMMUTABLE_PROOFS_RETAINED');
  expect(report.cleanup_strategy.decision).toBe('RETAIN_FIXTURE_PREFIX_NO_DELETE');
  expect(report.cleanup_strategy.immutable_tables).toContain('orders');
  expect(report.owned_roots_outside_fk_graph).toEqual(expect.arrayContaining([
    expect.objectContaining({table:'users',count:1,ids:[uuid(10)]}),
    expect.objectContaining({table:'products',count:1,ids:[uuid(12)]}),
  ]));
  expect(report.snapshot_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(report.cleanup_scope_checks).toMatchObject({
    exact_roots:true,no_opaque_fk:true,no_truncation:true,valid_owned_root_ids:true,
  });
  expect(report.delete_performed).toBe(false);
  expect(report.cleanup_certified).toBe(false);
  expect(statements.filter(x=>x.startsWith('BEGIN'))).toEqual(['BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY']);
  expect(statements.filter(x=>x==='ROLLBACK')).toHaveLength(1);
  expect(statements.slice(1,-1).every(x=>/^\s*SELECT\b/.test(x))).toBe(true);
});

test('racines orphelines après interruption : HOLD et aucun cleanup même sans commande',async()=>{
  const {client}=cleanupClient({orders:[],owned:{products:[{id:uuid(12)}]}});
  const report=await buildCleanupInventory(client,RUN);
  expect(report.roots).toHaveLength(0);
  expect(report.verdict).toBe('HOLD_ORPHANED_FIXTURE_ROOTS');
  expect(report.cleanup_strategy.decision).toBe('HOLD_DISCOVERY_ONLY_NO_APPLY');
  expect(report.cleanup_certified).toBe(false);
});

test('pas de trigger apparent != DELETE autorisé ; inventaire seul = HOLD',async()=>{
  const {client}=cleanupClient();
  const report=await buildCleanupInventory(client,RUN);
  expect(report.cleanup_strategy.decision).toBe('HOLD_DISCOVERY_ONLY_NO_APPLY');
  expect(report.verdict).toBe('HOLD_FK_GRAPH_ONLY_NOT_CERTIFIED_FOR_DELETE');
  expect(report.cleanup_certified).toBe(false);
});

test('identifiants invalides ou inventaire tronqué = garde fail closed',async()=>{
  const big=Array.from({length:2501},(_,i)=>({id:uuid(i+1000)}));
  const {client}=cleanupClient({owned:{users:big,products:[{id:'INVALID UUID WITH SPACES'}]}});
  const report=await buildCleanupInventory(client,RUN);
  expect(report.verdict).toBe('HOLD_INCOMPLETE_OWNERSHIP_INVENTORY');
  expect(report.cleanup_scope_checks.no_truncation).toBe(false);
  expect(report.cleanup_scope_checks.valid_owned_root_ids).toBe(false);
  expect(report.owned_roots_outside_fk_graph.find(x=>x.table==='users').ids).toHaveLength(2500);
  expect(report.cleanup_certified).toBe(false);
});

test('workflow d’inventaire conserve le SHA staging vérifié et reste read only',()=>{
  const fs=require('fs');const path=require('path');
  const y=fs.readFileSync(path.join(__dirname,'../../.github/workflows/hub-v1-fixture-dependency-inventory.yml'),'utf8');
  expect(y).toContain('fetch-depth: 0');
  expect(y).toContain('node scripts/recette/resolve-staging-deploy-pin.js');
  expect(y).toContain('node scripts/recette/hub-v1-fixture-dependency-inventory.js');
  expect(y).not.toContain('E2E_EXPECTED_DEPLOY_SHA=$(git rev-parse HEAD)');
  expect(y).not.toMatch(/TRUNCATE|DELETE FROM|session_replication_role/);
});


test('une dependance differente avec le MEME nombre de lignes change l empreinte du manifeste',async()=>{
  const edge={constraint_name:'order_items_order_fk',parent_table:'orders',
    child_table:'order_items',child_columns:['order_id'],parent_columns:['id'],
    child_has_uuid_id:true};
  const first=cleanupClient({graphEdges:[edge],children:{order_items:[{id:uuid(101)}]}});
  const second=cleanupClient({graphEdges:[edge],children:{order_items:[{id:uuid(102)}]}});
  const a=await buildCleanupInventory(first.client,RUN);
  const b=await buildCleanupInventory(second.client,RUN);
  expect(a.discovered_tables).toEqual(b.discovered_tables);
  expect(a.discovered_tables).toContainEqual({table:'order_items',count:1});
  expect(a.dependency_identity_fingerprints.find(x=>x.table==='order_items').ids_sha256)
    .not.toBe(b.dependency_identity_fingerprints.find(x=>x.table==='order_items').ids_sha256);
  expect(a.snapshot_sha256).not.toBe(b.snapshot_sha256);
  expect(a.cleanup_certified).toBe(false);
  expect(b.cleanup_certified).toBe(false);
  expect(first.statements.filter(x=>x==='ROLLBACK')).toHaveLength(1);
  expect(second.statements.filter(x=>x==='ROLLBACK')).toHaveLength(1);
});

test('trigger de preuve immuable seulement dans enfant FK potentiel impose RETAIN sans aucun DELETE',async()=>{
  const fks=[{parent_table:'orders',child_table:'hub_v1_append_only_evidence',constraint_name:'evidence_fk',delete_rule:'a'}];
  const triggers=[{table_name:'hub_v1_append_only_evidence',trigger_name:'no_delete_evidence',on_delete:true,on_update:false}];
  const {client,statements}=cleanupClient({fkEdges:fks,immutable:triggers});
  const report=await buildCleanupInventory(client,RUN);
  expect(report.verdict).toBe('HOLD_IMMUTABLE_PROOFS_POTENTIAL');
  expect(report.cleanup_strategy.decision).toBe('RETAIN_FIXTURE_PREFIX_NO_DELETE');
  expect(report.cleanup_strategy.immutable_tables_potential_children).toContain('hub_v1_append_only_evidence');
  expect(report.cleanup_strategy.delete_performed).toBe(false);
  expect(report.cleanup_certified).toBe(false);
  expect(statements.slice(1,-1).every(x=>/^\s*SELECT\b/.test(x))).toBe(true);
});

test('un produit ou relais de recette utilisé par un dossier étranger impose HOLD_SHARED_FIXTURE_PARENTS',async()=>{
  const clean=cleanupClient();
  const borrowed=cleanupClient({externalConsumers:{products:1,relais:2}});
  const before=await buildCleanupInventory(clean.client,RUN);
  const after=await buildCleanupInventory(borrowed.client,RUN);
  expect(before.cleanup_scope_checks.no_external_fixture_consumers).toBe(true);
  expect(after.cleanup_scope_checks.no_external_fixture_consumers).toBe(false);
  expect(after.external_fixture_consumers).toEqual([
    {parent:'products',external_rows:1},
    {parent:'relais',external_rows:2},
    {parent:'users',external_rows:0},
    {parent:'purchase_orders',external_rows:0},
  ]);
  expect(after.verdict).toBe('HOLD_SHARED_FIXTURE_PARENTS');
  expect(after.cleanup_strategy.decision).toBe('RETAIN_FIXTURE_PREFIX_NO_DELETE');
  expect(after.cleanup_certified).toBe(false);
  expect(after.delete_performed).toBe(false);
  expect(before.snapshot_sha256).not.toBe(after.snapshot_sha256);
  expect(borrowed.statements.filter(x=>x==='ROLLBACK')).toHaveLength(1);
  expect(borrowed.statements.slice(1,-1).every(x=>/^\s*SELECT\b/.test(x))).toBe(true);
});

test('les consommateurs externes restent strictement des comptages non identifiants',async()=>{
  const {client,statements}=cleanupClient({externalConsumers:{users:1,purchase_orders:3}});
  const out=await buildCleanupInventory(client,RUN);
  expect(out.verdict).toBe('HOLD_SHARED_FIXTURE_PARENTS');
  expect(out.external_fixture_consumers).toEqual(expect.arrayContaining([
    {parent:'users',external_rows:1},{parent:'purchase_orders',external_rows:3},
  ]));
  const serialized=JSON.stringify(out.external_fixture_consumers);
  expect(serialized).not.toContain('email');
  expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  expect(statements.join('\n')).not.toMatch(/\b(DELETE|TRUNCATE|UPDATE|DROP)\b/i);
});
