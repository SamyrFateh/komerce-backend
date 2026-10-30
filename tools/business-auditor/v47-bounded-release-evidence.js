#!/usr/bin/env node
'use strict';
/**
 * Technical evidence gate for a BOUNDED auditor release candidate.
 * This never changes V4's full-autonomy NO_GO, creates a tag, attests
 * a human review, or treats prewritten mutants as independent blind proof.
 */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),
 crypto=require('node:crypto');
const {normalize}=require('./v35-invariant-census');
const {benchmark}=require('./v38-calibration-benchmark');
const {accepts:acceptsG3}=require('./v40-g3-proof-admission');
const {accepts:acceptsInstall}=require('./v42-release-install-smoke');
const {evaluate:stockOracle}=require('./v41-g2-local-stock-proof');
const {evaluate:relayOracle,STATEMENTS}=require('./v46-g2-market-relay-proof');
const {cases:inventoryCases}=require('./v44-adversarial-mutations');
const {OWNERS,judge:gradeMulti}=require('./v45-three-domain-mutations');
const {allowed:allowedChange}=require('./v43-main-diff-scope');
const ROOT=path.resolve(__dirname,'../..');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const fail=s=>{throw Error('V47_EVIDENCE_TOOL_ERROR: '+s)};
function verifyExact({audit,ledger,stock,relay,census,sha}){
 const n=census?.summary?.declaredInvariants,items=census?.all||[];
 if(!Number.isInteger(n)||n<3||
  audit?.summary?.featureInvariantsDeclared!==n||
  audit?.summary?.featureInvariantsCertified!==3||
  audit?.invariantCoverage?.featureCardInvariantsCertified!==3||
  audit?.semanticInvariantLedger?.summary?.semanticallyVerified!==3||
  ledger?.summary?.semanticallyVerified!==3||
  ledger?.summary?.declared!==n||
  ledger?.summary?.notCovered!==n-3||
  audit?.summary?.featureCardSemanticOracleMappingComplete!==false||
  !Array.isArray(audit?.exactSemanticProofs)||
  audit.exactSemanticProofs.length!==3||
  !Array.isArray(ledger?.rows)||ledger.rows.length!==n)
  fail('G2 census or exact verified counts diverged');
 if(stock?.sha!==sha||relay?.sha!==sha||stock?.cloneDropped!==true||
    relay?.cloneDropped!==true||stockOracle(stock.raw).verdict!=='PASS_WITH_EVIDENCE'||
    relayOracle(relay.raw).verdict!=='PASS_WITH_EVIDENCE')
  fail('G2 physical independent oracle, clone, or SHA invalid');
 const declarations=[
  {id:stock.invariantId,file:stock.sourceFileHash,statement:stock.statementSha,
   source:'features/local-stock.feature.js',text:'qty_physical ne descend jamais sous zéro'},
  ...STATEMENTS.map((s,i)=>({
   id:relay.matches?.[i]?.invariantId,file:relay.matches?.[i]?.sourceHash,
   statement:relay.matches?.[i]?.statementHash,
   source:'features/market.feature.js',text:s}))
 ];
 const found=new Set();
 for(const d of declarations){
  const actual=items.filter(x=>x.source===d.source&&x.statement===d.text);
  if(actual.length!==1||actual[0].id!==d.id||actual[0].sha!==d.statement||
    actual[0].sourceHash!==d.file||found.has(d.id))
   fail('G2 exact Feature Card source/statement fingerprint mismatch');
  found.add(d.id);
  const e=audit.exactSemanticProofs.find(x=>x.invariantId===d.id);
  const row=ledger.rows.find(x=>x.id===d.id);
  if(!e||e.verdict!=='PASS_WITH_EVIDENCE'||e.provenanceSha!==sha||
   e.cloneDropped!==true||e.sourceFileHash!==d.file||
   e.statementHash!==d.statement||row?.exactAssertionVerified!==true||
   row?.verdict!=='CERTIFIED_DB_CONSTRAINT'||row.physicalProofSha!==sha)
   fail('G2 proof not linked to canonical ledger row');
 }
 if(ledger.rows.filter(x=>x.exactAssertionVerified===true).length!==3||
  ledger.rows.filter(x=>x.verdict==='NOT_COVERED').length!==n-3||
  ledger.byDomain.reduce((a,d)=>a+d.certified,0)!==3)
  fail('G2 unproven statements quietly promoted');
 return {certified:3,declared:n,remaining:n-3,
  scope:'DB_CONSTRAINTS_ONLY_NO_BUSINESS_PROCESS_CERTIFICATION'};
}
function verifyInventory(report,sha){
 if(report?.sha!==sha||
  report?.contract!=='komerce-inventory-adversarial-regression/v44'||
  report.classification!=='OPEN_REPRODUCIBLE_NOT_SEALED_INDEPENDENT_BLIND'||
  !Array.isArray(report.cases)||report.cases.length!==inventoryCases.length||
  report.summary?.allClonesDropped!==true||
  report.summary?.healthy!==2||report.summary?.baselineFalsePositives!==0||
  report.summary?.totalExecutions!==16)fail('G4 inventory baseline or provenance missing');
 const seen=new Set();let fault=0,equivalent=0;
 for(const r of report.cases){
  const expected=inventoryCases.find(x=>x.id===r.id);
  if(!expected||seen.has(r.id)||r.truth!==expected.truth||
    r.class!==expected.class||r.tried!==2||
    !Array.isArray(r.signals)||r.signals.length!==2)
   fail('G4 inventory altered or incomplete reference corpus');
  seen.add(r.id);
  if(expected.truth==='VIOLATION'){
   if(r.detected!==2||r.signals.some(x=>!Array.isArray(x)||!x.length))
    fail('G4 real inventory defect missed');fault++;
  }else{
   if(r.detected!==0||r.signals.some(x=>!Array.isArray(x)||x.length))
    fail('G4 observationally equivalent inventory mutant flagged');equivalent++;
  }
 }
 if(fault!==5||equivalent!==2)fail('G4 inventory truth coverage mismatch');
 return {faults:5,detected:5,equivalentControls:2,falsePositives:0};
}
function verifyMultidomain(report,sha,readSource=(p)=>fs.readFileSync(path.join(ROOT,p),'utf8')){
 const modes=['FX','MARKET','ORDER'];
 if(report?.contract!=='komerce-adversarial-physical-multidomain/v45'||
    report?.sha!==sha||report.classification!=='OPEN_REPRODUCIBLE_NOT_SEALED_BLIND'||
    JSON.stringify(report.certifiedDomainScope)!==JSON.stringify(modes)||
    !Array.isArray(report.baseline)||report.baseline.length!==3||
    report.summary?.allClonesDropped!==true||
    report.summary?.arbitraryUnknownBugDiscoveryCertified!==false)
  fail('G4 three-owner source or claim provenance missing');
 for(const mode of modes){
  const file=OWNERS[mode];
  if(report.sourceSha256?.[file]!==hash(readSource(file))||
     !report.reviewedOwnerPaths.includes(file))fail('G4 owner source SHA256 drift');
  const base=report.baseline.find(x=>x.mode===mode);
  if(!base||base.mutation!==null||base.mutationApplied!==false||
     base.cloneDropped!==true||base.realOwnerExecuted!==true||
     base.canonicalPg!==true||base.signals?.length!==0)
   fail('G4 multi-domain healthy owner not demonstrated');
 }
 const graded=gradeMulti(report.records,modes);
 if(graded.summary.status!=='PASS_REVIEWED_THREE_DOMAIN_ADVERSARIAL'||
    graded.summary.detected!==6||graded.summary.falsePositives!==0||
    graded.summary.equivalentControls!==3||
    graded.summary.missed!==0||
    report.summary.detected!==graded.summary.detected||
    report.summary.falsePositives!==graded.summary.falsePositives)
  fail('G4 mutated source/oracle verdict mismatch');
 return {ownerFamilies:3,faults:6,detected:6,equivalentControls:3,falsePositives:0};
}
function verifyScope(diff,install,sha){
 if(diff?.contract!=='komerce-reviewed-main-integration/v1'||
  diff.targetSha!==sha||diff.baseBranch!=='main'||
  diff.comparisonMode!=='PR_COMPLETE_DIFF'||
  diff.excludedNonAuditorChangeCount!==0||diff.automatedScopeVerified!==true||
  diff.unrelatedRuntimeChanges!==0||diff.conflicts!==0||
  diff.humanReviewApproved!==false||
  !Array.isArray(diff.changedFiles)||!diff.changedFiles.length||
  diff.changedFiles.some(x=>!allowedChange(x))||
  !/^[a-f0-9]{64}$/.test(diff.patchSha256||'')||
  !acceptsInstall(install,sha))
  fail('G5 full PR diff, install or local-only controls not proved');
 return {safeDiff:true,changedFiles:diff.changedFiles.length,
  installation:'PASS',humanReview:'REQUIRED_NOT_FORGED'};
}
function evaluate({audit,ledger,census,stock,relay,g3,inventory,multi,diff,install,
  fullRelease}={},deps={}){
 const sha=audit?.sha;
 if(!/^[a-f0-9]{40}$/.test(sha||'')||
   [g3,inventory,multi,install,stock,relay].some(x=>x?.sha!==sha)||
   diff?.targetSha!==sha)
  fail('all independent evidence must refer to the same 40-hex SHA');
 const g2=verifyExact({audit,ledger,stock,relay,census,sha});
 const calibrated=benchmark(audit);
 if(calibrated.calibrationGate!=='PASS'||
   calibrated.calibration.truePositive!==3||
   calibrated.calibration.trueNegative!==9)
  fail('G1 canonical physical witness corpus regression');
 if(!acceptsG3(g3,sha))fail('G3 independent generated inventory owner proof missing');
 const inventoryProof=verifyInventory(inventory,sha);
 const multiProof=verifyMultidomain(multi,sha,deps.readSource);
 const scope=verifyScope(diff,install,sha);
 if(fullRelease?.sha!==sha||fullRelease.decision!=='NO_GO'||
   fullRelease.mergeMainAuthorized!==false||
   !['G2_SEMANTIC_INVARIANT_MAPPING','G4_BLIND_OUT_OF_SAMPLE_BENCHMARK',
     'G5_SAFE_MAIN_DIFF'].every(x=>fullRelease.blockers?.includes(x)))
  fail('full-autonomy G4/G5 limitations incorrectly hidden');
 return {
  contract:'komerce-bounded-auditor-release-candidate/v47',sha,
  technicalVerdict:'GO_BOUNDED_TECHNICAL_SCOPE',
  certification:'NOT_CERTIFIED_PENDING_INDEPENDENT_REVIEW',
  finalReleaseAuthorized:false,
  blindUnknownBugDetectionCertified:false,
  fullAutonomousScannerCertified:false,
  knownProductionDefectsDeclaredAsFixed:false,
  evidence:{g1:{knownTruePositive:3,knownTrueNegative:9,
    knownFalsePositive:0,corpus:'PUBLIC_PRECALIBRATED'},
   g2,g3:{generatedNominal:6,preselectedMutationsDetected:2},
   g4:{inventory:inventoryProof,multiDomain:multiProof,
    status:'OPEN_MUTATION_TEST_NOT_SEALED_BLIND'},g5:scope},
  humanReviewChecklist:[
   'Independently inspect release candidate exact SHA and diff',
   'External evaluator runs withheld unknown mutation challenge on real owners, no shared fixtures',
   'Review known violations and outstanding risk exclusions by business domain',
   'Approve limited scope or decline; no automated approval or tag'
  ],
  excludedClaims:[
   '479/479 Feature Cards certified','arbitrary unknown bugs autonomously discovered',
   'finance PSP/refund and concurrency behavior certified',
   'all eight domains semantically certified','main or production application bugs repaired'
  ]
 };
}
function parse(args){
 const keys=['audit','ledger','stock','relay','g3','inventory','multi','diff','install',
  'release','out'];const o={};
 for(let i=0;i<args.length;i+=2){
  const k=args[i]?.slice(2);
  if(!args[i]?.startsWith('--')||!keys.includes(k)||!args[i+1])
   fail('required: '+keys.map(x=>'--'+x+' FILE').join(' '));
  o[k]=args[i+1];
 }
 if(keys.some(k=>!o[k]))fail('missing evidence artifact or output path');
 return o;
}
function run(opts,env=process.env){
 const load=x=>JSON.parse(fs.readFileSync(path.resolve(opts[x]),'utf8'));
 const audit=load('audit');
 if(env.GITHUB_SHA!==audit.sha)fail('checkout does not match evidence SHA');
 const result=evaluate({
  audit,ledger:load('ledger'),census:normalize(),
  stock:load('stock'),relay:load('relay'),g3:load('g3'),
  inventory:load('inventory'),multi:load('multi'),
  diff:load('diff'),install:load('install'),fullRelease:load('release')
 });
 const out=path.resolve(opts.out);
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'bounded-release-candidate.json'),
  JSON.stringify(result,null,2)+'\n');
 fs.writeFileSync(path.join(out,'bounded-release-candidate.md'),[
  '# V4 bounded technical release candidate','',
  '- SHA: '+result.sha,
  '- Technical verdict: **'+result.technicalVerdict+'**',
  '- Release certificate: **'+result.certification+'**',
  '- Exact DB constraints: **3/'+result.evidence.g2.declared+'**',
  '- Open adversarial defects caught: **11/11** (5 inventory + 6 three owners)',
  '- Equivalent controls correctly passed: **5/5**',
  '- Independent sealed unknown-bug challenge: **NOT EXECUTED**',
  '- Human reviewer: **NOT ATTESTED**',
  '- Autonomous V4.0: **NO_GO**',
  '- No tag, release approval, production deploy or product fixes','',
  'This is a technical qualification of an explicitly finite detector, not a final autonomous scanner certification.',
  ''].join('\n'));
 console.log('AUDITOR_BOUNDED_RELEASE_CANDIDATE '+JSON.stringify({
  sha:result.sha,technicalVerdict:result.technicalVerdict,
  certification:result.certification,g2:result.evidence.g2,
  detectedOpenFaults:11,equivalents:5}));
 return result;
}
if(require.main===module)try{run(parse(process.argv.slice(2)))}
catch(e){console.error(e.stack||e.message);process.exitCode=2}
module.exports={verifyExact,verifyInventory,verifyMultidomain,verifyScope,evaluate,parse,run};
