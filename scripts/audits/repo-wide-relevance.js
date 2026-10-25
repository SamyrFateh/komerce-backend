#!/usr/bin/env node
'use strict';
/*
 * Read-only evaluation. The golden checks were already used to calibrate the
 * scanner, so "known recall" MUST NOT be called sensitivity/precision for
 * previously unseen defects. No invented true/false positives.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const flags=process.argv.slice(2);
const opt=(k,d)=>{const i=flags.indexOf(k);return i<0?d:flags[i+1]};
const base=path.resolve(opt('--audit','audit-results/repo-wide/audit'));
const target=path.resolve(opt('--main','audit-results/repo-wide/main'));
const out=path.resolve(opt('--out','audit-results/repo-wide/evaluation'));
const read=(dir,f)=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
const audited={summary:read(base,'summary.json'),findings:read(base,'findings.json'),sqlSites:read(base,'sql-sites.json')};
const main={summary:read(target,'summary.json'),findings:read(target,'findings.json'),sqlSites:read(target,'sql-sites.json')};
const known=[
 ['INVENTORY_CROSS_ORDER','services/inventory-service.js','CALLER_IDENTITY_OVERRIDES_CANONICAL_ROW'],
 ['AUTO_PARCEL_SILENT_CONFLICT','services/auto-parcel.js','SILENT_CONFLICT_COUNT_AS_SUCCESS'],
 ['HUB_REPACK_EXEMPTION','services/hub-operations.js','EXEMPTION_WRITE_UNGUARDED'],
 ['CATALOG_REIMPORT_MANUAL_OVERRIDE','services/suppliers/catalog-import-json.js','MANUAL_FIELD_PROVENANCE_IGNORED_BY_UPSERT'],
 ['SOURCING_MANUAL_PROVENANCE_ERASURE','services/sourcing-candidate-import-service.js','MANUAL_PROVENANCE_ERASED_BY_JSONB_MERGE']
];
function checkKnown(scan){
 return known.map(([caseId,file,kind])=>({
  caseId,file,kind,
  detected:scan.findings.some(x=>x.file===file&&x.kind===kind)
 }));
}
const negatives=[
 {file:'services/payment-paypal.js',table:'orders',reason:'comment-only SQL, no direct writer'},
 {file:'services/pickup-secret-service.js',table:'orders',reason:'comment-only SQL and delegated mutations'},
 {file:'services/cash-deposit-service.js',table:'market_delegation_audit',reason:'delegated audited write'},
 {file:'routes/admin-finance-config.js',table:'fx_rate_observations',reason:'delegated rate writer'}
];
function checkNegative(scan){
 return negatives.map(c=>({
  ...c,
  hasSQLTextSite:scan.sqlSites.some(x=>x.file===c.file&&x.table===c.table)
 }));
}
const knownAudit=checkKnown(audited),knownMain=checkKnown(main);
const negAudit=checkNegative(audited),negMain=checkNegative(main);
const knownKeys=new Set(known.map(x=>x[1]+'|'+x[2]));
// Stratified, deterministic selection; never cherry-pick "promising" hits
// to claim a rate of real defects. Output remains pending manual adjudication.
function sample(scan,maxPerClass=5){
 const classes=['UNDECLARED_SQL_WRITER','CROSS_OWNER_SQL_WRITER',
  'CALLER_IDENTITY_OVERRIDES_CANONICAL_ROW','SILENT_CONFLICT_COUNT_AS_SUCCESS',
  'EXEMPTION_WRITE_UNGUARDED','EXEMPTION_READ_UNGUARDED',
  'MANUAL_FIELD_PROVENANCE_IGNORED_BY_UPSERT',
  'MANUAL_PROVENANCE_ERASED_BY_JSONB_MERGE'];
 const grouped={};
 for(const x of scan.findings){
  if(!classes.includes(x.kind))continue;
  if(x.file.startsWith('scripts/audits/'))continue;
  if(knownKeys.has(x.file+'|'+x.kind))continue;
  const key=x.kind+'|'+x.bucket;
  if(!grouped[key])grouped[key]=[];
  grouped[key].push(x);
 }
 let selected=[];
 for(const [key,items]of Object.entries(grouped).sort(([a],[b])=>a.localeCompare(b))){
  const distinct=new Map(items.map(x=>[x.file+'|'+x.kind+'|'+(x.table||''),x]));
  const ordered=[...distinct.values()].sort((a,b)=>{
   const h=v=>crypto.createHash('sha256').update(scan.summary.sha+'|'+v.file+'|'+v.kind+'|'+(v.table||'')).digest('hex');
   return h(a).localeCompare(h(b));
  });
  selected.push(...ordered.slice(0,maxPerClass).map(x=>({
   file:x.file,kind:x.kind,line:x.line||null,table:x.table||null,
   bucket:x.bucket,rawEvidence:x.evidence||null,classification:'PENDING_HUMAN_AND_RUNTIME_REVIEW',
   selectionGroup:key
  })));
 }
 return selected;
}
const evalReport={
 auditSHA:audited.summary.sha,mainSHA:main.summary.sha,
 calibratedRecallAudit:{detected:knownAudit.filter(x=>x.detected).length,total:knownAudit.length,
  cases:knownAudit,qualification:'In-sample known defect patterns; NOT blind recall'},
 calibratedRecallMain:{detected:knownMain.filter(x=>x.detected).length,total:knownMain.length,
  cases:knownMain,qualification:'Signals on HEAD main, NOT confirmed new runtime defects'},
 knownNegativeControlsAudit:negAudit,
 knownNegativeControlsMain:negMain,
 auditCoverage:{tracked:audited.summary.trackedFiles,runtime:audited.summary.analyzableRuntimeFiles,unmapped:audited.summary.runtimeFilesMissingFeatureDeclaration},
 mainCoverage:{tracked:main.summary.trackedFiles,runtime:main.summary.analyzableRuntimeFiles,unmapped:main.summary.runtimeFilesMissingFeatureDeclaration},
 blindSampleMain:sample(main,4),
 caveat:'No statistically reliable precision, specificity, false-positive rate or recall on unseen bugs from this check. Review a blind sample on real code plus PostgreSQL.'
};
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'relevance.json'),JSON.stringify(evalReport,null,2)+'\n');
const lines=[
 '# Pertinence du scanner repo-wide — ce que les chiffres signifient','',
 'Audit SHA '+evalReport.auditSHA+' ; main SHA '+evalReport.mainSHA,'',
 '**Le scanner retrouve les défauts sur lesquels il a été étalonné : résultat non indépendant, à ne pas appeler taux de rappel aveugle.**','',
 '| Contrôle | Audit | Main |','|---|---:|---:|',
 '| Anomalies de calibration signalées | '+evalReport.calibratedRecallAudit.detected+'/'+known.length+' | '+evalReport.calibratedRecallMain.detected+'/'+known.length+' |',
 '| Fichiers suivis | '+evalReport.auditCoverage.tracked+' | '+evalReport.mainCoverage.tracked+' |',
 '| Sources runtime analysées | '+evalReport.auditCoverage.runtime+' | '+evalReport.mainCoverage.runtime+' |',
 '| Sources runtime hors gouvernance | '+evalReport.auditCoverage.unmapped+' | '+evalReport.mainCoverage.unmapped+' |',
 '','## Contrôles négatifs de provenance de SQL','',
 '| Fichier / table | Audit contient SQL direct textuel | Main |','|---|---|---|',
 ...negatives.map((x,i)=>'| '+x.file+' / '+x.table+' | '+negAudit[i].hasSQLTextSite+' | '+negMain[i].hasSQLTextSite+' |'),
 '','## Échantillon aveugle à qualifier','',
 'Les '+evalReport.blindSampleMain.length+' signaux ci-dessous sont tirés automatiquement par classes et empreinte SHA ; aucun n’est certifié. Leurs verdicts ne sont pas inventés.',
 '','| Catégorie | Chemin | Table |','|---|---|---|',
 ...evalReport.blindSampleMain.map(x=>'| '+x.kind+' | '+x.file+' | '+(x.table||'')+' |'),
 '','## Ce qui manque pour parler de pertinence généralisable','',
 'Confirmer un échantillon non utilisé lors de la conception avec une revue métier indépendante et une paire NOMINAL/DEVIATION PostgreSQL. Estimer séparément faux positifs par famille et défauts manqués dans un corpus d’invariants intacts et rompus.'
];
fs.writeFileSync(path.join(out,'relevance.md'),lines.join('\n')+'\n');
console.log('REPO_WIDE_RELEVANCE '+JSON.stringify({
 auditSHA:evalReport.auditSHA,mainSHA:evalReport.mainSHA,
 calibratedAudit:evalReport.calibratedRecallAudit.detected+'/'+known.length,
 calibratedMain:evalReport.calibratedRecallMain.detected+'/'+known.length,
 knownNegativeAudit:negAudit.map(x=>x.hasSQLTextSite),
 knownNegativeMain:negMain.map(x=>x.hasSQLTextSite),
 blindSampleMain:evalReport.blindSampleMain.length,
 caveat:evalReport.caveat
}));
console.log('REPO_WIDE_BLIND_SAMPLE '+JSON.stringify(evalReport.blindSampleMain));
