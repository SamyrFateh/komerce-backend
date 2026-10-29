#!/usr/bin/env node
'use strict';
/**
 * V2.3 fail-closed negative control:
 * The SAME v22 financial oracle must reject a plausible, insufficient
 * preflight-only owner mutant after it makes sequential AB look repaired.
 *
 * Use v16 disposable PG clones and strict in-process PayPal simulation.
 * The real application services remain unchanged in git and on disk.
 */
const fs=require('node:fs'),path=require('node:path'),
 cp=require('node:child_process'),crypto=require('node:crypto');
const {withClone}=require('./v16-cloned-database');
const {checkFinancialSchedule}=require('./v22-financial-invariants');
const root=path.resolve(__dirname,'../..');
const child=path.join(__dirname,'v22-refund-probe-child.js');
const readJson=p=>JSON.parse(fs.readFileSync(p,'utf8'));
function ensure(ok,description){if(!ok)throw Error('V23_NEGATIVE_CONTROL_FAILED: '+description)}
async function run(out,rankingFile,env=process.env) {
 ensure(out&&rankingFile&&/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&
  /^\d+$/.test(env.GITHUB_RUN_ID||''),'CI SHA, run and frozen ranking required');
 const sha=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 ensure(sha===env.GITHUB_SHA,'checkout does not match CI SHA');
 const frozen=readJson(rankingFile),prior=readJson(path.join(out,'v22-refund-probe.json'));
 ensure(frozen.contract==='komerce-reduction-before-physical-PG/v22'&&
  frozen.sha===sha&&
  prior.contract==='komerce-real-refund-financial-proof/v22'&&
  prior.sha===sha&&prior.runId===env.GITHUB_RUN_ID&&
  prior.parentRankingHash===frozen.ranking.rankHash&&
  prior.selectedPairRank<=5,'baseline ranking or physical proof unavailable');
 const originalAB=prior.verdict.schedules.find(x=>x.mode==='AB');
 const originalPAR=prior.verdict.schedules.find(x=>x.mode==='PAR');
 ensure(originalAB?.violation&&originalPAR?.violation,
  'original owner no longer violates business invariants (review required)');
 const samples=[],reports=[];
 for(const mode of ['AB','BA','PAR']) {
  const execution=await withClone(env,url=>{
   const stdout=cp.execFileSync(process.execPath,[child,mode],{
    cwd:root,env:{...env,DATABASE_URL:url,NODE_ENV:'test',
     KOMERCE_DISABLE_CRONS:'true',KBA_V23_MUTANT:'PREFLIGHT_ONLY'},
    timeout:40000,maxBuffer:1024*1024,encoding:'utf8',
    stdio:['ignore','pipe','pipe']});
   const line=stdout.split('\n').find(x=>x.startsWith('BUSINESS_AUDIT_V22_FINANCIAL_PROBE '));
   ensure(Boolean(line),'missing source-observed child result '+mode);
   return JSON.parse(line.slice('BUSINESS_AUDIT_V22_FINANCIAL_PROBE '.length));
  });
  const record=execution.result;
  ensure(execution.cloneDroppedAfterExecution===true&&
   record.localCloneVerified===true&&
   record.authMiddlewareExecuted===false&&
   record.simulation==='PAYPAL_FETCH_STRICT_NO_EXTERNAL_NETWORK'&&
   record.researchMutation==='PREFLIGHT_ONLY','isolation/provenance failure '+mode);
  samples.push({...record,cloneDropped:true});
  reports.push(checkFinancialSchedule(record)); // Oracle is NOT changed.
 }
 const [ab,ba,par]=reports;
 ensure(!ab.violation&&samples[0].outcomes.paypal.http===409&&
  samples[0].state.pspEvents.length===0&&ab.walletEquivalentCents===ab.capturedCents,
  'naive preflight should hide sequential AB flaw');
 ensure(!ba.violation&&samples[1].state.pspEvents.length===1&&
  samples[1].outcomes.paypal.http===200,
  'normal BA must remain valid');
 const required=['I1_ECONOMIC_REFUNDS_EXCEED_CAPTURE',
  'I2_PSP_REFUND_MISSING_FROM_LEDGER',
  'I3_OWNER_SUCCESS_WITH_UNRECORDED_PSP_REFUND'];
 ensure(par.violation&&required.every(x=>par.signals.includes(x))&&
  par.totalRefundValueCents>par.capturedCents&&
  samples[2].outcomes.paypal.http===200,
  'naive preflight must NOT cure concurrent PAR; oracle may have weakened');
 const hashes=Object.fromEntries([
  'tools/business-auditor/v22-financial-invariants.js',
  'tools/business-auditor/v23-preflight-mutant.js',
  'tools/business-auditor/v22-refund-probe-child.js',
  'services/payment-paypal.js'
 ].map(p=>[p,crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(root,p))).digest('hex')]));
 const proof={contract:'komerce-negative-control-preflight-insufficient/v23',
  sha,runId:env.GITHUB_RUN_ID,rankingHash:frozen.ranking.rankHash,
  sourceBaselineContract:prior.contract,sourceBaselineRunId:prior.runId,
  mutation:'PREFLIGHT_ONLY_TEST_ONLY_NO_BUSINESS_CODE_MODIFIED',
  hashes,samples,reports,clonesDropped:samples.every(x=>x.cloneDropped),
  productionIncidentConfirmed:false,
  conclusion:'Sequential AB green is not evidence of safety; concurrent PAR still violates I1/I2/I3. Durable financial reservation is NOT implemented.'};
 fs.writeFileSync(path.join(out,'v23-preflight-negative-control.json'),JSON.stringify(proof,null,2)+'\n');
 console.log('BUSINESS_AUDIT_V23_NEGATIVE_CONTROL '+JSON.stringify({
  sha,baseline:originalAB.signals,mutantAB:ab.signals,
  mutantBA:ba.signals,mutantPAR:par.signals,clonesDropped:proof.clonesDropped,
  safeOwnerFixProven:false}));
 return proof;
}
if(require.main===module)run(process.argv[2],process.argv[3]).catch(e=>{
 console.error('BUSINESS_AUDIT_V23_TOOL_ERROR '+(e.stack||e.message));
 process.exitCode=2;
});
module.exports={run};
