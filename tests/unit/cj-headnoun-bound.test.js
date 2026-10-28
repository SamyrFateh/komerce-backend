'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {bound}=require('../../scripts/cj-headnoun-bound');
const entry=(ref,split,title,segment,status='REVIEW_REQUIRED')=>({
 ref,split,title,segment,root:'Electronics',source_path:'Electronics > Misc',
 v1:{status,category:null,subcategory:null}});
test('only A-priority keys selected, B never chooses a family',()=>{
 const A=[entry('A1','A','Phone Case','segment-a'),entry('A2','A','Blue Phone Case','segment-b')];
 const B=[entry('B1','B','Black Phone Case','segment-z'),
  entry('B2','B','Computer Sleeve','segment-z')];
 const r=bound([...A,...B],3);
 expect(r).toMatchObject({A_products:2,A_eligible_families:1,
   B_review_products:2,B_potential_reuse_review:1,B_review_max_coverage_rate:.5});
 expect(r.certification).toBe('NOT_CERTIFIED');
 expect(r.reused_review_matches.map(x=>x.ref)).toEqual(['B1']);
});
test('no A repeating family means zero transfer even when B repeats itself',()=>{
 const rows=[entry('A1','A','Phone Case','s1'),
   entry('B1','B','Black Phone Case','s2'),entry('B2','B','Blue Phone Case','s3')];
 const r=bound(rows,3);
 expect(r.A_eligible_families).toBe(0);
 expect(r.B_potential_reuse_review).toBe(0);
 expect(r.decision).toBe('NO_GO_UNDER_OPUS_25_PERCENT_REUSE_THRESHOLD');
});
test('A threshold is fixed and invalid thresholds are rejected',()=>{
 expect(()=>bound([],0)).toThrow('INVALID_PREDECLARED_THRESHOLD');
 expect(()=>bound([],1.5)).toThrow('INVALID_PREDECLARED_THRESHOLD');
});
test('sensitivity cannot assert production accuracy or reviewer savings',()=>{
 const r=bound([entry('A1','A','Phone Case','s1'),
   entry('A2','A','Blue Phone Case','s2'),entry('B1','B','Blue Phone Case','s3')],2);
 expect(r).not.toHaveProperty('measured_precision');
 expect(r.notes.some(note=>note.includes('NOT measured'))).toBe(true);
});
