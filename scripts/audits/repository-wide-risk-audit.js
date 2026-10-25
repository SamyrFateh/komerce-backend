#!/usr/bin/env node
'use strict';
// Read-only business lens complementary to existing audit-logic.js.
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const {scanSource}=require('../lib/logic-detectors');
const ROOT=path.resolve(__dirname,'../..');
const RULES=[
 ['BIZ-001','P1','SOURCING','CODE_CONTRADICTION','services/sourcing-candidate-import-service.js','sourcing_candidates.data_sources || EXCLUDED.data_sources','Manual provenance lost on supplier reimport','PostgreSQL JSONB || keeps right duplicate keys; the next import can override human price.'],
 ['BIZ-002','P1','SOURCING','CODE_CONTRADICTION','services/sourcing-candidate-import-service.js','scan_result         = EXCLUDED.scan_result','Scan diverges from preserved human values','Scan recalculated on supplier data while CASE persists manual price/category/margin.'],
 ['BIZ-003','P1','SUPPLIER','CODE_CONTRADICTION','services/supplier-catalog-scanner.js','finance?.taux_pln_kmf','PLN rate still requires manual finance_config','BCE EUR/PLN quote is ingested but this path only accepts finance_config taux_pln_kmf.'],
 ['BIZ-004','P1','SUPPLIER','REVIEW_REQUIRED','services/supplier-catalog-scanner.js','const SUPPORTED_CURRENCIES','Supplier currency whitelist narrower than official quotes','CNY and GBP public quote availability does not imply payment permission; sourcing eligibility must be decided separately.'],
 ['BIZ-005','P1','SOURCING','REVIEW_REQUIRED','services/suppliers/catalog-import-orchestrator.js','if (b.is_full_snapshot) {','Missing candidate archival after incomplete full snapshot','No local proof of all supplier pages and zero intake errors before archiving absent candidates.'],
 ['BIZ-006','P2','CATALOG','REVIEW_REQUIRED','services/catalog-public-view.js','stock > 0','Zero-stock supplier SKU hidden from boutique','Check whether stock means physical on-hand or provider-orderable availability.'],
 ['BIZ-007','P2','CATALOG','REVIEW_REQUIRED','services/catalog-approval.js',"CATALOG_CAP_MVP",'MVP catalog cap blocks publication','Commercial cap is not a legal product exclusion; retain selected product with actionable reason.'],
 ['BIZ-008','P1','REFINERY','REVIEW_REQUIRED','services/sourcing-candidate-actions.js',"batchStatus !== 'COMPLETED'",'Candidate blocked by parent batch status','A healthy candidate might be blocked by a different failed reference in a partially complete batch.'],
 ['BIZ-009','P2','ECONOMICS','REVIEW_REQUIRED','services/supplier-catalog-scanner.js',"sourcingDecision = 'AVOID'",'Margin recommendation must not be mistaken for legal rejection','AVOID derived from estimated margin should remain revisitable after renegotiation.'],
 ['BIZ-010','P2','CATALOG','REVIEW_REQUIRED','services/catalog-public-view.js',"pmpd.status = 'LOCAL_ACTIVE'",'Published product invisible without market price','Visibility gate may be correct; give operator a per-market KPR reason, not a silent disappearance.'],
];
const DIRS=['services/','routes/','public/boutique/','public/dashboards/','bootstrap/','utils/','scripts/'];
function git(args){const z=cp.spawnSync('git',args,{cwd:ROOT,encoding:'utf8',maxBuffer:32*1024*1024});if(z.status!==0)throw Error(String(z.stderr).slice(0,500));return String(z.stdout).trim();}
function inspect({get,tracked,sha}){
 const issues=[],missing=[];
 for(const r of RULES){
  const [id,priority,stage,status,file,needle,title,impact]=r;
  const source=get(file),at=source.indexOf(needle);
  if(at<0){missing.push({id,file});continue;}
  const line=source.slice(0,at).split('\n').length,ls=source.split('\n');
  issues.push({id,priority,stage,status,file,line,title,impact,
   evidence:ls.slice(Math.max(0,line-2),Math.min(ls.length,line+2)).join('\n').slice(0,400),
   permalink:'https://github.com/SamyrFateh/komerce-backend/blob/'+sha+'/'+file+'#L'+line});
 }
 const src=tracked.filter(f=>/\.(?:cjs|js|mjs|ts)$/.test(f)&&DIRS.some(d=>f.startsWith(d))&&!/(^|\/)(?:tests|__tests__)(\/|$)/.test(f));
 return {contract:'komerce-business-audit-readonly-v1',sha,generated_at:new Date().toISOString(),
  census:{tracked:tracked.length,sources:src.length,sql:tracked.filter(f=>/\.sql$/.test(f)).length,tests:tracked.filter(f=>f.startsWith('tests/')).length,docs:tracked.filter(f=>f.startsWith('docs/')).length},
  issues,missing,verdict:'NOT_CERTIFICATION',dataStatus:'NOT_RUN',
  limitation:'Static evidence only; SOURCE CONTRADICTION is code-level, runtime occurrence unverified; REVIEW_REQUIRED is a hypothesis.'};
}
function markdown(r){
 const lines=['# Komerce — Business flow diagnostic','',
  'SHA: '+r.sha,'Tracked: '+r.census.tracked+'; app code: '+r.census.sources+'; SQL: '+r.census.sql+'; tests: '+r.census.tests+'; docs: '+r.census.docs,'',
  '| Rule | Priority | Flow | Type | File | Finding |','|---|---|---|---|---|---|'];
 for(const x of r.issues)lines.push('| '+x.id+' | '+x.priority+' | '+x.stage+' | '+x.status+' | '+x.file+':'+x.line+' | '+x.title+' |');
 lines.push('','## Evidence and tests to design','');
 for(const x of r.issues)lines.push('### '+x.id+' '+x.title,'',x.permalink,'',x.impact,'','    '+x.evidence.replace(/\n/g,'\n    '),'');
 lines.push('','## Limits','',r.limitation,'');
 return lines.join('\n');
}
function main(){
 const args=process.argv.slice(2),ix=args.indexOf('--out'),out=ix<0?'/tmp/komerce-all-files-audit':args[ix+1];
 const tracked=git(['ls-files','-z']).split('\0').filter(Boolean).sort();
 const sha=git(['rev-parse','HEAD']),textFiles=new Map(),manifest=[],staticFindings=[],fileAnomalies=[];
 const counts={};
 const binaryExt=new Set(['.png','.webp','.jpg','.jpeg','.gif','.ico','.zip','.exe','.docx','.pdf','.woff','.woff2']);
 const codeExt=new Set(['.js','.cjs','.mjs','.ts','.py','.sh','.ps1','.psm1']);
 const yaml=(()=>{try{return require('js-yaml');}catch{return null;}})();
 const byScope={runtime:0,tests:0,sql:0,docs:0,config:0,binary:0,other:0};
 for(const file of tracked){
  const buf=fs.readFileSync(path.join(ROOT,file));
  const ext=path.extname(file).toLowerCase();
  const binary=binaryExt.has(ext)||buf.includes(0);
  const entry={file,bytes:buf.length,sha256:crypto.createHash('sha256').update(buf).digest('hex'),checks:[],signals:0};
  const before=staticFindings.length+fileAnomalies.length;
  if(binary){
   entry.kind='BINARY';
   entry.checks.push('BYTES_READ_AND_SHA256','NO_SEMANTIC_CHECK');
   byScope.binary++;
  }else{
   const src=buf.toString('utf8');
   textFiles.set(file,src);
   if(src.includes('\ufffd'))fileAnomalies.push({file,rule:'UTF8_DECODE_REPLACEMENT',severity:'P3'});
   if(codeExt.has(ext)){
    entry.kind='CODE';
    entry.checks.push('SOURCE_BYTES_READ');
    if(['.js','.cjs','.mjs','.ts'].includes(ext)){
     const test=file.startsWith('tests/')||file.includes('/__tests__/')||/\.test\.[cm]?js$/.test(file);
     const hits=scanSource(src,file);
     entry.checks.push(test?'LOGIC_RULES_TEST_CONTEXT':'LOGIC_RULES_APP_CONTEXT');
     for(const s of hits)staticFindings.push({...s,scope:test?'TEST_ONLY':'RUNTIME_SOURCE'});
     if(test){
      byScope.tests++;
      for(const m of src.matchAll(/\b(?:test|it|describe)\.only\s*\(/g))
       staticFindings.push({rule:'FOCUSED_TEST',priority:'P1',file,line:src.slice(0,m.index).split('\n').length,scope:'TEST_ONLY'});
     }else byScope.runtime++;
    }else entry.checks.push('NO_LANGUAGE_SEMANTIC_PARSER');
   }else if(ext==='.json'){
    entry.kind='JSON';
    entry.checks.push('JSON_PARSE');
    try{JSON.parse(src);}catch(err){fileAnomalies.push({file,rule:'INVALID_JSON',severity:'P1',error:String(err.message).slice(0,150)});}
    byScope.config++;
   }else if(ext==='.yml'||ext==='.yaml'){
    entry.kind='YAML';
    if(yaml){
     entry.checks.push('YAML_PARSE');
     try{yaml.loadAll(src);}catch(err){fileAnomalies.push({file,rule:'INVALID_YAML',severity:'P1',error:String(err.message).slice(0,200)});}
    }else entry.checks.push('YAML_TEXT_READ','NO_PARSER_AVAILABLE');
    byScope.config++;
   }else if(ext==='.sql'){
    entry.kind='SQL';
    entry.checks.push('SQL_DESTRUCTIVE_STATEMENT_SCAN');
    byScope.sql++;
    for(const m of src.matchAll(/\b(?:TRUNCATE|DROP\s+TABLE|DELETE\s+FROM)\b/gi))
     staticFindings.push({rule:'SQL_DESTRUCTIVE_PATTERN',priority:'P2',file,line:src.slice(0,m.index).split('\n').length,scope:'SQL',snippet:m[0],status:'REVIEW_REQUIRED'});
   }else if(ext==='.md'||ext==='.txt'||ext==='.mmd'){
    entry.kind='DOCUMENT';
    entry.checks.push('TEXT_READ','NO_SEMANTIC_CERTIFICATION');
    byScope.docs++;
   }else if(ext==='.css'||ext==='.html'||ext==='.svg'){
    entry.kind='FRONTEND';
    entry.checks.push('SOURCE_TEXT_READ','NO_RENDERED_BROWSER_PROOF');
    byScope.runtime++;
   }else{
    entry.kind='OTHER_TEXT';
    entry.checks.push('TEXT_READ','NO_SEMANTIC_CERTIFICATION');
    byScope.other++;
   }
  }
  counts[entry.kind]=(counts[entry.kind]||0)+1;
  entry.signals=staticFindings.length+fileAnomalies.length-before;
  manifest.push(entry);
 }
 if(manifest.length!==tracked.length)throw Error('FAILED: not all tracked files read');
 const r=inspect({get:f=>textFiles.get(f)||'',tracked,sha});
 const summary={sha,tracked:tracked.length,read:manifest.length,excluded:tracked.length-manifest.length,
  kinds:counts,scope:byScope,staticFindingCount:staticFindings.length,anomalyCount:fileAnomalies.length,
  businessFindings:r.issues.length,readBytes:manifest.reduce((a,x)=>a+x.bytes,0),
  binarySemantics:'NOT_INSPECTED',postgresLive:'NOT_RUN',e2eBrowser:'NOT_RUN',
  verdict:'FULL_FILE_CENSUS_ONLY_NOT_COMPLETE_BUSINESS_CERTIFICATION'};
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'manifest.jsonl'),manifest.map(x=>JSON.stringify(x)).join('\n')+'\n');
 fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
 fs.writeFileSync(path.join(out,'static-findings.json'),JSON.stringify(staticFindings,null,2)+'\n');
 fs.writeFileSync(path.join(out,'file-anomalies.json'),JSON.stringify(fileAnomalies,null,2)+'\n');
 fs.writeFileSync(path.join(out,'business-audit.json'),JSON.stringify(r,null,2)+'\n');
 fs.writeFileSync(path.join(out,'business-audit.md'),markdown(r));
 fs.writeFileSync(path.join(out,'README.md'),[
  '# Komerce — audit de TOUS les fichiers suivis','',JSON.stringify(summary,null,2),'',
  'Un inventaire complet et un scan statique ne sont pas une revue humaine de chaque fonction.',
  'Chaque fichier est tracé dans manifest.jsonl avec le type de vérification effectué.',
  'Les assets binaires ne sont pas inspectés sémantiquement ; SQL live et Chromium sont séparés.',
  'Les findings statiques dans les tests ne sont jamais assimilés aux risques en production.',
  'La base de données staging ou production n est pas consultée.',''
 ].join('\n'));
 console.log(JSON.stringify({summary,topStatic:staticFindings.slice(0,18),business:r.issues.map(x=>({id:x.id,priority:x.priority,file:x.file,line:x.line}))},null,2));
}
if(require.main===module)main();
module.exports={RULES,inspect,markdown};
