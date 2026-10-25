#!/usr/bin/env node
'use strict';
/*
 * READ ONLY: inventory ALL tracked files via git ls-files (not feature cards).
 * Statically inspect all readable runtime JS/TS/HTML and SQL evidence, even
 * when the file was omitted from governance. No production mutation, no fixes.
 */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {scanNovelPatterns}=require('./lib/novel-bug-patterns');
const {discoverExemptionPairs,scanExemptionSinks}=require('./lib/exemption-invariant-detectors');
const {getProtectedManualFields,scanUnprotectedManualUpserts,scanManualProvenanceErasingMerges}=require('./lib/manual-provenance-detectors');
const argv=process.argv.slice(2);
const arg=(key,def)=>{const i=argv.indexOf(key);return i<0?def:argv[i+1];};
const ROOT=path.resolve(arg('--root','.')),OUT=path.resolve(arg('--out','audit-results/repo-wide'));
const MAX_BYTES=8*1024*1024;
const CODE_EXT=new Set(['.js','.cjs','.mjs','.jsx','.ts','.tsx','.vue','.html','.htm']);
const SOURCE_EXT=new Set([...CODE_EXT,'.sql','.py','.ps1','.sh','.bash']);
const BUCKETS=['backend-runtime','frontend','scripts','tests','governance','documentation','database-schema','ci','other'];
const bucket=f=>{
 if(/^(?:tests|test|__tests__)\//.test(f)||/(?:^|\/)__tests__\//.test(f)||/(?:\.test|\.spec)\.[cm]?[jt]sx?$/.test(f))return 'tests';
 if(/^docs\//.test(f)||/\.mdx?$/.test(f))return 'documentation';
 if(/^migrations\//.test(f)||/\.sql$/.test(f))return 'database-schema';
 if(/^(?:dashboards|public|js|frontend|client|src\/components|views)\//.test(f))return 'frontend';
 if(/^(?:services|routes|middleware|utils|bootstrap|jobs|workers|crons|queues|tasks|src\/server)\//.test(f)||/^(?:app|server|db)\.[cm]?js$/.test(f))return 'backend-runtime';
 if(/^scripts\/|^bin\//.test(f))return 'scripts';
 if(/^\.github\//.test(f))return 'ci';
 if(/^features\/|^governance\//.test(f))return 'governance';
 return 'other';
};
function git(...args){
 const r=cp.spawnSync('git',args,{cwd:ROOT,encoding:'utf8',maxBuffer:100*1024*1024});
 if(r.status!==0)throw Error('git '+args.join(' ')+': '+r.stderr);
 return r.stdout.trim();
}
const tracked=git('ls-files','--cached','-z').split('\0').filter(Boolean);
const trackedSet=new Set(tracked),sha=git('rev-parse','HEAD'),commitDate=git('log','-1','--format=%cI');
const inventory=[],source=new Map(),textPaths=new Set();
function read(f){
 let st;
 try{st=fs.lstatSync(path.join(ROOT,f));}
 catch(e){return{status:'MISSING',reason:e.code};}
 if(st.isSymbolicLink())return{status:'SYMLINK_NOT_FOLLOWED'};
 if(!st.isFile())return{status:'NOT_FILE'};
 if(st.size>MAX_BYTES)return{status:'TOO_LARGE',bytes:st.size};
 try{
  const buf=fs.readFileSync(path.join(ROOT,f));
  if(buf.subarray(0,8192).includes(0))return{status:'BINARY',bytes:buf.length};
  const s=buf.toString('utf8');
  if(s.includes('\ufffd'))return{status:'INVALID_UTF8',bytes:buf.length};
  return{status:'TEXT_READ',bytes:buf.length,text:s};
 }catch(e){return{status:'READ_ERROR',reason:e.code};}
}
for(const f of tracked){
 const ext=path.extname(f).toLowerCase(),res=read(f);
 inventory.push({file:f,bucket:bucket(f),extension:ext||'(none)',status:res.status,bytes:res.bytes??null});
 if(res.status==='TEXT_READ'){
  textPaths.add(f);
  if(CODE_EXT.has(ext)||ext==='.sql')source.set(f,res.text);
 }
}
const codeFiles=[...source].filter(([f])=>CODE_EXT.has(path.extname(f).toLowerCase())&&!/^scripts\/audits\//.test(f)&&bucket(f)!=='tests'&&bucket(f)!=='governance'&&bucket(f)!=='ci'&&bucket(f)!=='documentation');
const codeSet=new Set(codeFiles.map(([f])=>f));
const byFile=new Map(),byTable=new Map(),governanceErrors=[];
const featureFiles=tracked.filter(f=>/^features\/.*\.feature\.js$/.test(f)&&textPaths.has(f));
for(const f of featureFiles){
 try{
  const feature=require(path.join(ROOT,f));
  for(const [type,paths]of Object.entries(feature.files||{})){
   if(!Array.isArray(paths))continue;
   for(const x of paths){if(typeof x!=='string')continue;const a=byFile.get(x)||[];a.push({name:feature.name,type});byFile.set(x,a);}
  }
  for(const item of feature.db?.tables||[]){
   if(typeof item!=='string')continue;
   const m=/^\s*([a-z][a-z0-9_]*)\s*:\s*(RW!?|R|W!?)/.exec(item);
   if(!m)continue;
   const a=byTable.get(m[1])||[];a.push({name:feature.name,mode:m[2]});byTable.set(m[1],a);
  }
 }catch(e){governanceErrors.push({file:f,reason:String(e.message||e).slice(0,240)});}
}
const exclusive=new Map();
for(const [table,claims]of byTable){
 const owners=[...new Set(claims.filter(c=>c.mode==='RW!'||c.mode==='W!').map(c=>c.name))];
 if(owners.length)exclusive.set(table,owners);
}
const ownersOf=f=>[...new Set((byFile.get(f)||[]).map(x=>x.name))];
const schemaFile='docs/db/railway-live-schema.sql';
const schema=source.get(schemaFile)||'';
const exemptionPairs=discoverExemptionPairs(schema).filter(x=>byTable.has(x.table));
const findings=[];
const push=(c,f,x)=>findings.push({kind:c,file:f,bucket:bucket(f),evidenceTier:'TEXT_REVIEW',...x});
for(const [f,s]of codeFiles){
 for(const item of scanNovelPatterns(s,f))
  push(item.kind,f,{line:item.line,evidence:item.evidence,detector:'generic-lexical'});
 for(const item of scanExemptionSinks(s,f,exemptionPairs))
  push(item.kind,f,{line:item.line,table:item.table,field:item.field,flag:item.flag,function:item.function,detector:'schema-derived'});
}
const tablesWithManualLocks=[];
for(const [table,owners]of exclusive){
 const ownerSources=codeFiles.filter(([f])=>ownersOf(f).some(n=>owners.includes(n)));
 const protectedFields=[...new Set(ownerSources.flatMap(([,s])=>getProtectedManualFields(s,table)))];
 if(!protectedFields.length)continue;
 tablesWithManualLocks.push({table,fields:protectedFields});
 for(const [f,s]of codeFiles){
  const owning=ownersOf(f).some(n=>owners.includes(n));
  if(owning){
   for(const item of scanManualProvenanceErasingMerges(s,f,table,protectedFields))
    push(item.kind,f,{line:item.line,table,protectedFields:item.protectedFields,evidence:item.evidence,detector:'owner-provenance'});
  }else{
   for(const item of scanUnprotectedManualUpserts(s,f,table,protectedFields))
    push(item.kind,f,{line:item.line,table,field:item.field,evidence:item.evidence,detector:'owner-to-writer-diff'});
  }
 }
}
// Explicit scan of SQL mutation text across ALL tracked runtime code paths.
// File/table/operation is counted once. SQL in a string is not proof of execution.
const sqlSites=[];
const re=/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE\s+TABLE)\s+(?:public\.)?([a-z][a-z0-9_]*)\b/gi;
for(const [f,s]of codeFiles){
 const stripped=s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[ \t])\/\/[^\n]*/gm,'$1');
 const entries=new Map();
 for(const match of stripped.matchAll(re)){
  const table=match[2].toLowerCase();
  if(!byTable.has(table))continue;
  const op=match[1].toUpperCase().replace(/\s+/g,' '),key=table+'|'+op;
  if(!entries.has(key))entries.set(key,{table,operation:op,firstLine:stripped.slice(0,match.index).split('\n').length,occurrences:0});
  entries.get(key).occurrences++;
 }
 for(const site of entries.values()){
  sqlSites.push({file:f,bucket:bucket(f),...site});
  const owners=exclusive.get(site.table)||[];
  if(!owners.length||ownersOf(f).some(n=>owners.includes(n)))continue;
  const declared=ownersOf(f);
  const k=declared.length?'CROSS_OWNER_SQL_WRITER':'UNDECLARED_SQL_WRITER';
  push(k,f,{table:site.table,operation:site.operation,line:site.firstLine,
   ownerFeatures:owners,declaredFeatures:declared,occurrences:site.occurrences,
   detector:'all-tracked-code',description:'Textual SQL evidence, verify runtime reachability and legitimate delegation'});
 }
}
function count(items,key){
 const obj={};for(const x of items){const k=key(x);obj[k]=(obj[k]||0)+1;}return Object.fromEntries(Object.entries(obj).sort());
}
const unprocessed=inventory.filter(x=>x.status!=='TEXT_READ');
const codeInventory=inventory.filter(x=>SOURCE_EXT.has(x.extension));
const eligible=inventory.filter(x=>CODE_EXT.has(x.extension));
const governancePaths=[...byFile.keys()];
const summary={
 sha,commitDate,scope:'git ls-files, current checkout, no source paths excluded from inventory',
 trackedFiles:inventory.length,readableUtf8:textPaths.size,unprocessedFiles:unprocessed.length,
 unreadableReasons:count(unprocessed,x=>x.status),
 sourceExtensionFiles:codeInventory.length,jsTsHtmlVueFiles:eligible.length,
 analyzableRuntimeFiles:codeFiles.length,
 runtimeFilesMissingFeatureDeclaration:codeFiles.filter(([f])=>!byFile.has(f)).length,
 declaredPaths:governancePaths.length,declaredPathsExisting:governancePaths.filter(f=>trackedSet.has(f)).length,
 declaredPathsMissing:governancePaths.filter(f=>!trackedSet.has(f)).length,
 featureCards:featureFiles.length,governanceErrors,tableDeclarations:byTable.size,
 exclusiveTables:exclusive.size,exemptionPairs:exemptionPairs.length,provenanceOwnerTables:tablesWithManualLocks.length,
 sqlTextFileTableOperations:sqlSites.length,
 totalHeuristicSignals:findings.length,byKind:count(findings,x=>x.kind),
 byBucket:count(inventory,x=>x.bucket),sourceExtensions:count(codeInventory,x=>x.extension),
 knownRuntimeBugsProvedByThisScan:0,
 limitations:'All git tracked files enumerated. Only text JS/TS/Vue/HTML runtime files have pattern scanning. Source maps, binary data, dependencies, dynamic SQL, interprocedural and browser runtime not semantically certified. No real DB checks in this pass.'
};
fs.mkdirSync(OUT,{recursive:true});
const save=(name,value)=>fs.writeFileSync(path.join(OUT,name),JSON.stringify(value,null,2)+'\n');
save('summary.json',summary);save('findings.json',findings);save('sql-sites.json',sqlSites);
save('coverage.json',{fileInventory:inventory,unprocessed,
 declaredMissing:governancePaths.filter(f=>!trackedSet.has(f)),
 undeclaredRuntimeFiles:codeFiles.filter(([f])=>!byFile.has(f)).map(([f])=>f)});
const top=findings.filter(x=>x.bucket==='backend-runtime'||x.bucket==='frontend')
 .filter(x=>!x.file.startsWith('scripts/audits/'))
 .slice(0,100);
const md=[
 '# Komerce: all tracked files inventory + runtime static candidates','',
 'Git SHA: '+sha+' ('+commitDate+')','',
 '**This is an inventory of the full tracked repository, NOT semantic coverage of all its behavior.**','',
 '| Metric | Count |','|---|---:|',
 ...Object.entries({Tracked:summary.trackedFiles,ReadableUTF8:summary.readableUtf8,Unprocessed:summary.unprocessedFiles,
 SourceExtensions:summary.sourceExtensionFiles,JS_TS_HTML_Vue:summary.jsTsHtmlVueFiles,
 RuntimeFilesAnalyzed:summary.analyzableRuntimeFiles,RuntimeAbsentFromGovernance:summary.runtimeFilesMissingFeatureDeclaration,
 DeclaredMissingOnDisk:summary.declaredPathsMissing,HeuristicSignals:summary.totalHeuristicSignals})
 .map(([k,v])=>'| '+k+' | '+v+' |'),
 '','## Signal families','', '| Kind | Count |','|---|---:|',
 ...Object.entries(summary.byKind).map(([k,v])=>'| '+k+' | '+v+' |'),
 '','## Sample for human triage','', '| Kind | File | Line | Table |','|---|---|---:|---|',
 ...top.slice(0,60).map(x=>'| '+x.kind+' | '+x.file+' | '+(x.line||'')+' | '+(x.table||'')+' |'),
 '','The scanner never marks a static signal as a confirmed bug. See coverage.json for every Git-tracked file, including skipped/binary formats, and findings.json for every static candidate.'
].join('\n')+'\n';
fs.writeFileSync(path.join(OUT,'report.md'),md);
console.log('REPO_WIDE_SCAN '+JSON.stringify(summary));
console.log('REPO_WIDE_TOP '+JSON.stringify(top.slice(0,25).map(x=>({kind:x.kind,file:x.file,line:x.line,table:x.table||null}))));
console.log('REPO_WIDE_SKIP_SAMPLE '+JSON.stringify(unprocessed.slice(0,10)));
