#!/usr/bin/env node
'use strict';
// Feature-derived irreversible-state hypothesis generator; read-only, no npm.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..'), DIR=path.join(ROOT,'features');
const findings=[],featureFiles=fs.readdirSync(DIR).filter(x=>x.endsWith('.feature.js')).sort();
const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
for(const filename of featureFiles){
 const spec=require(path.join(DIR,filename));
 const contractText=JSON.stringify({invariants:spec.invariants,classification:spec.classification,perimeter:spec.perimeter});
 const commitment=/(irr[eé]versib|terminal|no[_-]?reopen|one[_-]?way)/i.exec(contractText);
 if(!commitment)continue;
 for(const raw of spec.files?.routes||[]){
  const rel=String(raw).replace(/\\/g,'/');
  if(!/^routes\/[a-zA-Z0-9_./-]+\.js$/.test(rel)||rel.includes('..'))continue;
  const full=path.join(ROOT,rel);if(!fs.existsSync(full))continue;
  const src=fs.readFileSync(full,'utf8');
  // Only SQL UPDATEs that write status from an arbitrary API input.
  const re=/\bUPDATE\s+([a-z_][a-z0-9_]*)\s+SET\s+status\s*=\s*\$\d+([\s\S]{0,550}?)\bWHERE\s+([\s\S]{0,180}?)\bRETURNING\b/gi;
  for(const m of src.matchAll(re)){
   const predicate=m[3].replace(/\s+/g,' ').trim();
   if(/\bstatus\s*(?:=|IN\b|IS\b)|\bresolved_at\s+IS\s+NULL/i.test(predicate))continue;
   findings.push({kind:'TERMINAL_STATE_WITHOUT_SOURCE_GUARD',status:'H0_UNVERIFIED',feature:spec.name,
     path:rel,table:m[1],line:src.slice(0,m.index).split('\n').length,predicate,
     provenance:{commitment:commitment[0],contractPath:'features/'+filename,codeSha256:digest(src)}});
  }
 }
}
const report={schema:'feature-terminal-transition-hypotheses/v1',source:'feature invariants and classification',scanScope:{featureCount:featureFiles.length},findings,metrics:{hypotheses:findings.length,confirmed:0},digest:digest(JSON.stringify(findings))};
if(process.env.FP_TERMINAL_HYPOTHESES_OUTPUT)fs.writeFileSync(path.resolve(process.env.FP_TERMINAL_HYPOTHESES_OUTPUT),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
