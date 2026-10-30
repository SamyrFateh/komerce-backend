'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),
 fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {verifyExact,verifyInventory,verifyMultidomain,verifyScope,parse}=require('./v47-bounded-release-evidence');
const {normalize}=require('./v35-invariant-census');
const {semanticLedger}=require('./v40-semantic-ledger');
const {cases:inventoryCases}=require('./v44-adversarial-mutations');
const {CASES,OWNERS}=require('./v45-three-domain-mutations');
const {STATEMENTS,RULES,evaluate:relayOracle}=require('./v46-g2-market-relay-proof');
const {evaluate:stockOracle}=require('./v41-g2-local-stock-proof');
const sha='a'.repeat(40);
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function inv(){
 return {contract:'komerce-inventory-adversarial-regression/v44',sha,
  classification:'OPEN_REPRODUCIBLE_NOT_SEALED_INDEPENDENT_BLIND',
  cases:inventoryCases.map(c=>({id:c.id,truth:c.truth,class:c.class,tried:2,
   detected:c.truth==='VIOLATION'?2:0,
   signals:[c.truth==='VIOLATION'?['BUSINESS_VIOLATION']:[],
    c.truth==='VIOLATION'?['BUSINESS_VIOLATION']:[]]})),
  summary:{allClonesDropped:true,healthy:2,baselineFalsePositives:0,totalExecutions:16}};
}
function multi(){
 const modes=['FX','MARKET','ORDER'];
 const read=p=>fs.readFileSync(path.resolve(__dirname,'../..',p),'utf8');
 const baseline=modes.map(mode=>({
  mode,mutation:null,mutationApplied:false,cloneDropped:true,realOwnerExecuted:true,
  canonicalPg:true,signals:[]}));
 const records=CASES.map(c=>({
  id:c.id,mode:c.mode,domain:c.domain,truth:c.truth,
  mutation:c.id,mutationApplied:true,cloneDropped:true,realOwnerExecuted:true,
  canonicalPg:true,signals:c.truth==='FAULT'?['ORACLE_VIOLATION']:[],correct:true}));
 return {contract:'komerce-adversarial-physical-multidomain/v45',sha,
  classification:'OPEN_REPRODUCIBLE_NOT_SEALED_BLIND',
  certifiedDomainScope:modes,reviewedOwnerPaths:Object.values(OWNERS),
  sourceSha256:Object.fromEntries(Object.values(OWNERS).map(p=>[p,hash(read(p))])),
  baseline,records,summary:{allClonesDropped:true,
   arbitraryUnknownBugDiscoveryCertified:false,detected:6,falsePositives:0}};
}
function scope(){
 return {diff:{contract:'komerce-reviewed-main-integration/v1',
  targetSha:sha,baseBranch:'main',comparisonMode:'PR_COMPLETE_DIFF',
  excludedNonAuditorChangeCount:0,automatedScopeVerified:true,
  unrelatedRuntimeChanges:0,conflicts:0,humanReviewApproved:false,
  changedFiles:['tools/business-auditor/v47-bounded-release-evidence.js'],
  patchSha256:'b'.repeat(64)},
 install:{contract:'komerce-g5-installation-smoke/v1',sha,
  checks:{packageScriptsPresent:true,docsPresent:true,quickNoDatabase:true,
   targetedNoExecution:true,fullClonesDropped:true,blockedRemoteTargets:3,
   strictG5Exit:1},evidence:{quickContract:'komerce-unified-business-logic-auditor/v35',
    targetedContract:'komerce-impacted-risk-plan/v36',fullPhysicalCases:12,
    docsHash:'c'.repeat(64)}}};
}
function g2(){
 const census=normalize(),ledger=semanticLedger(census,[]),ids=[
  {source:'features/local-stock.feature.js',statement:'qty_physical ne descend jamais sous zéro'},
  ...STATEMENTS.map(statement=>({source:'features/market.feature.js',statement}))];
 const matches=ids.map(d=>census.all.find(x=>x.source===d.source&&x.statement===d.statement));
 assert.ok(matches.every(Boolean));
 const stockRaw={contract:'komerce-local-stock-constraint-raw/v1',table:'public.local_stock',
  constraint:'local_stock_qty_non_negatif',constraintDefinition:'CHECK ((qty_physical >= 0))',
  initialQuantity:1,positiveQuantity:2,negativeSqlState:'23514',
  negativeConstraint:'local_stock_qty_non_negatif',
  quantityAfterRejectedWrite:2,rolledBack:true};
 const relayRaw={contract:'komerce-market-relay-physical-raw/v46',rolledBack:true,
  joinResolved:true,rules:RULES.map(x=>({...x,notNull:true,
   foreignKeyDefinition:'FOREIGN KEY ('+x.column+') REFERENCES '+x.references+'('+x.refColumn+')',
   userTriggersDisabledForConstraintProbe:true,negativeSqlState:'23502',
   negativeColumn:x.column,validWriteObserved:true,unchangedAfterRejectedWrite:true}))};
 assert.equal(stockOracle(stockRaw).verdict,'PASS_WITH_EVIDENCE');
 assert.equal(relayOracle(relayRaw).verdict,'PASS_WITH_EVIDENCE');
 for(const m of matches){
  const row=ledger.rows.find(x=>x.id===m.id);
  row.exactAssertionVerified=true;row.verdict='CERTIFIED_DB_CONSTRAINT';
  row.physicalProofSha=sha;
  const d=ledger.byDomain.find(x=>x.domain===m.domain);d.certified++;d.notCovered--;
 }
 ledger.summary.semanticallyVerified=3;ledger.summary.notCovered=census.all.length-3;
 const audit={
  summary:{featureInvariantsDeclared:census.all.length,featureInvariantsCertified:3,
   featureCardSemanticOracleMappingComplete:false},
  invariantCoverage:{featureCardInvariantsCertified:3},
  semanticInvariantLedger:{summary:{semanticallyVerified:3}},
  exactSemanticProofs:matches.map(x=>({invariantId:x.id,verdict:'PASS_WITH_EVIDENCE',
   provenanceSha:sha,cloneDropped:true,sourceFileHash:x.sourceHash,
   statementHash:x.sha}))};
 const stock={sha,cloneDropped:true,raw:stockRaw,invariantId:matches[0].id,
  statementSha:matches[0].sha,sourceFileHash:matches[0].sourceHash};
 const relay={sha,cloneDropped:true,raw:relayRaw,
  matches:matches.slice(1).map(x=>({invariantId:x.id,sourceHash:x.sourceHash,
   statementHash:x.sha}))};
 return {audit,ledger,census,stock,relay,sha};
}
test('V47 G2 rejects forged identity, missing ledger rows and a claims-only certification',()=>{
 const x=g2();
 assert.equal(verifyExact(x).remaining,x.census.all.length-3);
 const a=g2();a.relay.matches[0].statementHash='wrong';
 assert.throws(()=>verifyExact(a),/G2 exact Feature Card/);
 const b=g2();b.ledger.rows[0].exactAssertionVerified=true;
 assert.throws(()=>verifyExact(b),/G2 unproven statements/);
 const c=g2();c.audit.summary.featureCardSemanticOracleMappingComplete=true;
 assert.throws(()=>verifyExact(c),/G2 census/);
});
test('V47 inventory mutants cannot erase missed defects or equivalent false positive',()=>{
 assert.equal(verifyInventory(inv(),sha).detected,5);
 const m=inv();m.cases[0].signals[0]=[];
 assert.throws(()=>verifyInventory(m,sha),/G4 real inventory defect/);
 const e=inv();e.cases[5].signals[0]=['WRONG'];
 assert.throws(()=>verifyInventory(e,sha),/G4 observationally equivalent/);
 const q=inv();q.cases.pop();
 assert.throws(()=>verifyInventory(q,sha),/G4 inventory baseline/);
});
test('V47 multiowner source SHA and real PG provenance are fail-closed',()=>{
 assert.equal(verifyMultidomain(multi(),sha).detected,6);
 const changed=multi();changed.records[0].signals=[];
 assert.throws(()=>verifyMultidomain(changed,sha),/G4 mutated source/);
 const bad=multi();bad.sourceSha256[OWNERS.FX]='0'.repeat(64);
 assert.throws(()=>verifyMultidomain(bad,sha),/G4 owner source SHA256/);
 const missing=multi();missing.records[0].cloneDropped=false;
 assert.throws(()=>verifyMultidomain(missing,sha),/V45_MISSING_PROVENANCE/);
});
test('V47 G5 requires complete safe PR diff, guarded install and explicit human pending',()=>{
 const x=scope();assert.equal(verifyScope(x.diff,x.install,sha).installation,'PASS');
 const bad=scope();bad.diff.humanReviewApproved=true;
 assert.throws(()=>verifyScope(bad.diff,bad.install,sha),/G5 full PR diff/);
 const y=scope();y.diff.changedFiles=['services/orders.js'];
 assert.throws(()=>verifyScope(y.diff,y.install,sha),/G5 full PR diff/);
 const z=scope();z.install.checks.blockedRemoteTargets=2;
 assert.throws(()=>verifyScope(z.diff,z.install,sha),/G5 full PR diff/);
});
test('V47 requires all evidence names and never accepts partial CLI',()=>{
 const keys=['audit','ledger','stock','relay','g3','inventory','multi','diff','install','release','out'];
 const args=keys.flatMap(k=>['--'+k,'/tmp/'+k+'.json']);
 assert.equal(parse(args).out,'/tmp/out.json');
 assert.throws(()=>parse(args.slice(0,-2)),/missing evidence/);
 assert.throws(()=>parse(['--release','/tmp/file','--execute','bad']),/V47_EVIDENCE_TOOL_ERROR/);
});
