/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');
const matrix=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/recette/G6_PRE_STRESS_BUSINESS_SCENARIOS.json'),'utf8'));
const workflow=fs.readFileSync(path.join(ROOT,'.github/workflows/staging-g6-dynamic-fresh-buyer-cash.yml'),'utf8');
const resolver=workflow.split('\n').find(x=>x.includes('G6_CANONICAL_SCENARIO:'))||'';
const isTitle=(id,mk)=>workflow.includes("github.event.issue.title == '[staging-op] g6-dynamic-fresh-full-"+id+'-'+mk+"'");
const hasBranch=id=>resolver.includes("contains(github.event.issue.title, '-full-"+id+"-') && '"+id+"'");
const alias=x=>{
 if(x.id==='M04')return [{id:'M01',markets:['CM']}];
 if(x.id==='M05')return [{id:'M01',markets:['CG']}];
 if(x.id==='N26')return ['N26a','N26b'].map(id=>({id,markets:x.markets}));
 if(x.id==='N39')return ['N39F1','N39F2','N39F3'].map(id=>({id,markets:x.markets}));
 return [{id:x.id,markets:x.markets}];
};
describe('G6 — 46 scenarios: matrix → true workflow dispatch and declared blockers',()=>{
 test('the business source remains exactly M01-M06 + N01-N40, no shadow registry',()=>{
  expect(matrix.scenarios.map(x=>x.id)).toEqual([
   ...Array.from({length:6},(_,i)=>'M'+String(i+1).padStart(2,'0')),
   ...Array.from({length:40},(_,i)=>'N'+String(i+1).padStart(2,'0'))
  ]);
  expect(new Set(matrix.scenarios.map(x=>x.id)).size).toBe(46);
 });
 test('44 implemented dispatch mappings, with M06/N34 deliberately BLOCKED until central-Hub product is screen-certified',()=>{
  const blocked=['M06','N34'];
  const wired=matrix.scenarios.filter(x=>!blocked.includes(x.id));
  expect(wired).toHaveLength(44);
  for(const scenario of wired){
   for(const caseId of alias(scenario)){
    for(const market of caseId.markets)
     expect(isTitle(caseId.id,market)).toBe(true);
    // The buyer orchestrator must receive the real ID. Otherwise the issue
    // title can be accepted while the job silently runs default M01.
    if(caseId.id!=='M01')expect(hasBranch(caseId.id)).toBe(true);
   }
  }
  for(const id of blocked){
   for(const market of matrix.scenarios.find(x=>x.id===id).markets)
    expect(isTitle(id,market)).toBe(false);
  }
 });
 test('N39 phases, N26 branches and G5A route/SOI options are never replaced by M01 fallback',()=>{
  for(const id of ['N39F1','N39F2','N39F3','N26a','N26b','N01','N02','N03','N05','N06'])
   expect(hasBranch(id)).toBe(true);
  for(const mk of ['KM','CM','CG']){
   expect(isTitle('N03-ROUTE',mk)).toBe(true);
   expect(isTitle('N05-SOI',mk)).toBe(true);
  }
  expect(workflow).toMatch(/G6_G5A_NEGATIVE_BRANCH:.*ROUTE_MISSING.*SOI_INCOMPLETE/);
  expect(resolver).toContain("|| 'M01' }}");
  for(const id of ['N39F1','N39F2','N39F3'])
   expect(resolver.indexOf("'-full-"+id+"-'")).toBeLessThan(resolver.lastIndexOf("|| 'M01'"));
 });
 test('strict owner-only staging guard and shared serialization cannot regress',()=>{
  expect(workflow).toContain("github.actor == github.repository_owner");
  expect(workflow).toContain("github.event.issue.user.login == github.repository_owner");
  expect(workflow).toContain("group: komerce-g6-canonical-real-transaction");
  expect(workflow).toContain("cancel-in-progress: false");
  expect(workflow).toContain("node scripts/recette/target-guard.js");
  expect(workflow).toContain("E2E_EXPECTED_DEPLOY_SHA");
  expect(workflow).toContain("node scripts/recette/g6-negative-g5a-storefront-chromium.js");
  expect(workflow).toContain("node scripts/recette/g6-negative-n06-price-changed-chromium.js");
  expect(workflow).toContain("node scripts/recette/g6-dynamic-buyer-cash.js");
 });
});
