#!/usr/bin/env node
/** @komerce-arch-lite
 * @role frozen-head-noun-reuse-experiment
 * @domain catalog
 * @layer tooling
 * @owner backend-core
 * @purpose One-shot A-only head-noun training, human rule freeze, and blinded holdout reuse proof.
 * @db-read none
 * @db-write none
 * @impact-areas catalog,sourcing,isolated-ci,offline-rd
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {loadFrozen,splitGroup,normal}=require('./cj-object-shadow-v2');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const VERSION='HEAD_NOUN_AB_V1_FIXED';
const LINKS=new Set(['for','with','compatible','fits','suitable']);
const ATTR=new Set(('red blue black white green yellow orange purple pink brown gray grey silver gold beige navy clear transparent color colours colour new casual modern fashion stylish cute luxury soft hard durable waterproof non slip nonslip resistant stainless steel aluminum aluminium plastic acrylic leather cotton polyester nylon wool portable adjustable foldable heavy lightweight mini small medium large extra universal multifunctional multi functional rechargeable wireless indoor outdoor long short premium quality high low mens women womens female male girl girls boy boys child children kids baby adults winter summer autumn spring 2020 2021 2022 2023 2024 2025 2026 pcs pc piece pieces pack packs set sets kit kits').split(' '));
const STOP=new Set(['a','an','the','and','or','of','in','on','at','from','by','to','as','is','are','per']);
const CSV_HEAD=['key','head','A_count','A_segment_count','priority','v1_parent_values','refs','examples',
 'action_APPROVE_SPLIT_DEFER','human_parent','human_leaf','reviewer','evidence_note',
 'ambiguous_head_on_split','excluded_refs'];
const quote=x=>'"'+String(x==null?'':x).replace(/"/g,'""')+'"';
const csv=rows=>rows.map(r=>r.map(quote).join(',')).join('\n')+'\n';
function parseCSV(input){
 const rows=[];let row=[],part='',inside=false;
 for(let i=0;i<input.length;i++){const c=input[i];
  if(c==='"'){if(inside&&input[i+1]==='"'){part+='"';i++;}else inside=!inside;}
  else if(c===','&&!inside){row.push(part);part='';}
  else if((c==='\n'||c==='\r')&&!inside){if(c==='\r'&&input[i+1]==='\n')i++;row.push(part);part='';if(row.some(Boolean))rows.push(row);row=[];}
  else part+=c;
 }
 if(inside)throw Error('UNCLOSED_CSV_QUOTE');
 if(part||row.length){row.push(part);rows.push(row);}
 return rows;
}
function keyFromTitle(title,root,ambiguous=[]){
 let words=normal(title).split(' ').filter(Boolean);
 const first=words.findIndex((w,i)=>i>0&&LINKS.has(w));
 if(first>0)words=words.slice(0,first);
 words=words.filter(w=>w.length>1&&!ATTR.has(w)&&!STOP.has(w)
   &&!/^\d+$/.test(w)&&!/^\d+(cm|mm|m|oz|inch|ft|ml|kg|pcs)$/.test(w));
 if(words.length<2)return null;
 const head=words[words.length-1],qualifier=words[words.length-2];
 if(STOP.has(head)||LINKS.has(head)||ATTR.has(head))return null;
 const generic=ambiguous.includes(head);
 return {head,modifier:qualifier,key:[head,qualifier,...(generic?[normal(root).split(' ')[0]||'unknown']:[])].join('|'),
  ambiguous:generic};
}
function rootOf(sourcePath){return String(sourcePath||'').split('>')[0].trim();}
function loadInputs(source,verdicts){
 const rows=loadFrozen(source,verdicts);
 const raw=JSON.parse(fs.readFileSync(source,'utf8'));
 const segments=new Map(raw.products.map(x=>[x.candidate_ref,x.segment_id||'UNKNOWN']));
 return rows.map(r=>({...r,split:splitGroup(r.title)==='calibration'?'A':'B',
  segment:segments.get(r.ref)||'UNKNOWN',root:rootOf(r.source_path)}));
}
function buildA(rows,ambiguous=[]){
 if(!Array.isArray(ambiguous)||ambiguous.some(s=>typeof s!=='string'||!s))
  throw Error('AMBIGUOUS_HEADS_INVALID');
 const families=new Map(),isolated=[];
 for(const r of rows.filter(x=>x.split==='A')){
  const k=keyFromTitle(r.title,r.root,ambiguous);
  if(!k){isolated.push(r.ref);continue;}
  if(!families.has(k.key))families.set(k.key,{key:k.key,head:k.head,members:[]});
  families.get(k.key).members.push(r);
 }
 const grouped=[...families.values()].map(f=>{
  const segments=[...new Set(f.members.map(x=>x.segment))].sort();
  const parents=[...new Set(f.members.map(x=>x.v1.category).filter(Boolean))].sort();
  return {key:f.key,head:f.head,count:f.members.length,segment_count:segments.length,
   priority:f.members.length*segments.length,segments,known_v1_parents:parents,
   parent_conflict:parents.length>1,refs:f.members.map(x=>x.ref),
   members:f.members.map(x=>({ref:x.ref,title:x.title,source_path:x.source_path,
     segment:x.segment,v1_status:x.v1.status,v1_category:x.v1.category}))};
 }).sort((a,b)=>b.priority-a.priority||b.count-a.count||a.key.localeCompare(b.key));
 return {families:grouped,isolated,stats:{
  source_A:rows.filter(x=>x.split==='A').length,
  families:grouped.length,grouped_families:grouped.filter(x=>x.count>1).length,
  high_priority_families:grouped.filter(x=>x.priority>=3).length,
  high_priority_items:grouped.filter(x=>x.priority>=3).reduce((n,x)=>n+x.count,0),
  unkeyed_A:isolated.length,
  A_review:rows.filter(x=>x.split==='A'&&x.v1.status==='REVIEW_REQUIRED').length,
  A_review_in_high_priority:grouped.filter(x=>x.priority>=3)
   .reduce((n,f)=>n+f.members.filter(m=>m.v1_status==='REVIEW_REQUIRED').length,0),
  human_decisions:0,precision:null}};
}
function emitTrain(rows,output,ambiguous=[]){
 const a=buildA(rows,ambiguous);fs.mkdirSync(output,{recursive:true});
 const template=[CSV_HEAD,...a.families.filter(f=>f.priority>=3)
  .map(f=>[f.key,f.head,f.count,f.segment_count,f.priority,f.known_v1_parents.join(' | '),
   f.refs.join(' | '),f.members.slice(0,3).map(m=>m.title).join(' || '),
   '','','','','','',''])];
 fs.writeFileSync(path.join(output,'A-human-family-review.csv'),'\ufeff'+csv(template));
 fs.writeFileSync(path.join(output,'A-family-members.json'),JSON.stringify(a.families,null,2)+'\n');
 const manifest={version:VERSION,kind:'A_ONLY_TRAINING',certification:'NOT_CERTIFIED',
   source_sha256:'9ff18f6f902f2e72fc893a90da96b61058c77028d55e941381631fc9fb8116de',
   code_contract:'fixed generic head noun extraction; no learning from holdout',
   ambiguous_heads:ambiguous.slice().sort(),A_hash:sha(rows.filter(r=>r.split==='A')
     .map(r=>[r.ref,r.title,r.v1.status]).sort((a,b)=>a[0].localeCompare(b[0])).map(JSON.stringify).join('\n')),
   stats:a.stats,notes:[
    'A training families are candidates only; no auto-validation from V1.',
    'Holdout B must not be inspected or tuned until rules are frozen.',
    'The corpus was already explored globally, so B is not an independent future-supplier test.',
    'Priority score size*segments is a review heuristic only, not an error rate.',
    'Actual human time and independent accuracy remain unmeasured.']};
 fs.writeFileSync(path.join(output,'A-training-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 return manifest;
}
function freeze(trainDir,reviewFile,output){
 const m=JSON.parse(fs.readFileSync(path.join(trainDir,'A-training-manifest.json'),'utf8'));
 if(m.version!==VERSION)throw Error('TRAINING_MANIFEST_VERSION_MISMATCH');
 const members=JSON.parse(fs.readFileSync(path.join(trainDir,'A-family-members.json'),'utf8'));
 const keys=new Map(members.filter(x=>x.priority>=3).map(x=>[x.key,x]));
 const parsed=parseCSV(fs.readFileSync(reviewFile,'utf8').replace(/^\uFEFF/,''));
 if(JSON.stringify(parsed[0])!==JSON.stringify(CSV_HEAD))throw Error('HUMAN_CSV_COLUMNS_MISMATCH');
 const approved=[],split=[],deferred=[],seen=new Set();
 for(const row of parsed.slice(1)){
  if(row.length!==CSV_HEAD.length)throw Error('HUMAN_CSV_ROW_SHAPE_INVALID');
  const record=Object.fromEntries(CSV_HEAD.map((h,i)=>[h,row[i].trim()]));
  if(seen.has(record.key)||!keys.has(record.key))throw Error('UNEXPECTED_OR_DUPLICATE_A_FAMILY');
  seen.add(record.key);
  const action=record.action_APPROVE_SPLIT_DEFER.toUpperCase();
  if(!action){continue;}
  if(!['APPROVE','SPLIT','DEFER'].includes(action))throw Error('INVALID_HUMAN_ACTION');
  if(!record.reviewer||!record.evidence_note)throw Error('HUMAN_REVIEWER_AND_EVIDENCE_REQUIRED');
  if(action==='APPROVE'){
   if(!record.human_parent)throw Error('HUMAN_PARENT_REQUIRED');
   if(record.excluded_refs)throw Error('EXCEPTIONS_REQUIRE_SPLIT_OR_DEFER');
   if(keys.get(record.key).parent_conflict&&!record.evidence_note.includes('ARBITRATED:'))
    throw Error('KNOWN_V1_PARENT_DISAGREEMENT_MUST_BE_ARBITRATED');
   approved.push({key:record.key,parent:record.human_parent,leaf:record.human_leaf||null,
    reviewer:record.reviewer,evidence:record.evidence_note,
    trained_A_refs:keys.get(record.key).refs,trained_A_count:keys.get(record.key).count});
  }else if(action==='SPLIT'){if(!record.ambiguous_head_on_split)
   throw Error('SPLIT_REQUIRES_EXPLICIT_AMBIGUOUS_HEAD');
   split.push({key:record.key,head:record.ambiguous_head_on_split,reviewer:record.reviewer});
  }else deferred.push({key:record.key,reviewer:record.reviewer});
 }
 const outputData={version:VERSION,kind:'FROZEN_HUMAN_A_RULES',A_hash:m.A_hash,
  reviewed_csv_sha256:sha(fs.readFileSync(reviewFile)),ambiguous_heads:m.ambiguous_heads,
  approved,split,deferred,
  reviewed_families:approved.length+split.length+deferred.length,
  human_minutes:null,holdout_seen:false,certification:'NOT_CERTIFIED'};
 fs.writeFileSync(output,JSON.stringify(outputData,null,2)+'\n');
 return {approved:approved.length,split:split.length,deferred:deferred.length};
}
function wilson(correct,total){
 if(total===0)return null;
 const z=1.959963984540054,p=correct/total,den=1+z*z/total;
 const center=(p+z*z/(2*total))/den;
 const radius=z*Math.sqrt(p*(1-p)/total+z*z/(4*total*total))/den;
 return {lower:Number((center-radius).toFixed(5)),upper:Number((center+radius).toFixed(5))};
}
function evaluateB(rows,rules,labels=null){
 if(rules.version!==VERSION||rules.kind!=='FROZEN_HUMAN_A_RULES')throw Error('RULES_NOT_FROZEN');
 const expected=sha(rows.filter(r=>r.split==='A')
  .map(r=>[r.ref,r.title,r.v1.status]).sort((a,b)=>a[0].localeCompare(b[0])).map(JSON.stringify).join('\n'));
 if(expected!==rules.A_hash)throw Error('RULES_FOREIGN_TO_THIS_A_PARTITION');
 const approved=new Map(rules.approved.map(x=>[x.key,x]));
 if(approved.size!==rules.approved.length)throw Error('DUPLICATE_FROZEN_RULES');
 const B=rows.filter(r=>r.split==='B'),v1review=B.filter(r=>r.v1.status==='REVIEW_REQUIRED');
 const predicted=B.map(r=>{
  const key=keyFromTitle(r.title,r.root,rules.ambiguous_heads);
  const rule=key&&approved.get(key.key);
  return {ref:r.ref,title:r.title,split:'B',v1_status:r.v1.status,
   candidate_key:key?.key||null,applied:!!rule,
   predicted_parent:rule?.parent||null,predicted_leaf:rule?.leaf||null,
   trained_A_count:rule?.trained_A_count||null};
 });
 const applied=predicted.filter(x=>x.applied),reviewReused=predicted.filter(x=>x.applied&&x.v1_status==='REVIEW_REQUIRED');
 let scored=null,verdict='PENDING_INDEPENDENT_HUMAN_LABELS';
 if(labels!==null){
  if(!Array.isArray(labels))throw Error('HOLDOUT_LABELS_MUST_BE_ARRAY');
  const m=new Map();for(const label of labels){
   if(m.has(label.ref)||typeof label.human_parent!=='string'||!label.human_parent.trim())
    throw Error('DUPLICATE_OR_EMPTY_HOLDOUT_GOLD_LABEL');
   m.set(label.ref,label);
  }
  if(m.size!==B.length||B.some(r=>!m.has(r.ref)))throw Error('INCOMPLETE_BLIND_HOLDOUT_LABELS');
  const correct=applied.filter(x=>x.predicted_parent===m.get(x.ref).human_parent);
  const errors=applied.filter(x=>x.predicted_parent!==m.get(x.ref).human_parent);
  const precision=applied.length?correct.length/applied.length:null;
  const reuse=v1review.length?reviewReused.length/v1review.length:null;
  scored={holdout_labels:B.length,applied:applied.length,correct:correct.length,errors:errors.length,
   error_refs:errors.map(x=>x.ref),precision_parent:precision,
   precision_wilson95:wilson(correct.length,applied.length),
   review_reuse_rate:reuse,independent_leaf_precision:null,
   human_minutes:rules.human_minutes??null};
  if(precision!==null&&reuse!==null&&reuse>=.40&&precision>=.95&&errors.length<=2)
   verdict='GO_CANDIDATE_REQUIRES_HUMAN_TIME_AND_EXTERNAL_PROVIDER';
  else if((reuse!==null&&reuse<.25)||(precision!==null&&precision<.90))verdict='NO_GO';
  else verdict='INCONCLUSIVE';
 }
 return {report:{kind:'FROZEN_A_TO_B_TRANSFER',version:VERSION,
  B_count:B.length,B_v1_review:v1review.length,
  frozen_approved_A_families:approved.size,
  holdout_reused:applied.length,holdout_review_reused:reviewReused.length,
  review_reuse_rate_unverified:v1review.length?reviewReused.length/v1review.length:null,
  evaluation:scored,verdict,
  disclosure:'Internal holdout explored previously; no new-supplier generalization proof. Do not adjust on B.'},
  predictions:predicted};
}
function run(argv){
 const [mode,source,old,...args]=argv;
 if(!['train','freeze','evaluate'].includes(mode)||!source||!old)
  throw Error('Usage: train|freeze|evaluate <cj-frozen.json> <v1-decisions.json> ...');
 const rows=loadInputs(source,old);
 if(mode==='train'){
  if(!args[0])throw Error('A_OUTPUT_DIRECTORY_REQUIRED');
  return emitTrain(rows,args[0]);
 }
 if(mode==='freeze'){
  if(!args[0]||!args[1]||!args[2])throw Error('TRAIN_DIR_HUMAN_CSV_OUTPUT_REQUIRED');
  return freeze(args[0],args[1],args[2]);
 }
 if(!args[0]||!args[1])throw Error('FROZEN_RULES_AND_OUTPUT_DIR_REQUIRED');
 const rules=JSON.parse(fs.readFileSync(args[0],'utf8'));
 const labels=args[2]?JSON.parse(fs.readFileSync(args[2],'utf8')):null;
 const r=evaluateB(rows,rules,labels);
 fs.mkdirSync(args[1],{recursive:true});
 fs.writeFileSync(path.join(args[1],'B-reuse-report.json'),JSON.stringify(r.report,null,2)+'\n');
 fs.writeFileSync(path.join(args[1],'B-reuse-predictions.json'),JSON.stringify(r.predictions,null,2)+'\n');
 return r.report;
}
if(require.main===module){try{console.log(JSON.stringify(run(process.argv.slice(2))));}
 catch(e){console.error('[HEAD_NOUN_AB] '+e.message);process.exitCode=1;}}
module.exports={keyFromTitle,loadInputs,buildA,emitTrain,freeze,wilson,evaluateB,parseCSV,run,VERSION,CSV_HEAD};
