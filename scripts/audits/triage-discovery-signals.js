#!/usr/bin/env node
'use strict';
/**
 * READ ONLY — classify discovery signals by evidence and documented debts.
 * Does not infer a confirmed business bug or authorize automatic code changes.
 */
const fs=require('node:fs');
const path=require('node:path');
const debt=require('../../governance/writer-not-owner-debt.json');
const TEST_SCOPE=/(?:^routes\/admin\/system\.js$|^services\/simulator\/|^services\/simulation-scope-service\.js$)/;
function classify(f){
 if(f.kind==='WRITE_HEADER_OUTSIDE_EXCLUSIVE_OWNER'){
  const entry=debt.entries.find(x=>x.table===f.table &&
    (f.declaredBy||[]).includes(x.writer) &&
    (!x.sites?.length||x.sites.some(s=>s.split('#')[0]===f.file)));
  return {...f,
   assessment:entry?'REGISTERED_CROSS_OWNER_DEBT':
    f.evidenceTier==='DIRECT_SQL_TEXT_HINT'?
     TEST_SCOPE.test(f.file)?'TEST_OR_ADMIN_SCOPE_REVIEW':'UNREGISTERED_SQL_WRITE_REVIEW':
    'DECLARATIVE_HEADER_ONLY',
   confidence:'GOVERNANCE_SIGNAL_ONLY',
   debtStatus:entry?.status||null,
   ownerDocumentedRisk:entry?.risk||null,
   explanation:entry?.reason||null};
 }
 const mapping={
  MANUAL_FIELD_PROVENANCE_IGNORED_BY_UPSERT:'DOMAIN_SEMANTIC_INVARIANT_REVIEW',
  EXEMPTION_WRITE_UNGUARDED:'DOMAIN_SEMANTIC_INVARIANT_REVIEW',
  EXEMPTION_READ_UNGUARDED:'DOMAIN_SEMANTIC_INVARIANT_REVIEW',
  CALLER_IDENTITY_OVERRIDES_CANONICAL_ROW:'CODE_PATTERN_REQUIRES_REAL_DB',
  SILENT_CONFLICT_COUNT_AS_SUCCESS:'CODE_PATTERN_REQUIRES_REAL_DB',
  DB_INVARIANT_PROVED_BY_MOCK_ONLY:'INVARIANT_EVIDENCE_GAP',
  INVARIANT_TEST_HAS_SKIP_PATH:'INVARIANT_EVIDENCE_GAP',
  INVARIANT_WITHOUT_EXECUTABLE_PROOF:'INVARIANT_EVIDENCE_GAP'
 };
 return {...f,assessment:mapping[f.kind]||'OTHER_REVIEW',confidence:'GOVERNANCE_SIGNAL_ONLY'};
}
const priority={
 DOMAIN_SEMANTIC_INVARIANT_REVIEW:1,
 CODE_PATTERN_REQUIRES_REAL_DB:2,
 UNREGISTERED_SQL_WRITE_REVIEW:3,
 REGISTERED_CROSS_OWNER_DEBT:4,
 TEST_OR_ADMIN_SCOPE_REVIEW:5,
 DECLARATIVE_HEADER_ONLY:6,
 INVARIANT_EVIDENCE_GAP:7,
 OTHER_REVIEW:8
};
function triage(findings){
 const ranked=findings.map(classify).map((x,i)=>({...x,signalIndex:i}));
 ranked.sort((a,b)=>(priority[a.assessment]||9)-(priority[b.assessment]||9) || String(a.file||'').localeCompare(String(b.file||'')));
 const by=(items,key)=>Object.fromEntries([...new Set(items.map(x=>x[key]))].sort().map(k=>[k,items.filter(x=>x[key]===k).length]));
 const classified=ranked.filter(x=>x.kind==='WRITE_HEADER_OUTSIDE_EXCLUSIVE_OWNER');
 const summary={
  total:ranked.length,byKind:by(ranked,'kind'),byAssessment:by(ranked,'assessment'),
  crossedDeclarations:classified.length,
  sqlDirectHints:classified.filter(x=>x.evidenceTier==='DIRECT_SQL_TEXT_HINT').length,
  headerOnly:classified.filter(x=>x.evidenceTier==='HEADER_ONLY_UNVERIFIED').length,
  knownWriterDebtSites:classified.filter(x=>x.assessment==='REGISTERED_CROSS_OWNER_DEBT').length,
  claimedRuntimeBugs:0,
  caveat:'All are review signals; real nominal+adversarial PostgreSQL proofs are required before bug confirmation.'
 };
 return {summary,ranked};
}
function render(report){
 const out=[
  '# Triage du graphe de gouvernance Komerce — diagnostic', '',
  'SHA: '+(process.env.GITHUB_SHA||'UNSPECIFIED'), '',
  '**Cette analyse classe des signaux, pas des bugs confirmés.**', '',
  'Déclarations interdomaines : '+report.summary.crossedDeclarations+
  ' ; indices SQL directs : '+report.summary.sqlDirectHints+
  ' ; déclarations seules : '+report.summary.headerOnly+'.', '',
  '## Classes de preuve', '',
  '| Qualification | Nombre |',
  '|---|---:|',
  ...Object.entries(report.summary.byAssessment).map(([a,n])=>'| '+a+' | '+n+' |'),
  '', '## Traversées à examiner (priorité hors fonctions simulées)', '',
  '| Qualification | Table | Fichier | Contrôle |',
  '|---|---|---|---|'
 ];
 const groups=report.ranked.filter(x=>x.kind==='WRITE_HEADER_OUTSIDE_EXCLUSIVE_OWNER')
  .sort((a,b)=>(priority[a.assessment]||9)-(priority[b.assessment]||9));
 for(const f of groups.slice(0,90))out.push('| '+f.assessment+' | '+f.table+' | '+
  f.file+' | '+(f.debtStatus||f.evidenceTier||'review')+' |');
 out.push('', '## Règle de preuve', '',
  'Un signal ne devient BUG_REPRODUIT que si le service réel et PostgreSQL produisent une paire étalonnée NOMINAL + DEVIATION avec état réellement relu.',
  'Les dettes documentées ne sont pas automatiquement des régressions et les entêtes @db-write ne prouvent pas une écriture SQL.');
 return out.join('\n')+'\n';
}
function main(){
 const args=process.argv.slice(2);
 const pathIn=args[0];
 const outIdx=args.indexOf('--out');
 const outPath=outIdx>=0?args[outIdx+1]:'audit-results/triage';
 if(!pathIn||!outPath)throw Error('Usage: triage-discovery-signals.js FINDINGS.json [--out DIR]');
 const {summary,ranked}=triage(JSON.parse(fs.readFileSync(pathIn,'utf8')));
 fs.mkdirSync(outPath,{recursive:true});
 fs.writeFileSync(path.join(outPath,'signal-triage.json'),JSON.stringify({summary,ranked},null,2)+'\n');
 fs.writeFileSync(path.join(outPath,'signal-triage.md'),render({summary,ranked}));
 console.log('DISCOVERY_SIGNAL_TRIAGE '+JSON.stringify(summary));
}
if(require.main===module){
 try{main()}catch(e){console.error(e.stack);process.exitCode=1}
}
module.exports={classify,triage,render};
