#!/usr/bin/env node
'use strict';
/** V0.9: consolidate same-run V0.6/V0.7/V0.8 evidence, not business certification. */
const fs=require('node:fs'),path=require('node:path');
const {makeEvidenceLedger}=require('./evidence-ledger');
function consolidate(audit,sql,owner,meta){
 if(audit?.contract!=='komerce-independent-business-auditor/v1'||
  !audit.code?.writerInventory||!audit.code?.writerQualification)
  throw Error('V0.9 missing V0.6/V0.7 provenance');
 if(!/^[0-9a-f]{40}$/.test(meta?.sha||'')||!/^\d+$/.test(String(meta?.runId||'')))
  throw Error('V0.9 CI identity unavailable');
 if(audit.git?.sha!==meta.sha||owner?.sha!==meta.sha||
  owner.runId!==String(meta.runId))throw Error('V0.9 evidence from different commit/run');
 const w=audit.code.writerInventory,q=audit.code.writerQualification;
 const ledger=makeEvidenceLedger(w);
 if(q.summary.occurrences!==w.summary.candidateWrites||
  q.summary.physical!==w.summary.physicalTableCandidates||
  q.summary.unresolved!==w.summary.notProvenTableCandidates||
  ledger.summary.allCandidateOccurrences!==w.summary.candidateWrites||
  ledger.summary.sourceOccurrences!==q.summary.physical||
  ledger.summary.unresolvedOccurrences!==q.summary.unresolved)
  throw Error('V0.9 V0.6-V0.7-V0.9 candidate loss');
 if(sql?.contract!=='komerce-business-sql-calibration/v08'||
  sql.results?.length!==7||sql.summary?.nominalPassed!==7||
  sql.summary.adversarialDetected!==7||sql.summary.rollbackPassed!==7||
  sql.summary.businessWriterExecutions!==0||sql.summary.confirmedBusinessBugs!==0)
  throw Error('V0.9 nominal/adversarial SQL calibration incomplete');
 if(owner.contract!=='komerce-business-owner-replay-evidence/v08'||
  owner.testsPassed!==3||owner.provider!=='MOCK_HTTP_NO_REAL_PSP'||
  owner.productionIncidentConfirmed!==false||
  owner.duplicateMoneyMovementProven!==false)
  throw Error('V0.9 actual owner mocked transport proof incomplete');
 if(ledger.summary.confirmedProductionIncidents||ledger.summary.confirmedTestCounterexamples)
  throw Error('V0.9 unverified result promoted to confirmed bug');
 return {contract:'komerce-independent-business-evidence/v09',
  sha:meta.sha,runId:String(meta.runId),
  lineage:['V0.6_STATIC_WRITER_INVENTORY','V0.7_DECLARATION_QUALIFICATION',
   'V0.8_PG_TEMP_SQL_PAIRS','V0.8_REAL_OWNER_MOCK_HTTP',
   'V0.9_GROUPED_EVIDENCE_REGISTER'],
  summary:{candidateOccurrences:w.summary.candidateWrites,
   physicalOccurrences:ledger.summary.sourceOccurrences,
   unresolvedOccurrences:ledger.summary.unresolvedOccurrences,
   distinctPhysicalCases:ledger.summary.distinctCases,
   distinctUnresolvedCases:ledger.summary.distinctUnresolvedCases,
   v07ReviewCases:q.summary.reviewCases,
   pairedSqlDetectors:sql.results.length,mockedOwnerTests:owner.testsPassed,
   verifiedBusinessAuthorizations:0,productionIncidentsConfirmed:0,
   caseCoverageComplete:false},
  sqlDetectors:sql.results.map(r=>({id:r.id,nominal:r.nominal,
   adversarial:r.adversarial,rollback:r.rollbackRestored,
   scope:r.proof})),
  ownerReplay:{scope:owner.provider,nominal:owner.nominal,
   adversarial:owner.adversarial,negative:owner.negative,
   moneyMoved:false},
  ledger,
  limitations:['V0.7 declared ownership is not authorization; route imports are not runtime call chains',
   'V0.8 SQL temp fixtures validate detector selectivity, not the application writer',
   'PayPal owner replay uses mock HTTP; no real external payment evidence',
   'Only the explicitly calibrated probes are covered; unresolved business cases remain open',
   'No diagnosis of real production money, customers or data is claimed']};
}
if(require.main===module){
 try{
  const dir=process.argv[2];
  if(!dir||!process.env.GITHUB_RUN_ID||!process.env.GITHUB_SHA)throw Error('CI report directory/run identity required');
  const read=p=>JSON.parse(fs.readFileSync(path.join(dir,p),'utf8'));
  const result=consolidate(read('business-audit.json'),read('v08-sql-calibration.json'),
   read('v08-owner-replay.json'),{sha:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID});
  fs.writeFileSync(path.join(dir,'v09-evidence.json'),JSON.stringify(result,null,2)+'\n');
  console.log('BUSINESS_AUDIT_V09_CERTIFIED_LEDGER '+JSON.stringify(result.summary));
 }catch(e){console.error('V0.9 evidence integration blocked: '+e.message);process.exitCode=2}
}
module.exports={consolidate};
