#!/usr/bin/env node
'use strict';
/*
  Komerce R&D ECONOMY: general FK-derived functional-dependency candidate scanner.
  Inputs: actual schema tables, feature ownership, feature-mapped JS writers.
  No LLM, no DB, no installation, no prod writes.
  Output is H0 hypothesis; same-columns do NOT establish an approved business oracle.
*/
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..');
const SCHEMA=path.join(ROOT,'docs/db/railway-live-schema.sql');
const FEATURES=path.join(ROOT,'features');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function tables(){
 const s=fs.readFileSync(SCHEMA,'utf8'),out=new Map();
 const re=/CREATE TABLE public\.([a-z_][a-z0-9_]*) \(([^]*?)\n\);/g;
 for(const m of s.matchAll(re)){
  const names=[...m[2].matchAll(/^\s+([a-z_][a-z0-9_]*)\s+(?:uuid|integer|numeric|text|character|bigint|smallint|boolean|double precision|timestamp|date|real|money|public\.)/gim)].map(x=>x[1]);
  out.set(m[1],new Set(names));
 }
 return out;
}
function featureMap(){
 const out=new Map(),owners=new Map(),specFiles=fs.readdirSync(FEATURES).filter(x=>x.endsWith('.feature.js')).sort();
 for(const file of specFiles){
  const f=require(path.join(FEATURES,file));
  for(const spec of f.db?.tables||[]){
   const m=/^([a-z_][\w]*):\s*(RW|R|W)/i.exec(String(spec));
   if(!m)continue;
   if(!owners.has(m[1]))owners.set(m[1],new Set());
   if(m[2].includes('W'))owners.get(m[1]).add(f.name||file);
  }
  for(const p of [...(f.files?.services||[]),...(f.files?.routes||[])]){
   const v=String(p).replace(/\\/g,'/');
   if(!/^(services|routes)\/[a-zA-Z0-9_./-]+\.js$/.test(v)||v.includes('..'))continue;
   if(!out.has(v))out.set(v,new Set());
   out.get(v).add(f.name||file);
  }
 }
 return {out,owners,featureCount:specFiles.length};
}
function find(){
 const model=tables(),{out,owners,featureCount}=featureMap(),findings=[];
 for(const [rel,features] of [...out.entries()].sort(([a],[b])=>a.localeCompare(b))){
  const full=path.join(ROOT,rel);if(!fs.existsSync(full))continue;
  const code=fs.readFileSync(full,'utf8');
  // SQL writer sites only. String literals/comments are a known potential false-positive source.
  for(const m of code.matchAll(/\bINSERT\s+INTO\s+([a-z_][a-z0-9_]*)\s*\(([^)]*)\)\s*(VALUES|SELECT)\b/gi)){
   const child=m[1].toLowerCase(),childCols=model.get(child);if(!childCols)continue;
   if(m[3].toUpperCase()!=='VALUES')continue; // SELECT suggests authority may already be derived
   const writes=m[2].split(',').map(x=>x.trim().toLowerCase());
   for(const col of writes.filter(x=>x.endsWith('_id'))){
    const parent=col.slice(0,-3)+'s',parentCols=model.get(parent);
    if(!parentCols||!parentCols.has('id'))continue;
    const duplicated=writes.filter(x=>x!=='id'&&x!==col&&parentCols.has(x));
    if(!duplicated.length)continue;
    const identity=duplicated.filter(x=>x.endsWith('_id'));
    const metric=duplicated.filter(x=>x==='quantity'||x==='qty'||x.endsWith('_qty'));
    if(!identity.length&&!metric.length)continue;
    findings.push({
     type:'CROSS_FEATURE_FD_AUTHORITY_CANDIDATE',status:'H0_UNVERIFIED',
     source:rel,line:code.slice(0,m.index).split('\n').length,feature:[...features].sort(),
     childTable:child,parentTable:parent,relationship:col,
     sharedIdentityColumns:identity,sharedQuantityColumns:metric,
     parentDeclaredWriters:[...(owners.get(parent)||[])].sort(),
     childDeclaredWriters:[...(owners.get(child)||[])].sort(),
     basis:'Child INSERT uses supplied VALUES for fields duplicated on referenced parent. Inspect call-site oracles and cross-entity invariants.',
     sourceSha256:sha(code),
    });
   }
  }
 }
 const uniq=new Map();for(const x of findings){const k=[x.source,x.line,x.childTable,x.parentTable,x.relationship].join(':');uniq.set(k,x)}
 const sorted=[...uniq.values()].sort((a,b)=>a.source.localeCompare(b.source)||a.line-b.line);
 return {schema:'feature-fd-authority-hypotheses/v1',statement:'Provenance-based risk hypotheses, NOT demonstrated vulnerabilities',
 scope:{features:featureCount,schemaTables:model.size,mappedFiles:out.size},
 metrics:{hypotheses:sorted.length,approvedOracles:0},findings:sorted,digest:sha(JSON.stringify(sorted))};
}
const report=find();
if(process.env.FP_FD_REPORT)fs.writeFileSync(path.resolve(process.env.FP_FD_REPORT),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({scope:report.scope,metrics:report.metrics,findings:report.findings.map(({source,line,childTable,parentTable,sharedIdentityColumns,sharedQuantityColumns})=>({source,line,childTable,parentTable,sharedIdentityColumns,sharedQuantityColumns})),digest:report.digest},null,2));
