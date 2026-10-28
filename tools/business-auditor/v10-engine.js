'use strict';
const {ORACLES}=require('./v10-oracles');
const crypto=require('node:crypto');
const PRIORITY={P1:0,P2:1,P3:2};
function triage(qualification){
 if(qualification?.contract!=='komerce-business-writer-qualification/v1'||
  !Array.isArray(qualification.cases)||!Array.isArray(qualification.findings))
  throw Error('V1.0 requires complete V0.7 qualification');
 const cases=qualification.cases.map((row,i)=>{
  const routes=qualification.importHints?.pathsByWriter?.[row.file]||[];
  const highest=(row.status==='CROSS_DOMAIN_UNDECLARED'||row.status==='OWNER_CONFLICT')&&row.directQueryCandidates>0;
  const priority=highest?'P1':row.needsReview&&routes.length?'P1':
   row.needsReview?'P2':'P3';
  const stable=crypto.createHash('sha256').update([row.file,row.table||row.rawTarget||'<dynamic>'].join('|')).digest('hex').slice(0,12);
  return {id:'KBA-T-'+stable,file:row.file,
   table:row.table||null,target:row.table||row.rawTarget||null,
   status:row.status,priority,occurrences:row.occurrences,
   declaredOwners:row.owners||[],routeImportHints:routes.slice(0,4),
   reviewRequired:row.needsReview,
   evidenceClass:'STATIC_HYPOTHESIS_NOT_VERIFIED_AUTHORITY',
   verifiedCallPath:false,confirmedBug:false,
   nextAction:row.needsReview?
    'Trace actual caller, delegated authority and selected invariant; run an isolated nominal/adversarial pair':
    'Check a business invariant before assigning correctness to declared ownership'};
 });
 if(new Set(cases.map(x=>x.id)).size!==cases.length)
  throw Error('V1.0 conflicting case identity: duplicate writer/table requires arbitration');
 if(cases.reduce((n,x)=>n+x.occurrences,0)!==qualification.summary.occurrences||
  cases.length!==qualification.summary.cases)
  throw Error('V1.0 review queue lost candidate occurrences');
 return {contract:'komerce-business-triage-queue/v1',
  totalOccurrences:qualification.summary.occurrences,totalCases:cases.length,
  reviewCases:cases.filter(x=>x.reviewRequired).length,
  confirmedBugs:0,
  cases:cases.sort((a,b)=>PRIORITY[a.priority]-PRIORITY[b.priority]||
   b.occurrences-a.occurrences||a.file.localeCompare(b.file))};
}
function evaluateOracle(oracle,observation,jest){
 if(observation?.contract!==oracle.evidenceContract||
  observation.scope!==oracle.evidenceScope||
  observation.oracle!==oracle.observationOracle)
  throw Error('V1.0 observation origin/oracle mismatch');
 if(jest?.success!==true||jest.numFailedTests!==0||jest.numPassedTests!==1||
  !Array.isArray(jest.testResults))throw Error('V1.0 owner Jest proof incomplete');
 const assertions=jest.testResults.flatMap(s=>(s.assertionResults||[]).map(a=>({...a,suite:s.name})));
 const hits=assertions.filter(a=>a.title===oracle.testTitle&&a.status==='passed'&&
  a.suite?.endsWith('/'+oracle.harness));
 if(hits.length!==1||assertions.length!==1)throw Error('V1.0 executed owner probe is absent/duplicated');
 for(const [field,expected] of Object.entries(oracle.expectedControls||{})){
  if(observation[field]!==expected)
   throw Error('V1.0 negative/nominal owner calibration missing: '+field);
 }
 if(typeof observation[oracle.observationField]!==oracle.type)
  throw Error('V1.0 negative/nominal owner calibration missing');
 const violated=observation[oracle.observationField]!==oracle.expected;
 return {id:oracle.id,priority:oracle.priority,boundary:oracle.boundary,
  owner:oracle.owner,source:oracle.source,writer:oracle.writer,
  invariant:oracle.invariant,expected:oracle.expected,
  observed:observation[oracle.observationField],
  verdict:violated?'REPRODUCED_CONTROLLED_TEST_INVARIANT_VIOLATION':'CONTROLLED_TEST_INVARIANT_SATISFIED',
  proofScope:'ACTUAL_OWNER_REPLAY_MOCKED_HTTP_AND_DB',
  actualOwnerInvoked:true,controlValidated:true,
  test:oracle.harness,productionIncidentConfirmed:false,
  duplicateExternalRefundConfirmed:false,
  remediation:violated?oracle.remediation:null};
}
function certify(input,{sha,runId}){
 const {v09,audit,jest,observation}=input||{};
 if(!/^[a-f0-9]{40}$/.test(sha||'')||!/^\d+$/.test(String(runId||'')))
  throw Error('V1.0 expected exact CI SHA and run ID');
 if(v09?.contract!=='komerce-independent-business-evidence/v09'||
  v09.sha!==sha||v09.runId!==String(runId)||audit?.git?.sha!==sha)
  throw Error('V1.0 stale or missing V0.9 audit/CI provenance');
 if(v09.summary?.candidateOccurrences!==audit.code?.writerInventory?.summary?.candidateWrites||
  v09.summary?.v07ReviewCases!==audit.code?.writerQualification?.summary?.reviewCases||
  v09.summary?.caseCoverageComplete!==false)
  throw Error('V1.0 input coverage contradictory');
 const queue=triage(audit.code.writerQualification);
 if(queue.totalOccurrences!==v09.summary.candidateOccurrences||
  queue.reviewCases!==v09.summary.v07ReviewCases)
  throw Error('V1.0 candidate/owner review coverage mismatch');
 const findings=ORACLES.map(o=>evaluateOracle(o,observation,jest));
 const count=findings.filter(x=>x.verdict==='REPRODUCED_CONTROLLED_TEST_INVARIANT_VIOLATION').length;
 return {contract:'komerce-business-bug-hunter/v1',sha,runId:String(runId),
  summary:{candidateOccurrences:queue.totalOccurrences,triageCases:queue.totalCases,
   reviewCases:queue.reviewCases,calibratedRuntimeOracles:findings.length,
   controlledTestViolations:count,productionIncidentsConfirmed:0,
   completeBusinessCoverage:false},
  findings,triageQueue:queue,
  limits:['Runtime oracles cover only explicitly registered business invariants',
   'A controlled-test invariant violation is not proof of a real PSP refund or production incident',
   'Static review cases are unproven and cannot become confirmed bugs without new executable oracles',
   'Test runs use mocked HTTP and database for PayPal; seven SQL rules used temp fixture shadow tables',
   'No general claim of business-code completeness or all 209 owner reviews resolved']};
}
function reportMarkdown(r){
 const s=r.summary;
 const lines=['# Komerce — Independent business bug hunter V1.0','',
  'SHA: '+r.sha+' | GitHub Actions: '+r.runId,'',
  '## Coverage', '',
  '- SQL candidate fragments retained: '+s.candidateOccurrences,
  '- Static grouped cases: '+s.triageCases,
  '- Static review cases: '+s.reviewCases,
  '- Runtime oracles executed: '+s.calibratedRuntimeOracles,
  '- Reproduced invariant violations in a controlled test: '+s.controlledTestViolations,
  '- Confirmed production incidents: **0**','',
  '## Runtime findings (not production incidents)','',
  '| Rule | Business invariant | Expected | Observed | Verdict |',
  '|---|---|---|---|---|'];
 for(const x of r.findings)lines.push('| '+x.id+' | '+x.invariant+' | '+x.expected+' | '+x.observed+
  ' | '+x.verdict+' |');
 lines.push('', '## Priority owner-review queue — first 25', '',
  '| P | Source | Target | Declaration | SQL fragments | Proof class |',
  '|---|---|---|---|---:|---|');
 for(const x of r.triageQueue.cases.filter(x=>x.reviewRequired).slice(0,25))
  lines.push('| '+x.priority+' | '+x.file+' | '+(x.target||'DYNAMIC')+
   ' | '+x.status+' | '+x.occurrences+' | '+x.evidenceClass+' |');
 lines.push('','The complete triage queue and observation data are in v10-bug-hunt.json.', '',
  '## Limitations','',...r.limits.map(x=>'- '+x));
 return lines.join('\n')+'\n';
}
module.exports={triage,evaluateOracle,certify,reportMarkdown};
