/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {authorize,validateEvolution}=require('../../scripts/recette/p1-one-sourced-inactive-draft');
const ctx={KOMERCE_ENV:'staging',NODE_ENV:'test',
 STAGING_BASE_URL:'https://komerce-backend-production.up.railway.app',
 P1_DRAFT_SINGLE_APPROVAL:'APPROVE_INACTIVE_ONLY_KIR_000009',
 GITHUB_EVENT_NAME:'issues',GITHUB_ACTOR:'owner',GITHUB_REPOSITORY_OWNER:'owner',
 GITHUB_ISSUE_TITLE:'[staging-op] p1-promote-one-sourced-inactive-draft'};
test('only exact owner-triggered staging operation can promote one draft',()=>{
 expect(authorize(ctx,'--preview')).toBe(false);
 expect(authorize(ctx,'--apply')).toBe(true);
 for(const k of ['KOMERCE_ENV','STAGING_BASE_URL','P1_DRAFT_SINGLE_APPROVAL',
  'GITHUB_ACTOR','GITHUB_ISSUE_TITLE'])
   expect(()=>authorize({...ctx,[k]:'INVALID'},'--apply')).toThrow();
});
test('snapshot is immutable, deferred->ready transition requires 2 historical events',()=>{
 const changed='5e655aea-6b8d-46a9-8465-f0395d67fb02';
 const run={run_ref:'KIR-000009',provider:'AliExpress',source_type:'api',
   intake:{pipeline_status:'CANONICAL_RESOLVED',ready_for_refinery:12},
   finished_at:'2026-10-18T16:26:04Z'};
 const candidates=Array.from({length:13},(_,i)=>({id:i===12?changed:String(i),
   state:'scanned',supplier_name:'AliExpress',supplier_product_id:String(i),
   raw_payload:{id:i},normalized_source_contract:{schema_version:'2'},
   scan_result:{sourcing_decision:'TEST'}}));
 const items=candidates.map((c,i)=>({candidate_id:c.id,
   outcome:i===12?'deferred':'ready_for_refinery'}));
 const events=[
   {candidate_id:changed,event_type:'data_correction',
    changes:{komerce_category:{before:null,after:'tech'}},created_at:'2026-10-18T16:31:50Z'},
   {candidate_id:changed,event_type:'scan',
    result:{sourcing_decision:'TEST'},created_at:'2026-10-18T16:31:50Z'}
 ];
 expect(validateEvolution(run,candidates,items,events).delta).toBe(1);
 expect(()=>validateEvolution(run,candidates,items,events.slice(0,1))).toThrow();
 expect(()=>validateEvolution({...run,intake:{...run.intake,ready_for_refinery:13}},
   candidates,items,events)).toThrow();
});
