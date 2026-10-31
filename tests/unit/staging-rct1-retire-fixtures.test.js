/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const { REFS, ISSUE, authorize, verifyRoots, verifyPreserved, inspectOutsideOrders } =
  require('../../scripts/recette/staging-rct1-retire-fixtures');

const env = { KOMERCE_ENV:'staging', NODE_ENV:'test',
  STAGING_BASE_URL:'https://komerce-backend-production.up.railway.app',
  GITHUB_EVENT_NAME:'issues', GITHUB_ACTOR:'owner', GITHUB_REPOSITORY_OWNER:'owner',
  GITHUB_ISSUE_TITLE:ISSUE, RCT1_RETIRE_CONFIRM:'RETIRE_EXACT_RCT1_P1_TO_P5' };
const roots = REFS.map((product_ref,i)=>({
  product_ref, id:'00000000-0000-0000-0000-'+String(i+1).padStart(12,'0'),
  name:'Produit (recette RCT1)', description:'Fictif recette RCT1',
  is_active:true, is_available:true, preserved_hash:product_ref
}));
test('only five exact RCT1 product identities, never sourced KPR products',()=>{
  expect(REFS).toEqual(['RCT1-P1','RCT1-P2','RCT1-P3','RCT1-P4','RCT1-P5']);
  expect(()=>verifyRoots(roots)).not.toThrow();
  expect(()=>verifyRoots([...roots,{...roots[0],product_ref:'KPR-000084'}])).toThrow();
  expect(()=>verifyRoots(roots.map((v,i)=>i===0?{...v,name:'Vrai produit CJ'}:v))).toThrow();
});
test('writes restricted to confirmed staging owner operation',()=>{
  expect(authorize(env,'--dry-run')).toBe(false);
  expect(authorize(env,'--apply')).toBe(true);
  for(const k of ['KOMERCE_ENV','STAGING_BASE_URL','GITHUB_EVENT_NAME','GITHUB_ACTOR',
      'GITHUB_ISSUE_TITLE','RCT1_RETIRE_CONFIRM'])
    expect(()=>authorize({...env,[k]:'wrong'},'--apply')).toThrow();
  expect(()=>authorize({...env,NODE_ENV:'production'},'--apply')).toThrow();
  expect(()=>authorize(env,'--purge')).toThrow();
});
test('archive preserves every product field outside publication flags',()=>{
  const retired=roots.map(p=>({...p,is_active:false,is_available:false}));
  expect(()=>verifyPreserved(roots,retired,true)).not.toThrow();
  expect(()=>verifyPreserved(roots,roots,false)).not.toThrow();
  expect(()=>verifyPreserved(roots,retired,false)).toThrow();
  expect(()=>verifyPreserved(roots,roots,true)).toThrow();
  expect(()=>verifyPreserved(roots,[{...retired[0],preserved_hash:'changed'},...retired.slice(1)],true)).toThrow();
});
test('reject real order linkage and parameterize exact UUIDs', async()=>{
  const db={query:jest.fn(async()=>({rows:[{product_ref:'RCT1-P1',outside_order_lines:1}]}))};
  const rows=await inspectOutsideOrders(db,[roots[0].id]);
  expect(rows).toHaveLength(1);
  const [sql,params]=db.query.mock.calls[0];
  expect(sql).toMatch(/simulation_scope IS DISTINCT FROM 'RCT1'/);
  expect(sql).toMatch(/ANY\(\$1::uuid\[\]\)/);
  expect(params).toEqual([[roots[0].id]]);
  expect(await inspectOutsideOrders(db,[])).toEqual([]);
  expect(db.query).toHaveBeenCalledTimes(1);
});
