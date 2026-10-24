/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {verdictOf}=require('../../scripts/recette/p1-staging-evidence');
test('P1 four canonical gates must all be proved',()=>{
 expect(verdictOf([{status:'PROVED'},{status:'PROVED'},{status:'PROVED'},{status:'PROVED'}])).toBe('BACKEND_PROVED');
 expect(verdictOf([{status:'PROVED'},{status:'NON_PROUVE'}])).toBe('NOT_PROVEN');
 expect(verdictOf([{status:'ANOMALIE'}])).toBe('NOT_PROVEN');
 expect(verdictOf([])).toBe('NOT_PROVEN');
});
