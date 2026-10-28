#!/usr/bin/env node
/** @komerce-arch-lite
 * @role deterministic-lexical-family-hypothesis-probe
 * @domain catalog
 * @layer tooling
 * @owner backend-core
 * @purpose Quantify duplicate and shared-phrase review opportunities without AI or classification writes.
 * @db-read none
 * @db-write none
 * @impact-areas catalog,sourcing,offline-rd
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {loadFrozen}=require('./cj-object-shadow-v2');
const STOP=new Set(('a an and with for of to in on by from or into the at as is it this that new very style fashion universal portable large small high low bulk multi casual professional durable modern trendy cute daily men mens women woman girl girls boy boys baby kids children pcs pc pack packs pack of set sets kit kits size inches inch cm mm feet foot ft more latest').split(' '));
const BANNED=new Set(['stainless steel','aluminum alloy','same day','free shipping','perfect gift','double wall','high quality','new arrival','hot sale']);
const normalize=s=>(String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z0-9]+/g)||[]).join(' ');
function phrases(title){
 const words=normalize(title).split(' ').filter(Boolean),found=new Set();
 for(const n of [2,3]){
  for(let i=0;i<=words.length-n;i++){
   const w=words.slice(i,i+n),p=w.join(' ');
   if(w.some(t=>t.length<3)||STOP.has(w[0])||STOP.has(w[n-1])||BANNED.has(p))continue;
   found.add(p);
  }
 }
 return found;
}
function probe(rows,segments=new Map()){
 const freq=new Map(),exact=new Map();
 for(const r of rows){
  for(const p of phrases(r.title))freq.set(p,(freq.get(p)||0)+1);
  const t=normalize(r.title);exact.set(t,(exact.get(t)||0)+1);
 }
 const assign=rows.map(r=>{
  const candidates=[...phrases(r.title)].filter(p=>freq.get(p)>=2&&freq.get(p)<=30)
   .sort((a,b)=>b.split(' ').length-a.split(' ').length
     ||freq.get(b)-freq.get(a)||a.localeCompare(b,'en'));
  return {ref:r.ref,title:r.title,source_path:r.source_path,
   source_segment:segments.get(r.ref)||'UNKNOWN',v1:r.v1,
   candidate_phrases:candidates.slice(0,12),
   lexical_anchor:candidates[0]||null};
 });
 const groups=new Map();
 for(const r of assign){
  if(!r.lexical_anchor)continue;
  if(!groups.has(r.lexical_anchor))groups.set(r.lexical_anchor,[]);
  groups.get(r.lexical_anchor).push(r);
 }
 for(const [key,items] of groups)if(items.length<2)groups.delete(key);
 for(const r of assign)if(!groups.has(r.lexical_anchor))r.lexical_anchor=null;
 const families=[...groups].map(([phrase,items])=>{
  const parents=[...new Set(items.map(x=>x.v1.category).filter(Boolean))].sort();
  const segments=[...new Set(items.map(x=>x.source_segment))].sort();
  return {anchor:phrase,size:items.length,v1_parents:parents,
   source_segments:segments,v1_parent_conflict:parents.length>1,
   cross_source_segments:segments.length>1,
   v1_review_items:items.filter(x=>x.v1.status==='REVIEW_REQUIRED').length,
   flags:[...(parents.length>1?['DIFFERENT_V1_PARENT']:[]),
     ...(segments.length>1?['CROSS_DISCOVERY_SEGMENTS']:[])],
   members:items.map(x=>({ref:x.ref,title:x.title,v1:x.v1,segment:x.source_segment}))
  };
 }).sort((a,b)=>b.size-a.size||a.anchor.localeCompare(b.anchor,'en'));
 const review=assign.filter(x=>x.v1.status==='REVIEW_REQUIRED');
 const groupedReview=review.filter(x=>x.lexical_anchor);
 const reviewingFamilies=families.filter(x=>x.v1_review_items>0).length;
 const theoreticalDecisions=reviewingFamilies+(review.length-groupedReview.length);
 const report={mode:'DETERMINISTIC_LEXICAL_HYPOTHESIS_PROBE',certification:'NOT_CERTIFIED',
  counts:{products:rows.length,v1:assign.reduce((a,x)=>(a[x.v1.status]=(a[x.v1.status]||0)+1,a),{}),
   exact_title_unique:exact.size,exact_title_redundant:rows.length-exact.size,
   duplicate_title_groups:[...exact.values()].filter(x=>x>1).length,
   lexical_candidate_families:families.length,
   products_in_lexical_candidate_families:assign.filter(x=>x.lexical_anchor).length,
   products_without_lexical_candidate_family:assign.filter(x=>!x.lexical_anchor).length,
   v1_review_products:review.length,
   v1_review_products_with_candidate_family:groupedReview.length,
   v1_review_products_without_candidate_family:review.length-groupedReview.length,
   lexical_candidate_families_touching_review:reviewingFamilies,
   candidate_families_crossing_discovery_segments:families.filter(x=>x.cross_source_segments).length,
   candidate_families_with_v1_parent_conflict:families.filter(x=>x.v1_parent_conflict).length
  },
  upper_bound_not_a_measure:{
   hypothetical_review_actions_if_all_candidates_homogeneous:theoreticalDecisions,
   hypothetical_reduction_vs_one_action_per_review_product:
    Number((1-theoreticalDecisions/Math.max(review.length,1)).toFixed(4))},
  constraints:[
   'Ngram matches are NOT verified object identities. Same phrase can describe different objects.',
   'Discovery segments and V1 labels are only risk diagnostics, not independent truth.',
   'Hypothetical decision reduction assumes every proposed family is homogeneous: not established.',
   'No labels, accuracy, external supplier generalization or time savings measured.',
   'No LLM, no network, no publication, no database writes.'
  ]};
 return {report,families,assignments:assign};
}
function csv(data){
 const q=s=>'"'+String(s==null?'':s).replace(/"/g,'""')+'"';
 return data.map(row=>row.map(q).join(',')).join('\n')+'\n';
}
function save(out,result){
 fs.mkdirSync(out,{recursive:true});
 for(const [name,value] of [['report',result.report],['families',result.families],['assignments',result.assignments]])
  fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify(value,null,2)+'\n');
 const columns=['anchor','size','v1_parents','source_segments','flags','review_items','refs',
  'human_same_object_yes_no','human_canonical_object','human_exceptions','human_reviewer'];
 const rows=result.families.map(x=>[x.anchor,x.size,x.v1_parents.join(' | '),
  x.source_segments.join(' | '),x.flags.join(' | '),x.v1_review_items,
  x.members.map(m=>m.ref).join(' | '),'','','','']);
 fs.writeFileSync(path.join(out,'review-family-candidates.csv'),'\ufeff'+csv([columns,...rows]));
}
function main(argv){
 const [source,old,out]=argv;
 if(!source||!old||!out)throw Error('Usage: node scripts/cj-deterministic-family-probe.js <frozen-source.json> <v1-decisions.json> <out>');
 const rows=loadFrozen(source,old);
 const segments=new Map(JSON.parse(fs.readFileSync(source,'utf8')).products
  .map(r=>[r.candidate_ref,r.segment_id||'NO_SEGMENT']));
 const result=probe(rows,segments);save(out,result);
 console.log(JSON.stringify(result.report));
 return result;
}
if(require.main===module){try{main(process.argv.slice(2));}catch(e){
 console.error('[LEXICAL_PROBE] '+e.message);process.exitCode=1;
}}
module.exports={normalize,phrases,probe,save,main};
