'use strict';
/**
 * Independent business auditor: no imports from services/, db.js or routes/.
 * A rule is a sourced, read-only hypothesis; finding does not prove bug.
 */
const {RULES}=require('./rules');
function validateReadOnlySql(sql){
 const s=String(sql||'').trim();
 return /^SELECT\b/i.test(s)&&s.includes('LIMIT $1')&&!s.includes(';')&&
   !/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|MERGE|EXECUTE|GRANT|REVOKE|COPY|CALL|DO|INTO)\b/i.test(s);
}
function normalizeOptions(opts={}){
 const n=opts.sampleLimit===undefined?25:Number(opts.sampleLimit);
 if(!Number.isInteger(n)||n<1||n>100)throw Error('sampleLimit must be integer 1..100');
 const ids=opts.ruleIds===undefined?null:opts.ruleIds;
 if(ids!==null&&(!Array.isArray(ids)||!ids.length))throw Error('ruleIds must be a nonempty list');
 if(ids!==null){
  const unknown=ids.filter(id=>!RULES.some(x=>x.id===id));
  if(unknown.length)throw Error('Unknown rules: '+unknown.join(', '));
 }
 return {sampleLimit:n,ruleIds:ids};
}
async function scanData(client,opts={}){
 if(!client||typeof client.query!=='function')throw Error('PostgreSQL query executor required');
 const {sampleLimit,ruleIds}=normalizeOptions(opts);
 const selected=ruleIds?RULES.filter(r=>ruleIds.includes(r.id)):RULES;
 const out=[];
 for(const rule of selected){
  if(!validateReadOnlySql(rule.sql))throw Error('Unsafe registered SQL '+rule.id);
  const result=await client.query(rule.sql,[sampleLimit+1]);
  const rows=result.rows||[];
  if(!Array.isArray(rows)||rows.some(row=>typeof row.ref!=='string'))
    throw Error('Malformed evidence for '+rule.id);
  out.push({
   id:rule.id,issue:rule.issue,boundary:rule.boundary,priority:rule.priority,
   name:rule.name,owner:rule.owner,grain:rule.grain,interpretation:rule.interpretation,
   status:rows.length?'DATA_INTEGRITY_SIGNAL':'NO_SIGNAL_IN_SAMPLE_QUERY',
   samples:rows.slice(0,sampleLimit).map(row=>row.ref),
   detectedAtLeast:rows.length,
   sampleTruncated:rows.length>sampleLimit,
   exhaustiveCount:false,confirmedBusinessBug:false,
  });
 }
 return out;
}
async function withReadOnlyTransaction(pool,callback){
 if(!pool||typeof pool.connect!=='function')throw Error('Dedicated connection pool required');
 const client=await pool.connect();
 let began=false;
 try {
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  began=true;
  await client.query("SET LOCAL statement_timeout = '15000ms'");
  const readOnly=await client.query("SELECT current_setting('transaction_read_only') AS value");
  if(readOnly.rows?.[0]?.value!=='on')throw Error('PostgreSQL did not confirm READ ONLY transaction');
  return await callback(client);
 }finally{
  if(began)await client.query('ROLLBACK').catch(()=>{});
  client.release();
 }
}
function summarize({staticResult=null,dataResults=null,mode}){
 const findings=Array.isArray(staticResult?.findings)?staticResult.findings:[];
 const signals=dataResults?.filter(x=>x.status==='DATA_INTEGRITY_SIGNAL')||[];
 return {
  mode,staticFilesReviewed:staticResult?.scannedFiles??null,
  staticSuspicions:staticResult?findings.length:null,
  dataRulesExecuted:dataResults?.length??null,
  rulesWithEvidence:signals.length,
  sampledReferences:signals.reduce((n,x)=>n+x.samples.length,0),
  confirmedRuntimeBugs:0,
  verdict:'INVESTIGATE_SIGNALS_NOT_BUSINESS_CERTIFICATION',
 };
}
function reportMarkdown(report){
 const lines=[
  '# Komerce — Audit business indépendant','',
  'SHA : '+(report.git?.sha||'NON_RELEVE'),
  'Contrat : '+report.contract,
  'Mode : '+report.mode,'',
  '## Bilan','',
  '- Fichiers statiques analysés : '+(report.summary.staticFilesReviewed??'NON_EXECUTE'),
  '- Suspicions statiques : '+(report.summary.staticSuspicions??'NON_EXECUTE'),
  '- Signaux de contrôle de flux indépendants : '+(report.code?.independentCodeSignals?.length??'NON_EXECUTE'),
  '- Règles SQL exécutées : '+(report.summary.dataRulesExecuted??'NON_EXECUTE'),
  '- Règles présentant au moins un signal : '+report.summary.rulesWithEvidence,
  '- Bugs runtime confirmés par cet audit seul : **0** (qualification humaine + contre-épreuve séparées)', '',
  '## Signaux SQL', '',
 ];
 if(report.data?.results){
  lines.push('| Règle | Frontière | P | État | Au moins | Échantillon | Issue |',
   '|---|---|---|---|---:|---|---|');
  for(const r of report.data.results)lines.push('| '+r.id+' | '+r.boundary+' | '+r.priority+
   ' | '+r.status+' | '+r.detectedAtLeast+' | '+r.samples.map(s=>s.replace(/[|]/g,'/')).join(', ')+
   ' | #'+r.issue+' |');
 }else lines.push('Non exécutés (mode sans base PostgreSQL).');
 if(report.code?.independentCodeSignals?.length){
  lines.push('', '## Contradictions potentielles de contrôle de flux (code)', '',
   '| Règle | Source | Élément à contrôler | Risque / qualification | Preuve restante |',
   '|---|---|---|---|---|');
  for(const v of report.code.independentCodeSignals)
   lines.push('| '+v.id+' | '+String(v.file).replace(/[|]/g,'/')+':'+v.line+
     ' | '+(v.counter||v.requestKey||'n/a')+' | '+v.risk+
     (v.classification?' ('+v.classification+')':'')+
     ' | '+v.requiredIndependentProof+' |');
  lines.push('', 'Ces traces de code ne prouvent pas une anomalie de données en production.');
 }
 if(report.code?.writerInventory){
  const w=report.code.writerInventory;
  lines.push('', '## V0.6 — Inventaire indépendant des écritures métier', '',
   '- Fichiers applicatifs candidats : '+w.coverage.applicationFiles+' / '+w.coverage.trackedJsFiles+
    ' JS/TS suivis (autres périmètres exclus, non certifiés).',
   '- Feature Cards lues : '+w.coverage.featureCardsRead+
    ' ; avec déclaration db.tables : '+w.coverage.featureCardsWithDbDeclarations,
   '- Fragments SQL candidats (bruts) : '+w.summary.candidateWrites+
    ' ; associés à des tables du schéma : '+w.summary.physicalTableCandidates+
    ' ; cibles lexicales non confirmées : '+w.summary.notProvenTableCandidates,
   '- Arguments directs query/execute/run (tables du schéma) : '+w.summary.possibleDirectQueryCalls,
   '- Tables distinctes retrouvées dans le schéma : '+w.summary.tablesFound+
    ' / '+w.coverage.canonicalSchemaTables,
   '- Écritures à investiguer pour propriétaire absent/ambigu/autre domaine : '+
      w.summary.ownershipReviewCandidates,
   '- Écritures de domaine différent du propriétaire déclaré : '+w.summary.crossDomainReviewCandidates,
   '- En-têtes sans déclaration de la table : '+w.summary.headerMissingDeclarations,
   '- Exécutions SQL prouvées par le scan lexical : **0** ; bugs confirmés : **0**.',
   '', '### Tables ayant le plus de candidats (25 premières)', '',
   '| Table | Candidats | Fichiers distincts | Propriétaire(s) déclaré(s) | Écarts en-tête | À examiner |',
   '|---|---:|---:|---|---:|---:|');
  for(const row of w.tableSummary.slice(0,25))lines.push(
   '| '+row.table+' | '+row.occurrences+' | '+row.writers.length+
   ' | '+(row.explicitOwners.join(', ')||'NON EXPLICITE')+
   ' | '+row.sourceHeaderGaps+' | '+row.crossDomainReview+' |');
  lines.push('', 'Toutes les occurrences et les fichiers figurent dans business-audit.json.',
   'Un propriétaire déclaré ou une occurrence SQL ne prouve ni autorisation, ni chemin actif, ni anomalie.');
 }
 if(report.code?.evidenceLedger){
  const l=report.code.evidenceLedger;
  lines.push('', '## V0.9 R&D — Registre de qualification des preuves', '',
   '- Occurrences SQL physiques regroupées : '+l.summary.sourceOccurrences,
   '- Cas distincts : '+l.summary.distinctCases,
   '- Cas nécessitant examen de responsabilité : '+l.summary.reviewCases,
   '- Contre-exemples confirmés par cette campagne : '+l.summary.confirmedTestCounterexamples,
   '- Incidents de production confirmés : **0**', '',
   '| ID | Fichier | Table | Occurrences | Domaine | Propriétaire | État |',
   '|---|---|---|---:|---|---|---|');
  for(const x of l.entries.filter(x=>x.reviewRequired).slice(0,50))
   lines.push('| '+x.id+' | '+x.file+' | '+x.table+' | '+x.occurrenceCount+
    ' | '+(x.declaredDomain||'NON DECLARE')+' | '+(x.declaredOwners.join(', ')||'NON EXPLICITE')+
    ' | '+x.verdict+' |');
  lines.push('', '### Cibles SQL non rattachées au schéma', '',
   '- Occurrences à clarifier : '+l.summary.unresolvedOccurrences,
   '- Dossiers distincts : '+l.summary.distinctUnresolvedCases,
   '- Candidats totaux conservés : '+l.summary.allCandidateOccurrences,
   'Ces cibles ne sont ni des tables prouvées ni des bugs, et ne disparaissent pas du registre.',
   '', '| ID | Fichier | Cible brute | Occurrences | Qualification |',
   '|---|---|---|---:|---|');
  for(const x of l.unresolvedEntries.slice(0,50))
   lines.push('| '+x.id+' | '+x.file+' | '+(x.rawTarget||'DYNAMIQUE')+
    ' | '+x.occurrenceCount+' | '+x.schemaEvidence+' |');
  lines.push('', 'Liste JSON complète : code.evidenceLedger.unresolvedEntries.');
  lines.push('', 'Liste complète JSON : code.evidenceLedger.entries.',
   'Aucune occurrence lexicale n est automatiquement un bug confirmé.');
 }
 if(report.code?.paypalRefundBoundary){
  const r=report.code.paypalRefundBoundary;
  lines.push('', '## PayPal — raccordement effectif du remboursement', '',
   '- Détecteur : '+r.id+' ; propriétaire : '+r.owner,
   '- État : **'+r.status+'**',
   '- Route reliée au propriétaire : '+Boolean(r.observations.routeConnected),
   '- Clé durable passée au client : '+Boolean(r.observations.ownerPassesStableProviderKey),
   '- Registre d intentions actuellement activé par ce writer : '+
      Boolean(r.observations.ownerReservesDurableIntent&&r.observations.ownerClaimsDurableIntent),
   '- Repli horodaté encore présent : '+Boolean(r.observations.clientHasTimestampFallback),
   '- Remboursement PSP réellement dupliqué démontré : **NON**',
   '- Suite : '+r.nextProof,'');
 }
 if(report.code?.triage){
  lines.push('', '## Revue statique par propriétaire', '',
   '| Signal | Règle | Fichier:ligne | P | Propriétaire | Qualification | Observation | Prochaine preuve |',
   '|---|---|---|---|---|---|---|---|');
  for(const t of report.code.triage){
   const clean=x=>String(x??'').replace(/[|\r\n]/g,' ').slice(0,270);
   lines.push('| '+t.id+' | '+t.rule+' | '+clean(t.file)+':'+t.line+' | '+
    clean(t.priority)+' | '+clean(t.owner)+' | '+clean(t.evidenceReview||'UNREVIEWED')+
    ' | '+clean(t.groundedObservation||'NOT_REVIEWED')+
    ' | '+clean(t.proposedTest||t.nextIndependentProof)+' |');
  }
  lines.push('', '**Toutes ces entrées restent des suspicions, même si elles apparaissent dans du code de production.**');
 }
 lines.push('', '## Portée et restrictions', '',
  '- Scanner autonome : ne charge aucun service métier Komerce et ne déclenche aucun writer.',
  '- Base locale de test seulement, transaction PostgreSQL REPEATABLE READ READ ONLY et ROLLBACK.',
  '- Les résultats sont des signaux d intégrité à vérifier, jamais une certification métier automatique.',
  '- Les échantillons sont bornés : detectedAtLeast ne correspond pas à un compte exhaustif lorsque tronqué.',
  '- Le volet statique invoque le scanner lexical existant, non une preuve de comportement runtime.',
  '- Les contre-épreuves qui écrivent temporairement restent une campagne PostgreSQL de test distincte.',
 );
 return lines.join('\n')+'\n';
}
module.exports={RULES,validateReadOnlySql,normalizeOptions,scanData,withReadOnlyTransaction,summarize,reportMarkdown};
