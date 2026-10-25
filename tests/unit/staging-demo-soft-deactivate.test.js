/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {PAIRS,authorize,verifyIdentities,validate}=require('../../scripts/recette/staging-demo-soft-deactivate');
const o={KOMERCE_ENV:'staging',NODE_ENV:'test',STAGING_BASE_URL:'https://komerce-backend-production.up.railway.app',
 KOMERCE_DEMO_DEACTIVATION_CONFIRM:'DISABLE_EXACT_KPR_000084_TO_000091',
 GITHUB_EVENT_NAME:'issues',GITHUB_ACTOR:'owner',GITHUB_REPOSITORY_OWNER:'owner',
 GITHUB_ISSUE_TITLE:'[staging-op] sql-demo-soft-deactivate-eight'};
const roots=PAIRS.map(([product_ref,id])=>({product_ref,id,is_active:true,lifecycle_status:'active',preserved_hash:product_ref}));
test('exact eight stable product refs and UUIDs',()=>{
 expect(PAIRS).toHaveLength(8);
 verifyIdentities(roots);
 expect(()=>verifyIdentities(roots.slice(1))).toThrow();
 expect(()=>verifyIdentities(roots.map((v,i)=>i===0?{...v,id:'wrong'}:v))).toThrow();
});
test('staging owner approval is mandatory for mutation',()=>{
 expect(authorize(o,'--dry-run')).toBe(false);
 expect(authorize(o,'--apply')).toBe(true);
 for(const k of ['KOMERCE_ENV','STAGING_BASE_URL','GITHUB_ACTOR',
   'GITHUB_ISSUE_TITLE','KOMERCE_DEMO_DEACTIVATION_CONFIRM'])
   expect(()=>authorize({...o,[k]:'invalid'},'--apply')).toThrow();
 expect(()=>authorize(o,'--reset')).toThrow();
});
test('a soft deactivation must preserve all other fields and all dependents',()=>{
 const post=roots.map(r=>({...r,is_active:false}));
 expect(validate(roots,post,{orders:2},{orders:2},100,92,true)).toBe(8);
 expect(()=>validate(roots,post,{orders:2},{orders:0},100,92,true)).toThrow();
 expect(()=>validate(roots,post,{},{},100,93,true)).toThrow();
 expect(()=>validate(roots,[{...post[0],preserved_hash:'altered'},...post.slice(1)],{},{},100,92,true)).toThrow();
});
