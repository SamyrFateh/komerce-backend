#!/usr/bin/env node
'use strict';
/*
 * Contextual triage of whole-repo textual candidates, not an automatic bug
 * verifier. Never use path heuristics to certify a signal as safe or broken.
 */
const fs=require('node:fs'),path=require('node:path');
const debt=require('../../governance/writer-not-owner-debt.json');
const arg=process.argv.slice(2);
const flag=(name,d)=>{let i=arg.indexOf(name);return i<0?d:arg[i+1];};
const dir=path.resolve(flag('--input','audit-results/repo-wide/main')),out=path.resolve(flag('--out','audit-results/repo-wide/triage'));
const findings=JSON.parse(fs.readFileSync(path.join(dir,'findings.json'),'utf8'));
const known=[
 'CALLER_IDENTITY_OVERRIDES_CANONICAL_ROW|services/inventory-service.js',
 'SILENT_CONFLICT_COUNT_AS_SUCCESS|services/auto-parcel.js',
 'EXEMPTION_WRITE_UNGUARDED|services/hub-operations.js',
 'EXEMPTION_READ_UNGUARDED|services/sourcing-analysis.js',
 'MANUAL_FIELD_PROVENANCE_IGNORED_BY_UPSERT|services/suppliers/catalog-import-json.js',
 'MANUAL_PROVENANCE_ERASED_BY_JSONB_MERGE|services/sourcing-candidate-import-service.js'
];
function classify(item){
 const f=item.file, k=item.kind;
 let assignment='UNREVIEWED',tier='REVIEW',why='Source evidence only';
 if(known.includes(k+'|'+f)){
  assignment='CALIBRATED_PATTERN_ALREADY_KNOWN';
  why='Part of previous nominal/adversarial calibration; not a fresh bug discovery';
 }else if(k==='APPEND_ONLY_ASSOCIATION_REPLAY_RISK'){
  assignment='COLLECTION_REPLAY_SEMANTIC_REVIEW';
  tier='PRIORITY_REVIEW';
  why='Owner-like reconciliation writes a junction with ON CONFLICT DO NOTHING and no removal; distinguish complete snapshot replacement from incremental deltas, and prove any stale-link consumer effect on PostgreSQL';
 }else if(['CROSS_OWNER_SQL_WRITER','UNDECLARED_SQL_WRITER'].includes(k)){
  const entry=debt.entries.find(e=>e.table===item.table&&(e.sites||[]).some(s=>s.split('#')[0]===f));
  if(entry){
   assignment='REGISTERED_WRITER_DEBT';
   why=entry.reason;
  }else if(/^scripts\//.test(f)||/^tmp[-_]/.test(f)){
   assignment='OFFLINE_SCRIPT_REQUIRES_SCOPE_REVIEW';
   why='Manual operational/seed/cleanup scripts may legitimately write these tables; guards and authorized invocation still need review';
  }else if(/(^|\/)simulator\/|^routes\/admin\/system\.js$/.test(f)){
   assignment='SIMULATOR_OR_ADMIN_WORKFLOW_REVIEW';
   why='Intentionally stateful admin/simulation path; review reachability and safety constraints';
  }else if(item.bucket==='backend-runtime'){
   assignment='RUNTIME_CROSS_OWNER_SQL_REVIEW';
   tier='PRIORITY_REVIEW';
   why='Potential runtime writer outside exclusive domain; validate ownership and legitimate delegation';
  }else{
   assignment='OTHER_SQL_CONTEXT_REVIEW';
   why='Check actual runtime reachability and ownership';
  }
 }
 return {...item,assignment,tier,why};
}
const outRows=findings.map(classify);
const counts={};for(const x of outRows)counts[x.assignment]=(counts[x.assignment]||0)+1;
const high=outRows.filter(x=>x.assignment==='RUNTIME_CROSS_OWNER_SQL_REVIEW');
const unique=new Map();
for(const x of high)unique.set(x.file+'|'+x.table,x);
const prioritized=[...unique.values()].sort((a,b)=>a.file.localeCompare(b.file)||String(a.table).localeCompare(String(b.table)));
const result={count:outRows.length,byClass:counts,
 priorityRuntimeSQL:high.length,priorityUniqueSites:prioritized.length,
 recommendedSample:prioritized.slice(0,40).map(x=>({kind:x.kind,file:x.file,line:x.line,table:x.table,
 status:'UNREVIEWED_NOT_A_BUG_VERDICT'})),
 caution:'Even calibrated bugs are only considered reproduced by the separate paired real-PostgreSQL integration suite. Source files absent from feature cards need human/domain review; offline scripts are not automatically safe.'
};
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'triaged-findings.json'),JSON.stringify(outRows,null,2)+'\n');
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(result,null,2)+'\n');
const md=['# Komerce repo-wide: signal triage','',
 'No count below represents confirmed new bugs. Classifications are file-purpose hints only.','',
 '| Category | Count |','|---|---:|',
 ...Object.entries(counts).sort().map(([a,n])=>'| '+a+' | '+n+' |'),
 '', '## Runtime candidates independent of calibrated patterns and registered debts','',
 '| File | Table | Kind |','|---|---|---|',
 ...prioritized.slice(0,60).map(x=>'| '+x.file+' | '+x.table+' | '+x.kind+' |'),
 '', 'Real PostgreSQL nominal/deviation proof required before any BUG verdict.'].join('\n')+'\n';
fs.writeFileSync(path.join(out,'triage.md'),md);
console.log('REPO_WIDE_TRIAGE '+JSON.stringify({count:result.count,byClass:result.byClass,priorityRuntimeSQL:high.length,priorityUniqueSites:prioritized.length}));
console.log('REPO_WIDE_RUNTIME_PRIORITY '+JSON.stringify(result.recommendedSample.slice(0,30)));
