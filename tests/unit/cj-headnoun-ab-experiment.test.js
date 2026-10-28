'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {keyFromTitle,buildA,emitTrain,freeze,evaluateB,wilson,
 parseCSV,CSV_HEAD}=require('../../scripts/cj-headnoun-ab-experiment');
const entry=(ref,split,title,v1Status='REVIEW_REQUIRED')=>({
 ref,split,title,segment:ref,root:'Home',source_path:'Home > misc',
 v1:{status:v1Status,category:null,subcategory:null}});
test('Opus test examples resolve noun before modifier, not color/material',()=>{
 expect(keyFromTitle('Phone case for mobile phone','Phones').key).toBe('case|phone');
 expect(keyFromTitle('Non slip yoga mat','Sports').key).toBe('mat|yoga');
 expect(keyFromTitle('Blue leather phone case with chain','Phones').key).toBe('case|phone');
 expect(keyFromTitle('Toy','Sports')).toBeNull();
});
test('explicit ambiguous head incorporates breadcrumb root, never all objects',()=>{
 expect(keyFromTitle('Phone holder for bike','Electronics',['holder']).key).toBe('holder|phone|electronics');
 expect(keyFromTitle('Phone holder for bike','Auto',['holder']).key).toBe('holder|phone|auto');
});
test('A candidate discovery does not depend on holdout B',()=>{
 const A=[entry('A1','A','Phone Case'),entry('A2','A','Blue Phone Case')];
 const fst=buildA([...A,entry('B1','B','Phone Case')]);
 const snd=buildA([...A,entry('B1','B','Kitchen Mat')]);
 expect(fst).toEqual(snd);
 expect(fst.stats.families).toBe(1);
 expect(fst.stats.high_priority_families).toBe(1);
 expect(fst.stats.human_decisions).toBe(0);
});
test('no automatic approval: blank human CSV freezes zero decisions',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'head-ab-'));
 try{
  const A=[entry('A1','A','Phone Case'),entry('A2','A','Blue Phone Case')];
  emitTrain(A,tmp);
  const out=path.join(tmp,'frozen.json');
  const report=freeze(tmp,path.join(tmp,'A-human-family-review.csv'),out);
  expect(report.approved).toBe(0);
  const rules=JSON.parse(fs.readFileSync(out,'utf8'));
  const result=evaluateB([...A,entry('B1','B','Black Phone Case')],rules);
  expect(result.report.holdout_reused).toBe(0);
  expect(result.report.verdict).toBe('PENDING_INDEPENDENT_HUMAN_LABELS');
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
test('only explicit human approval propagates to unseen B, with errors quantified',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'head-ab-'));
 try{
  const A=[entry('A1','A','Phone Case'),entry('A2','A','Blue Phone Case')];
  emitTrain(A,tmp);
  const input=path.join(tmp,'A-human-family-review.csv');
  const rows=parseCSV(fs.readFileSync(input,'utf8').replace(/^\uFEFF/,''));
  const idx=x=>CSV_HEAD.indexOf(x);
  rows[1][idx('action_APPROVE_SPLIT_DEFER')]='APPROVE';
  rows[1][idx('human_parent')]='Tech';
  rows[1][idx('reviewer')]='real-human';
  rows[1][idx('evidence_note')]='all A examples visually inspected';
  fs.writeFileSync(input,rows.map(r=>r.map(s=>'"'+s.replace(/"/g,'""')+'"').join(',')).join('\n')+'\n');
  const out=path.join(tmp,'frozen.json');freeze(tmp,input,out);
  const rule=JSON.parse(fs.readFileSync(out,'utf8'));
  const B=[entry('B1','B','Black Phone Case'),entry('B2','B','Kitchen Mat')];
  const result=evaluateB([...A,...B],rule);
  expect(result.report.holdout_reused).toBe(1);
  expect(result.report.evaluation).toBeNull();
  const gold=[{ref:'B1',human_parent:'Maison'},{ref:'B2',human_parent:'Maison'}];
  const scored=evaluateB([...A,...B],rule,gold);
  expect(scored.report.evaluation).toMatchObject({holdout_labels:2,applied:1,errors:1,precision_parent:0});
  expect(scored.report.verdict).toBe('NO_GO');
  expect(()=>evaluateB([...A,...B],rule,[gold[0]])).toThrow('INCOMPLETE_BLIND_HOLDOUT_LABELS');
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
test('precision uncertainty is present even for zero errors',()=>{
 expect(wilson(0,0)).toBeNull();
 expect(wilson(1,1).lower).toBeLessThan(.30);
 expect(wilson(100,100).lower).toBeGreaterThan(.95);
});
