#!/usr/bin/env node
'use strict';
/**
 * Exploratory governance graph scanner. No named bug or preselected domain.
 * Reads every feature card, its declared files, @db-write authority and
 * invariant tests, builds candidate seams for independent runtime probes.
 * Does NOT claim a bug without an observed failing state transition.
 */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const ROOT=path.resolve(__dirname,'../..');
const FDIR=path.join(ROOT,'features');
const git=(args)=>{const r=cp.spawnSync('git',args,{cwd:ROOT,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim()};
const featurePaths=fs.readdirSync(FDIR).filter(x=>x.endsWith('.feature.js')).map(f=>'features/'+f).sort();
const features=featurePaths.map(file=>{const data=require(path.join(ROOT,file));return{...data,file}});
const byPath=new Map(),byTable=new Map(),invariants=[],findings=[];
function add(file,feature,kind){
 if(!byPath.has(file))byPath.set(file,[]);
 byPath.get(file).push({feature,kind});
}
for(const feature of features){
 const files=feature.files||{};
 for(const [kind,names]of Object.entries(files)){
  if(!Array.isArray(names))continue;
  for(const file of names)if(typeof file==='string')add(file,feature.name,kind);
 }
 for(const t of feature.db?.tables||[]){
  if(typeof t!=='string')continue;
  const m=/^\s*([a-z][a-z0-9_]*)\s*:\s*(RW!?|R|W!?)/.exec(t);
  if(!m)continue;
  const name=m[1],mode=m[2];
  if(!byTable.has(name))byTable.set(name,[]);
  byTable.get(name).push({feature:feature.name,mode});
 }
 for(const inv of feature.invariants||[]){
  if(typeof inv==='string'){invariants.push({feature:feature.name,statement:inv,tests:[],explicit:false});continue;}
  if(inv&&typeof inv==='object'){
   const tests=[inv.test,...(Array.isArray(inv.tests)?inv.tests:[])].filter(x=>typeof x==='string');
   invariants.push({feature:feature.name,statement:inv.statement||inv.name||'unknown',tests,explicit:true});
  }
 }
}
const fileText=new Map();
function contents(file){
 if(!fileText.has(file)){
  try{fileText.set(file,fs.readFileSync(path.join(ROOT,file),'utf8'))}
  catch{fileText.set(file,null)}
 }
 return fileText.get(file);
}
const producer=(file)=> {
 const s=contents(file)||'';
 const m=/@db-write\s+([^\n]+)/.exec(s);
 return m?m[1].split(',').map(x=>x.trim().split(/\s/)[0]).filter(x=>/^[a-z][a-z0-9_]*$/.test(x)):[];
};
function register(severity,kind,body){findings.push({severity,kind,...body})}
const testNames=new Set([...byPath.keys()].filter(f=>f.startsWith('tests/')));
for(const inv of invariants){
 if(!inv.explicit||!inv.tests.length){
  if(inv.statement.length>28)register('REVIEW','INVARIANT_WITHOUT_EXECUTABLE_PROOF',
   {feature:inv.feature,invariant:inv.statement.slice(0,175)});
  continue;
 }
 for(const testPath of inv.tests){
  const text=contents(testPath);
  if(text===null){
   register('HIGH','INVARIANT_TEST_MISSING',
    {feature:inv.feature,test:testPath,invariant:inv.statement.slice(0,165)});
   continue;
  }
  const gated=/(describe|test|it)\.skip\s*\(/.test(text)||(/describe\.skip/.test(text));
  const mock=/jest\.mock\s*\(/.test(text);
  const pg=Boolean(/(?:DATABASE_URL|hasIntegrationEnv)/.test(text));
  if(gated)register('REVIEW','INVARIANT_TEST_HAS_SKIP_PATH',
    {feature:inv.feature,test:testPath,invariant:inv.statement.slice(0,155),postgresGated:pg});
  // A mock-based test is not evidence of a DB-level invariant.
  if(mock&&/\b(?:atomic|transaction|idempot|doubl|rollback|concurrent|FOR UPDATE|persist|réel|database|PostgreSQL)\b/i.test(inv.statement)){
   register('REVIEW','DB_INVARIANT_PROVED_BY_MOCK_ONLY',
    {feature:inv.feature,test:testPath,invariant:inv.statement.slice(0,160)});
  }
 }
}
for(const [table,claims] of byTable){
 const exclusive=claims.filter(c=>c.mode==='RW!'||c.mode==='W!');
 if(exclusive.length>1)register('HIGH','MULTIPLE_EXCLUSIVE_TABLE_AUTHORITIES',{table,claims});
 if(!exclusive.length)continue;
 const authority=new Set(exclusive.map(c=>c.feature));
 for(const [file,refs]of byPath){
  if(!refs.some(r=>['services','routes'].includes(r.kind)))continue;
  const writes=producer(file);
  if(!writes.includes(table))continue;
  const writerFeatures=new Set(refs.map(r=>r.feature));
  if(![...authority].some(x=>writerFeatures.has(x))){
   register('REVIEW','WRITE_HEADER_OUTSIDE_EXCLUSIVE_OWNER',{
    table,authority:[...authority],file,declaredBy:[...writerFeatures],writerHeader:writes
   });
  }
 }
}
for(const [file,refs] of byPath){
 if(!file.startsWith('services/'))continue;
 const c=contents(file);
 if(c===null)register('HIGH','DECLARED_SERVICE_MISSING',{file,features:refs.map(x=>x.feature)});
 else if(refs.length>1&&producer(file).length){
  register('INFO','MULTI_FEATURE_SERVICE_WRITER',{file,features:refs.map(x=>x.feature),tables:producer(file)});
 }
}
// New pattern learned from one proven counterexample: a caller-supplied
// identity wins over an identity read from the authoritative DB entity.
// Scan all registered service/route source paths, not a hardcoded feature.
for(const [file,refs] of byPath){
 if(!refs.some(r=>r.kind==='services'||r.kind==='routes'))continue;
 const src=contents(file)||'';
 const re=/\b(?:const|let)\s+([A-Za-z_$][\w$]*(?:Id|_id))\s*=\s*([A-Za-z_$][\w$]*)\s*\|\|\s*([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*(?:Id|_id))\s*;/g;
 for(const m of src.matchAll(re)){
   const [expr,target,input,dbRow,dbField]=m;
   const ln=src.slice(0,m.index).split('\n').length;
   register('REVIEW','CALLER_IDENTITY_OVERRIDES_CANONICAL_ROW',{
     feature:[...new Set(refs.map(r=>r.feature))],file,line:ln,
     target,input,dbRow,dbField,evidence:expr,
     invariantCandidate:'The caller override must be equal to the canonical row identity, not trusted by precedence.',
   });
 }
}
const summary={
 sha:git(['rev-parse','HEAD']),features:features.length,
 filesOwned:byPath.size,tables:byTable.size,invariants:invariants.length,
 explicitlyTested:invariants.filter(x=>x.explicit&&x.tests.length).length,
 findings:findings.length,byKind:Object.fromEntries([...new Set(findings.map(x=>x.kind))]
 .map(k=>[k,findings.filter(x=>x.kind===k).length])),
 caveat:'Candidate contradictions in governance vs declared code. No runtime bug asserted.',
};
const out=process.argv.includes('--out')?process.argv[process.argv.indexOf('--out')+1]:'/tmp/komerce-novel-discovery';
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(path.join(out,'findings.json'),JSON.stringify(findings,null,2)+'\n');
fs.writeFileSync(path.join(out,'graph.json'),JSON.stringify({invariants,tableClaims:Object.fromEntries(byTable),fileClaims:Object.fromEntries(byPath)},null,2)+'\n');
console.log('DISCOVERY_GRAPH_SUMMARY '+JSON.stringify(summary));
const priority = findings.filter(x=>x.severity==='HIGH' || [
 'WRITE_HEADER_OUTSIDE_EXCLUSIVE_OWNER', 'DB_INVARIANT_PROVED_BY_MOCK_ONLY',
 'INVARIANT_TEST_HAS_SKIP_PATH', 'CALLER_IDENTITY_OVERRIDES_CANONICAL_ROW'
].includes(x.kind));
for(const finding of priority.slice(0,150))
 console.log('DISCOVERY_PRIORITY '+JSON.stringify(finding));
const underproved=Object.entries(Object.groupBy(
  findings.filter(x=>x.kind==='INVARIANT_WITHOUT_EXECUTABLE_PROOF'),x=>x.feature))
  .map(([feature,items])=>({feature,count:items.length})).sort((a,b)=>b.count-a.count);
console.log('DISCOVERY_UNPROVEN_BY_FEATURE '+JSON.stringify(underproved.slice(0,20)));
