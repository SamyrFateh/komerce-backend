'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {TARGETS, guard}=require('../../scripts/recette/g13-cj-ready-drafts');
describe('G13 3-category real-source draft guard',()=>{
 test('exact three categories, no manual Hub and no WATCH fallback',()=>{
   expect(TARGETS.map(x=>x.category)).toEqual(['Enfant','Bricolage','Créations personnelles']);
   expect(TARGETS.map(x=>x.subcategory)).toEqual(['École','Outillage','Cadeau']);
   expect(new Set(TARGETS.map(x=>x.candidate_ref)).size).toBe(3);
 });
 const env={GITHUB_ACTIONS:'true',GITHUB_ACTOR:'owner',GITHUB_REPOSITORY_OWNER:'owner',
   KOMERCE_ENV:'staging',EXPECTED_RAILWAY_ENVIRONMENT:'staging',
   STAGING_BASE_URL:'https://komerce-backend-production.up.railway.app',
   PGOPTIONS:'-c default_transaction_read_only=on',G13_DRAFT_SCOPE:'three-source-proven',
   GITHUB_RUN_ID:'43820240455',E2E_ADMIN_EMAIL:'test@example.invalid',E2E_ADMIN_PASSWORD:'test'};
 test('refuses no owner, wrong env, read-write SQL or loose scope',()=>{
   expect(guard(env)).toBe(TARGETS);
   for(const patch of [{GITHUB_ACTOR:'worker'},{KOMERCE_ENV:'production'},
    {PGOPTIONS:''},{G13_DRAFT_SCOPE:'all'},{E2E_ADMIN_EMAIL:''}])
     expect(()=>guard({...env,...patch})).toThrow('G13_CJ_DRAFT_GUARD_REFUSED');
 });
});
