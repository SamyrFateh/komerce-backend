#!/usr/bin/env node
'use strict';
/**
 * Feature output-contract H0 generator (eco, read-only, zero dependencies).
 * Searches existing feature-owned services/routes for non-guaranteed INSERT
 * paired with optimistic counters. A finding is a HYPOTHESIS, NOT a bug.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..'),FEAT=path.join(ROOT,'features');
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const line=(s,i)=>s.slice(0,i).split('\n').length;
function knownFiles(){
  const out=new Map();
  for(const fname of fs.readdirSync(FEAT).filter(x=>x.endsWith('.feature.js')).sort()){
    const f=require(path.join(FEAT,fname));
    for(const group of ['services','routes']){
      for(const rel of f.files?.[group]||[]){
        const norm=String(rel).replace(/\\/g,'/');
        if(!/^(services|routes)\/[a-zA-Z0-9_./-]+\.js$/.test(norm)||norm.includes('..'))continue;
        if(!out.has(norm))out.set(norm,new Set());
        out.get(norm).add(f.name||fname);
      }
    }
  }
  return out;
}
function inspect(source,rel,features){
  const results=[], seen=new Set();
  const conflict=/ON\s+CONFLICT(?:\s*\([^)]*\))?\s+DO\s+NOTHING/gi;
  for(const m of source.matchAll(conflict)){
    const i=m.index;
    // Avoid matching comments or quoted doctrine alone: an INSERT in the local segment is mandatory.
    const before=source.slice(Math.max(0,i-600),i);
    if(!/\bINSERT\s+INTO\s+[a-z_][a-z0-9_.]*/i.test(before))continue;
    const after=source.slice(i,Math.min(source.length,i+900));
    const firstQueryClose=Math.min(...[after.indexOf(');'),after.indexOf(');\n')].filter(n=>n>=0).concat([after.length]));
    const immediate=after.slice(firstQueryClose,Math.min(after.length,firstQueryClose+340));
    const inc=/\b([a-zA-Z_$][\w$]*)\s*\+\+\s*;/g;
    for(const x of immediate.matchAll(inc)){
      // SQL result is not inspected between the query and optimistic increment.
      if(/\browCount\b|\bRETURNING\b/i.test(immediate.slice(0,x.index)))continue;
      const key='UNCONDITIONAL_EFFECT_INCREMENT:'+i+':'+x.index;
      if(seen.has(key))continue;seen.add(key);
      results.push({kind:'UNCONDITIONAL_EFFECT_INCREMENT',feature:[...features].sort(),path:rel,line:line(source,i),
        variable:x[1],basis:'SQL INSERT may write zero rows; increment does not inspect query.rowCount',
        codeSha256:sha(source),status:'H0_UNVERIFIED',priority:'investigate',
        provenance:{sql:source.slice(i,Math.min(i+75,source.length)).replace(/\s+/g,' '),
          counter:immediate.slice(Math.max(0,x.index-30),x.index+x[0].length+35).replace(/\s+/g,' ')}});
    }
    const output=/\b([a-zA-Z_][\w$]*(?:created|assigned|inserted|updated|deleted|processed))\s*:\s*([a-zA-Z_$][\w$]*)\.length\b/gi;
    for(const x of after.matchAll(output)){
      const key='INPUT_LENGTH_AS_EFFECT:'+i+':'+x.index;
      if(seen.has(key))continue;seen.add(key);
      results.push({kind:'INPUT_LENGTH_AS_EFFECT',feature:[...features].sort(),path:rel,line:line(source,i),
        responseField:x[1],collection:x[2],basis:'Response effect count uses collection length while preceding INSERT may be suppressed',
        codeSha256:sha(source),status:'H0_UNVERIFIED',priority:'investigate',
        provenance:{sql:source.slice(i,i+75).replace(/\s+/g,' '),response:x[0]}});
    }
  }
  return results;
}
function main(){
  const mapped=knownFiles(),findings=[];
  for(const [rel,features] of [...mapped].sort((a,b)=>a[0].localeCompare(b[0]))){
    const abs=path.join(ROOT,rel);
    if(!fs.existsSync(abs))continue;
    const source=fs.readFileSync(abs,'utf8');
    findings.push(...inspect(source,rel,features));
  }
  const report={schema:'feature-output-hypotheses/v1',status:'STATIC_HYPOTHESES_NOT_PROOFS',
    scanScope:{featureFileCount:fs.readdirSync(FEAT).filter(x=>x.endsWith('.feature.js')).length,
      mappedServiceRouteCount:mapped.size,scannedSourceCount:[...mapped.keys()].filter(p=>fs.existsSync(path.join(ROOT,p))).length},
    findings,metrics:{hypotheses:findings.length,unknownTrueBugs:'NOT_MEASURED'},
    digest:sha(JSON.stringify(findings))};
  const output=process.env.FP_HYPOTHESIS_OUTPUT;
  if(output)fs.writeFileSync(path.resolve(output),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({scope:report.scanScope,metrics:report.metrics,findings:report.findings.map(({kind,path,line,feature})=>({kind,path,line,feature})),digest:report.digest},null,2));
}
if(require.main===module)main();
module.exports={inspect};
