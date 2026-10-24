/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {verdictOf,verifyRuntimeRevision}=require('../../scripts/recette/p1-staging-evidence');
const ok=['SOURCE_PROVED','REFINERY_PROVED','CATALOG_RELEASE_PROVED','STOREFRONT_PROVED'].map(key=>({key,status:'PROVED'}));
test('P1: all four distinct canonical gates must be proved',()=>{
 expect(verdictOf(ok)).toBe('BACKEND_PROVED');
 expect(verdictOf(ok.slice(0,3))).toBe('NOT_PROVEN');
 expect(verdictOf([...ok.slice(0,3),{...ok[3],status:'NON_PROUVE'}])).toBe('NOT_PROVEN');
 expect(verdictOf([...ok.slice(0,3),{...ok[3],status:'ANOMALIE'}])).toBe('NOT_PROVEN');
 expect(verdictOf([...ok.slice(0,3),ok[0]])).toBe('NOT_PROVEN');
 expect(verdictOf([])).toBe('NOT_PROVEN');
});
test('P1: SHA exact accepted, runtime drift fail closed',()=>{
 const sha='a'.repeat(40);
 expect(verifyRuntimeRevision(sha,sha)).toMatchObject({kind:'EXACT'});
 expect(()=>verifyRuntimeRevision('local',sha)).toThrow('P1_SHA_INVALID');
 expect(()=>verifyRuntimeRevision(sha,'local')).toThrow('P1_SHA_INVALID');
});
