#!/usr/bin/env node
'use strict';
// Read-only business lens complementary to existing audit-logic.js.
const fs=require('fs'),path=require('path'),cp=require('child_process');
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
 const argv=process.argv.slice(2),i=argv.indexOf('--out'),out=i<0?'/tmp/komerce-business-audit':argv[i+1];
 const tracked=git(['ls-files','-z']).split('\0').filter(Boolean).sort(),content=new Map();
 for(const file of tracked){if(!/\.(?:js|cjs|mjs|ts)$/.test(file)||!DIRS.some(d=>file.startsWith(d))||/(^|\/)(?:node_modules|tests|coverage)(\/|$)/.test(file))continue;content.set(file,fs.readFileSync(path.join(ROOT,file),'utf8'));}
 const r=inspect({get:f=>content.get(f)||'',tracked,sha:git(['rev-parse','HEAD'])});
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'business-audit.json'),JSON.stringify(r,null,2)+'\n');
 fs.writeFileSync(path.join(out,'business-audit.md'),markdown(r));
 console.log(JSON.stringify({sha:r.sha,census:r.census,issues:r.issues.map(x=>({rule:x.id,priority:x.priority,stage:x.stage,status:x.status,file:x.file,line:x.line})),missing:r.missing},null,2));
}
if(require.main===module)main();
module.exports={RULES,inspect,markdown};
