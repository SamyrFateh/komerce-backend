#!/usr/bin/env node
/** @komerce-arch-lite
 * @role object-family-shadow-v2
 * @domain catalog
 * @layer tooling
 * @owner backend-core
 * @purpose Read-only CJ source, blind gold split, object families and V1/V2 review.
 * @db-read none
 * @db-write none
 * @impact-areas catalog,sourcing,isolated-ci
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const SHA=x=>crypto.createHash('sha256').update(x).digest('hex');
const SOURCE_SHA='9ff18f6f902f2e72fc893a90da96b61058c77028d55e941381631fc9fb8116de';
const VERSION='object-shadow-v2.0';
const normal=x=>String(x||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const write=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,v);};
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const csv=rows=>rows.map(row=>row.map(v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"').join(',')).join('\n')+'\n';
function loadFrozen(sourceFile,decisionsFile){
  if(SHA(fs.readFileSync(sourceFile))!==SOURCE_SHA)throw Error('FROZEN_SOURCE_HASH_MISMATCH');
  const source=read(sourceFile),v1=read(decisionsFile);
  if(source.products?.length!==498||source.inspected!==498||v1.source_sha256!==SOURCE_SHA
     ||v1.decisions?.length!==498)throw Error('INVALID_498_REPLAY_INPUT');
  const d=new Map(v1.decisions.map(x=>[x.candidate_ref,x])),refs=new Set(),ids=new Set();
  if(d.size!==498)throw Error('DUPLICATE_V1_REF');
  return source.products.map(x=>{
    if(refs.has(x.candidate_ref)||ids.has(x.supplier_product_id))throw Error('DUPLICATE_SOURCE_ID');
    refs.add(x.candidate_ref);ids.add(x.supplier_product_id);
    const old=d.get(x.candidate_ref);
    if(!old||old.supplier_product_id!==x.supplier_product_id
       ||old.product_name!==x.product_name||old.supplier_category!==x.supplier_category)
      throw Error('V1_SOURCE_IDENTITY_MISMATCH:'+x.candidate_ref);
    return {ref:x.candidate_ref,provider:'CJdropshipping',supplier_id:x.supplier_product_id,
      title:x.product_name,source_path:x.supplier_category,attributes:{},
      v1:{status:old.verdict,category:old.category,subcategory:old.subcategory}};
  });
}
function inputRecord(row){
  const o={title:row.title,source_path:row.source_path,attributes:row.attributes||{},
    provider:row.provider,version:VERSION};
  return {ref:row.ref,input_hash:SHA(JSON.stringify(o)),...o};
}
function splitGroup(title){return parseInt(SHA('gold-cj-v1|'+normal(title)).slice(0,8),16)%2?'holdout':'calibration';}
function prepare(rows,out){
  const titles=new Map();
  for(const x of rows){const k=normal(x.title);titles.set(k,(titles.get(k)||0)+1);}
  const inputs=rows.map(row=>({...inputRecord(row),split:splitGroup(row.title),
    duplicate_group:SHA(normal(row.title)).slice(0,16)}));
  const head=['ref','title','supplier_path','human_object','human_parent','human_leaf',
    'uncertain','reviewer_notes'];
  for(const split of ['calibration','holdout']){
    write(path.join(out,'blind-'+split+'.csv'),csv([head,...rows.filter(r=>splitGroup(r.title)===split)
      .map(r=>[r.ref,r.title,r.source_path,'','','','',''])]));
  }
  write(path.join(out,'identity-input.jsonl'),inputs.map(x=>JSON.stringify(x)).join('\n')+'\n');
  const groups=[...titles.values()].filter(v=>v>1);
  const report={mode:'SHADOW_PREPARE',certification:'NOT_CERTIFIED',
    source_count:rows.length,source_sha256:SOURCE_SHA,
    v1_by_status:rows.reduce((a,x)=>(a[x.v1.status]=(a[x.v1.status]||0)+1,a),{}),
    distinct_normalized_titles:titles.size,duplicate_groups:groups.length,
    duplicate_products:groups.reduce((a,b)=>a+b,0),
    partition:inputs.reduce((a,x)=>(a[x.split]=(a[x.split]||0)+1,a),{}),
    human_annotations:0,object_families:null,precision:null,
    note:'No identity extraction or human validation yet. Blind labels intentionally empty.'};
  write(path.join(out,'prepare-report.json'),JSON.stringify(report,null,2)+'\n');return report;
}
const roles=new Set(['principal','accessoire','kit','piece']);
const audiences=new Set(['femme','homme','enfant','bebe','mixte','inconnu']);
function validateIdentity(x,input){
  if(!x||x.ref!==input.ref||x.input_hash!==input.input_hash)
    throw Error('STALE_OR_WRONG_EXTRACTION');
  if(!roles.has(x.role)||!audiences.has(x.public)||typeof x.ambigu!=='boolean'
     ||normal(x.objet).length<2||normal(x.objet).length>100)throw Error('INVALID_IDENTITY_SCHEMA');
  if(typeof x.preuve!=='string'||!normal(x.preuve)
     ||!normal(input.title).includes(normal(x.preuve)))throw Error('EVIDENCE_NOT_IN_SOURCE_TITLE');
  if(x.accessoire_de!=null&&normal(x.accessoire_de).length<2)
    throw Error('INVALID_ACCESSORY_TARGET');
  if(x.ambigu&&!(typeof x.raison_ambiguite==='string'&&x.raison_ambiguite.trim()))
    throw Error('AMBIGUITY_REASON_REQUIRED');
  return {ref:x.ref,objet:normal(x.objet),preuve:x.preuve,role:x.role,public:x.public,
    accessoire_de:normal(x.accessoire_de)||null,ambigu:x.ambigu,
    raison_ambiguite:x.ambigu?x.raison_ambiguite:null};
}
function familyKey(i){return [i.objet,i.public,i.role,i.accessoire_de||'-'].join('|');}
function analyse(rows,extractions,registry=[]){
  const inputs=new Map(rows.map(x=>[x.ref,{...x,...inputRecord(x)}]));
  const rules=new Map(),seen=new Set(),invalid=[],decisions=[],families=new Map();
  for(const r of registry){if(!r||!r.key||rules.has(r.key))throw Error('INVALID_RULE_REGISTRY');rules.set(r.key,r);}
  for(const x of extractions){
    const source=inputs.get(x.ref);
    if(!source){invalid.push({ref:x.ref,reason:'UNKNOWN_REF'});continue;}
    if(seen.has(x.ref)){invalid.push({ref:x.ref,reason:'DUPLICATE_EXTRACTION'});continue;}
    seen.add(x.ref);
    let identity;try{identity=validateIdentity(x,source);}
    catch(e){invalid.push({ref:x.ref,reason:e.message});continue;}
    const key=familyKey(identity),rule=rules.get(key);
    const disagree=Boolean(source.v1.category&&rule?.category
      &&source.v1.category!==rule.category);
    const approved=!identity.ambigu&&rule?.status==='APPROVED'
      &&typeof rule.reviewed_by==='string'&&Boolean(rule.reviewed_by.trim())
      &&typeof rule.version==='string'&&Boolean(rule.version.trim())
      &&Array.isArray(rule.observed_suppliers)
      &&rule.observed_suppliers.includes(source.provider)
      &&(!disagree||rule.v1_disagreement_reviewed===true);
    const shadow=approved&&rule.category
      ?{status:rule.subcategory?'AUTO_CLASSIFIED':'CATEGORY_CLASSIFIED',
        category:rule.category,subcategory:rule.subcategory||null}
      :{status:'REVIEW_REQUIRED',category:null,subcategory:null};
    const flags=[...(identity.ambigu?['IDENTITY_AMBIGUOUS']:[]),
      ...(disagree?['V1_V2_PARENT_DISAGREEMENT']:[]),
      ...(!rule?['FAMILY_NOT_REVIEWED']:[]),
      ...(rule&&!approved?['RULE_NOT_APPLICABLE']:[])];
    const item={ref:x.ref,title:source.title,provider:source.provider,identity,
      family_key:key,v1:source.v1,shadow,flags};
    decisions.push(item);if(!families.has(key))families.set(key,[]);families.get(key).push(item);
  }
  const cards=[...families].map(([key,items])=>({
    family_key:key,products:items.length,providers:[...new Set(items.map(x=>x.provider))],
    v1_summary:items.reduce((a,x)=>(a[x.v1.status]=(a[x.v1.status]||0)+1,a),{}),
    review_needed:items.some(x=>x.shadow.status==='REVIEW_REQUIRED'||x.flags.length),
    examples:items.slice().sort((a,b)=>a.title.length-b.title.length).slice(0,4)
      .map(x=>({ref:x.ref,title:x.title,preuve:x.identity.preuve})),
    atypical:items.filter(x=>x.flags.includes('IDENTITY_AMBIGUOUS')
      ||x.flags.includes('V1_V2_PARENT_DISAGREEMENT'))
      .map(x=>({ref:x.ref,title:x.title,flags:x.flags})),
    applied:items.filter(x=>x.shadow.status!=='REVIEW_REQUIRED').length
  })).sort((a,b)=>b.products-a.products||a.family_key.localeCompare(b.family_key));
  return {report:{mode:'SHADOW_ONLY',certification:'NOT_CERTIFIED',source_count:rows.length,
      submitted:extractions.length,valid:decisions.length,invalid:invalid.length,
      missing:rows.length-seen.size,types:new Set(decisions.map(x=>x.identity.objet)).size,
      families:cards.length,review_families:cards.filter(c=>c.review_needed).length,
      proposals:decisions.filter(x=>x.shadow.status!=='REVIEW_REQUIRED').length,
      precision:null,human_decisions:null,human_minutes:null,
      note:'Only approved and audited rules can propose in shadow; no model or human quality claims.'},
    decisions,cards,invalid};
}
function jsonl(p){return fs.readFileSync(p,'utf8').split(/\r?\n/).filter(Boolean)
  .map((x,j)=>{try{return JSON.parse(x);}catch(_){throw Error('BAD_JSONL_LINE_'+(j+1));}});}
function main(argv){
  const [mode,source,old,out,extractions,rules]=argv;
  if(!['prepare','evaluate'].includes(mode)||!source||!old||!out)
    throw Error('Usage: prepare|evaluate <frozen-source.json> <v1-decisions.json> <out> [identity-results.jsonl] [approved-rules.json]');
  const rows=loadFrozen(source,old),prep=prepare(rows,out);if(mode==='prepare')return prep;
  if(!extractions)throw Error('EXTRACTIONS_REQUIRED');
  const r=analyse(rows,jsonl(extractions),rules?read(rules):[]);
  for(const [name,data] of [['family-cards',r.cards],['shadow-assignments',r.decisions],
      ['shadow-invalid',r.invalid],['shadow-report',r.report]])
    write(path.join(out,name+'.json'),JSON.stringify(data,null,2)+'\n');
  return r.report;
}
if(require.main===module){try{console.log(JSON.stringify(main(process.argv.slice(2))));}
catch(e){console.error('[SHADOW_V2] '+e.stack);process.exitCode=1;}}
module.exports={normal,splitGroup,inputRecord,validateIdentity,familyKey,prepare,analyse,loadFrozen,main};
