'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {normalize,phrases,probe}=require('../../scripts/cj-deterministic-family-probe');
function row(ref,title,status='REVIEW_REQUIRED',category=null){
 return {ref,title,source_path:'untrusted supplier path',
  v1:{status,category,subcategory:null}};
}
test('normalization keeps numerals: variants cannot masquerade as exact duplicates',()=>{
 expect(normalize('Cable 50FT')).not.toBe(normalize('Cable 100FT'));
 expect(normalize('ÉTUI Phone')).toBe('etui phone');
});
test('merchandising descriptors and generic supplier paths cannot create object authority',()=>{
 expect(phrases('Stainless Steel Cable')).not.toContain('stainless steel');
 expect(phrases('Fast New Portable 2026')).not.toContain('fast new');
});
test('identical lexical anchors remain explicitly unverified without any catalog placement',()=>{
 const rs=probe([row('a','Car Phone Holder Black'),row('b','Phone Holder 360 Rotation'),
  row('c','Dog Food Cabinet')]);
 expect(rs.report.certification).toBe('NOT_CERTIFIED');
 expect(rs.report.counts.products).toBe(3);
 expect(rs.report.counts.products_in_lexical_candidate_families).toBe(2);
 expect(rs.families[0].members.map(x=>x.ref).sort()).toEqual(['a','b']);
 expect(rs.report.upper_bound_not_a_measure.hypothetical_review_actions_if_all_candidates_homogeneous).toBe(2);
 expect(JSON.stringify(rs.report)).not.toContain('precision_pct');
});
test('shared phrase across different objects stays a human-risk candidate, never auto classified',()=>{
 const input=[row('p','Mobile Phone', 'CATEGORY_CLASSIFIED','Tech'),
  row('q','Mobile Phone Lanyard','REVIEW_REQUIRED',null),
  row('r','Mobile Phone Case','CATEGORY_CLASSIFIED','Maison')];
 const rs=probe(input,new Map([['p','tech-phones'],['q','maison-enfants'],['r','tech-phones']]));
 expect(rs.families.some(x=>x.v1_parent_conflict)).toBe(true);
 expect(rs.families.some(x=>x.cross_source_segments)).toBe(true);
 expect(rs.assignments.every(x=>x.lexical_anchor===null||typeof x.lexical_anchor==='string')).toBe(true);
});
test('no evidence of time saved is manufactured from grouped candidate counts',()=>{
 const rs=probe([row('a','Red Formal Dress'),row('b','Blue Formal Dress')]);
 expect(rs.report.constraints.some(x=>x.includes('No labels'))).toBe(true);
 expect(rs.report.upper_bound_not_a_measure.hypothetical_reduction_vs_one_action_per_review_product).toBe(0.5);
});
