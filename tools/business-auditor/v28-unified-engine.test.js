'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),
 fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {parse,domainOf,coverage,run}=require('./v28-unified-engine');
const sha='ab'.repeat(20);
function quickEvidence(){
 return {contract:'komerce-audit-logic-v1',sha,scannedFiles:3,trackedFiles:3,
  newFindings:0,byRule:{TEST_SIGNAL:2},
  findings:[
   {file:'services/payment-paypal.js',rule:'TEST_SIGNAL',novelty:'KNOWN'},
   {file:'services/auto-parcel.js',rule:'TEST_SIGNAL',novelty:'KNOWN'}]};
}
function env(){return {NODE_ENV:'test',KOMERCE_DISABLE_CRONS:'true',
 DATABASE_URL:'postgres://test:password@localhost/komerce_test',GITHUB_SHA:sha}}
test('quick defaults to full tracked-code scan and never reads database',async()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'kba-v28-unit-'));
 let code=0,db=0,physical=0;
 try{
  const r=await run(parse(['--out',out]),{},{
   sha,staticScan:async()=>{code++;return quickEvidence()},
   dataScan:async()=>{db++;throw Error('no data allowed')},
   physicalScan:async()=>{physical++;throw Error('no physical allowed')}});
  assert.equal(code,1);assert.equal(db,0);assert.equal(physical,0);
  assert.equal(r.contract,'komerce-unified-business-logic-auditor/v28');
  assert.equal(r.summary.domainsNotPhysicallyCovered.length,8);
  assert.equal(r.static.suspicions,2);
  assert.equal(r.static.newFindings,null);
  assert.equal(r.permissions.target,'NO_DATABASE');
  assert.equal(JSON.parse(fs.readFileSync(path.join(out,'unified-audit.json'))).mode,'quick');
  assert.match(fs.readFileSync(path.join(out,'unified-audit.md'),'utf8'),/NON COUVERT|NOT_PHYSICALLY_COVERED/);
 }finally{fs.rmSync(out,{recursive:true,force:true})}
});
test('data and full modes refuse Railway and production DB BEFORE scanning',async()=>{
 for(const mode of ['data','physical','full']){
  let called=false;
  await assert.rejects(()=>run(parse(['--mode',mode]),{
   NODE_ENV:'production',KOMERCE_DISABLE_CRONS:'false',
   DATABASE_URL:'postgres://real@remote.example.com/komerce'},{
    sha,staticScan:async()=>{called=true;return quickEvidence()}
   }),/Data audit requires/);
  assert.equal(called,false);
 }
});
test('physical mode uses frozen selection and does not run data SQL',async()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'kba-v28-unit-'));
 try{
  const r=await run(parse(['--mode','physical','--max-cases','2','--out',out]),env(),{
   sha,staticScan:async()=>quickEvidence(),
   dataScan:async()=>{throw Error('unexpected DB read-only scan')},
   physicalScan:async(e,opts)=>{
    assert.equal(opts.maxCases,2);
    return {contract:'komerce-physical-calibration/v28',
     allClonesDropped:true,selection:{hash:'1',considered:4},
     cases:[{id:'FIN-REFUND-BA',domain:'finance',cloneDropped:true,
      result:'PASS_WITH_EVIDENCE',signals:[]},
      {id:'LOG-PARCEL-NOMINAL',domain:'logistics',cloneDropped:true,
       result:'PASS_WITH_EVIDENCE',signals:[]}]};
   }});
  assert.equal(r.coverage.filter(c=>c.status==='CALIBRATED_PARTIAL').length,2);
  assert.equal(r.summary.domainsNotPhysicallyCovered.length,6);
  assert.equal(r.data.status,'NOT_RUN');
  assert.equal(r.verdict,'PARTIAL_MULTI_DOMAIN_PROOF_WITH_KNOWN_COUNTEREXAMPLES');
 }finally{fs.rmSync(out,{recursive:true,force:true})}
});
test('physical mode rejects incomplete clone teardown evidence',async()=>{
 await assert.rejects(()=>run(parse(['--mode','physical']),env(),{
  sha,staticScan:async()=>quickEvidence(),
  physicalScan:async()=>({contract:'komerce-physical-calibration/v28',
   allClonesDropped:false,cases:[{cloneDropped:false}]})
 }),/clone cleanup/);
});
test('full mode combines read-only SQL and bounded real owner proofs',async()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'kba-v28-unit-'));
 try{
  const r=await run(parse(['--mode','full','--out',out,'--base','HEAD']),env(),{
   sha,staticScan:async()=>quickEvidence(),
   dataScan:async(argv,e)=>{
    assert.deepEqual(argv,['--mode','data','--sample-limit','25']);
    return {data:{status:'EXECUTED_REPEATABLE_READ_READ_ONLY_ROLLBACK',
     results:[{rule:'DUMMY',detectedAtLeast:0}]}};
   },
   physicalScan:async()=>({contract:'komerce-physical-calibration/v28',
    allClonesDropped:true,selection:{hash:'abc',considered:4},
    cases:[{id:'FIN-REFUND-AB',domain:'finance',cloneDropped:true,
     result:'BUSINESS_VIOLATION',signals:['I1']}]})
  });
  assert.equal(r.data.rules.length,1);
  assert.equal(r.summary.physicalBusinessViolations[0],'FIN-REFUND-AB');
  assert.equal(r.static.newFindings,0);
  assert.equal(r.permissions.productionAccess,false);
 }finally{fs.rmSync(out,{recursive:true,force:true})}
});
test('unavailable or distorted source evidence fails closed',async()=>{
 await assert.rejects(()=>run(parse([]),{},{
  sha,staticScan:async()=>({...quickEvidence(),scannedFiles:2})
 }),/repo-wide static evidence/);
});
test('unsupported scope, duplicate domain or unbounded case budget fails before scan',()=>{
 for(const arr of [['--mode','unlimited'],['--max-cases','99'],
   ['--domains','inventory'],['--domains','finance,finance'],['--unknown']])
  assert.throws(()=>parse(arr),/V28_TOOL_ERROR/);
});
test('files are mapped into eight domain coverage groups without global certification',()=>{
 assert.equal(domainOf('services/auto-parcel.js'),'logistics');
 assert.equal(domainOf('services/payment-paypal.js'),'finance');
 assert.equal(domainOf('services/inventory-service.js'),'inventory');
 const c=coverage(quickEvidence().findings,null,null);
 assert.equal(c.length,8);
 assert.equal(c.every(x=>!x.fullBusinessDomainCertification),true);
 assert.equal(c.find(x=>x.domain==='logistics').staticSuspicions,1);
});
