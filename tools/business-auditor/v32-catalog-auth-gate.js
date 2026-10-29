#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {assertLocalTestTarget}=require('./cli'),{withClone}=require('./v16-cloned-database');
const {inspect,forged}=require('./v32-catalog-auth-oracle');
const ROOT=path.resolve(__dirname,'../..');
const error=s=>{throw Error('V32_GATE_TOOL_ERROR: '+s)};
const paths=['services/market-delegation-catalog-service.js',
 'services/catalog-market-exposure-service.js','services/market-delegation-service.js'];
function sourceAnchor(){
 const originals=paths.map(p=>fs.readFileSync(path.join(ROOT,p),'utf8'));
 if(!/async function setExposure\s*\(/.test(originals[0])||
   !/resolveAuthorization\(/.test(originals[0])||
   !/async function setExposure\s*\(/.test(originals[1])||
   !/product_market_exposure/.test(originals[1])||
   !/async function resolveAuthorization\s*\(/.test(originals[2])||
   !/MARKET_MEMBERSHIP_REQUIRED/.test(originals[2])||
   !/MARKET_CAPABILITY_REQUIRED/.test(originals[2]))
  error('canonical delegated writers or auth guard source drifted');
 return {contract:'komerce-catalog-auth-source-anchor/v32',
  paths,hash:crypto.createHash('sha256').update(originals.join('\n')).digest('hex'),
  sourceOnlyBeforeDb:true,actualOwnersRequired:true,
  fullHttpAuthProven:false};
}
async function run(env=process.env,options={},deps={}){
 assertLocalTestTarget(env);
 const anchor=deps.anchor?deps.anchor():sourceAnchor();
 if(anchor?.contract!=='komerce-catalog-auth-source-anchor/v32'||
  !/^[a-f0-9]{64}$/.test(anchor.hash||'')||!anchor.actualOwnersRequired)
  error('source owner provenance absent');
 const execute=deps.execute||((url,mode)=>{
  const out=cp.execFileSync(process.execPath,[path.join(__dirname,'v32-catalog-auth-child.js'),mode],{
   cwd:ROOT,encoding:'utf8',timeout:45000,maxBuffer:2*1024*1024,
   stdio:['ignore','pipe','pipe'],
   env:{...env,DATABASE_URL:url,NODE_ENV:'test',KOMERCE_DISABLE_CRONS:'true'}});
  const line=out.split('\n').find(l=>l.startsWith('BUSINESS_AUDIT_V32_PHYSICAL '));
  if(!line)error('physical service evidence missing '+mode);
  return JSON.parse(line.slice('BUSINESS_AUDIT_V32_PHYSICAL '.length));
 });
 const cases=[];
 for(const mode of ['CATALOG','AUTH']){
  const done=await (deps.withClone||withClone)(env,url=>execute(url,mode));
  if(!done.cloneDroppedAfterExecution)error('not all clones dropped '+mode);
  const oracle=inspect(done.result);
  if(oracle.violation)error('real owner contract broken '+mode+': '+oracle.signals.join('|'));
  const negative=forged(done.result);
  if(mode==='CATALOG'&&!negative.signals.includes('CAT2_EXPOSURE_LEAKED_TO_ANOTHER_MARKET'))
   error('cross-market forged exposure passed oracle');
  if(mode==='AUTH'&&(!negative.signals.includes('AUTH2_MARKET_OR_MEMBERSHIP_ISOLATION_BROKEN')||
   !negative.signals.includes('AUTH4_REJECTED_ACTION_CREATED_CATALOG_OR_AUDIT_WRITES')))
   error('unauthorized forged write passed oracle');
  cases.push({mode,verdict:'PASS_WITH_EVIDENCE',
   service:mode==='CATALOG'?paths[0]:paths[2],oracle,negativeControl:negative,
   cloneDropped:true,authenticatedHttpRouteTested:false});
 }
 const r={contract:'komerce-catalog-auth-physical-gate/v32',sha:env.GITHUB_SHA||null,
  source:anchor,cases,allClonesDropped:true,
  proofScope:'LIVE_DELEGATED_OWNER_ON_TWO_KBA_CLONES; REAL_MEMBERSHIP_AND_FOREIGN_MARKET_REJECTIONS',
  fullPublicationReadinessCertified:false,allRolesCertified:false,productionFixProven:false};
 console.log('BUSINESS_AUDIT_V32_OWNER_GATE '+JSON.stringify({
  modes:cases.map(x=>x.mode),signals:cases.map(x=>x.oracle.signals),
  forged:cases.map(x=>x.negativeControl.signals),allClonesDropped:true
 }));
 return r;
}
if(require.main===module)run().then(r=>{
 if(process.argv[2]){const out=path.resolve(process.argv[2]);
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'v32-catalog-auth-gate.json'),JSON.stringify(r,null,2)+'\n')}
}).catch(e=>{console.error('BUSINESS_AUDIT_V32_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2});
module.exports={sourceAnchor,run};
