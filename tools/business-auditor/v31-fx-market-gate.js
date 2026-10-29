'use strict';
/** V3.1 full-schema FX / market lifecycle certification, one PG clone per mode. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {assertLocalTestTarget}=require('./cli');
const {withClone}=require('./v16-cloned-database');
const {inspect,negative}=require('./v31-fx-market-oracle');
const ROOT=path.resolve(__dirname,'../..');
const required=(x,msg)=>{if(!x)throw Error('V31_GATE_TOOL_ERROR: '+msg)};
function sourceAnchor(){
 const fx=fs.readFileSync(path.join(ROOT,'services/fx-authority.js'),'utf8');
 const market=fs.readFileSync(path.join(ROOT,'services/market-operation-guard.js'),'utf8');
 required(/async function convert\s*\(/.test(fx)&&
  /currency_parities/.test(fx)&&/roundHalfEven\(/.test(fx),'FX authority source drift');
 required(/async function assertMarketOperationAllowed\s*\(/.test(market)&&
  /local_price_activate/.test(market)&&/customs_shipment_create/.test(market),
  'market operation owner source drift');
 return {fxOwner:'services/fx-authority.js',
  marketOwner:'services/market-operation-guard.js',
  hash:crypto.createHash('sha256').update(fx+'\n'+market).digest('hex'),
  actualOwnersRequired:true,scope:'FX_PIVOT_AND_MARKET_LIFECYCLE_NOT_MARKET_MEMBERSHIP'};
}
async function run(env=process.env,opts={},deps={}){
 assertLocalTestTarget(env);
 const anchor=deps.anchor?deps.anchor():sourceAnchor();
 required(anchor.actualOwnersRequired&&/^[a-f0-9]{64}$/.test(anchor.hash||''),
  'source anchor missing');
 const modes=['FX','MARKET'],cases=[];
 for(const mode of modes){
  const execute=deps.execute||((url,m)=>{
   const out=cp.execFileSync(process.execPath,[path.join(__dirname,'v31-fx-market-child.js'),m],{
    cwd:ROOT,encoding:'utf8',timeout:35000,maxBuffer:1024*1024,
    env:{...env,DATABASE_URL:url,NODE_ENV:'test',KOMERCE_DISABLE_CRONS:'true'},
    stdio:['ignore','pipe','pipe']});
   const line=out.split('\n').find(x=>x.startsWith('BUSINESS_AUDIT_V31_PHYSICAL '));
   required(Boolean(line),'missing real owner proof '+m);
   return JSON.parse(line.slice('BUSINESS_AUDIT_V31_PHYSICAL '.length));
  });
  const result=await (deps.withClone||withClone)(env,url=>execute(url,mode));
  required(result.cloneDroppedAfterExecution===true,'clone teardown failed '+mode);
  const raw=result.result;
  const oracle=inspect(raw);
  required(!oracle.violation,'real owner business regression '+mode+' '+oracle.signals.join('|'));
  const fake=negative(raw);
  required(fake.signals.includes(mode==='FX'?
   'FX1_PIVOT_RESULT_OR_ROUNDING_MISMATCH':'MK2_MARKET_OPERATION_POLICY_VIOLATION'),
   'negative control bypassed independent oracle');
  cases.push({mode,source:mode==='FX'?anchor.fxOwner:anchor.marketOwner,
   verdict:'PASS_WITH_EVIDENCE',oracle,negativeControl:fake,
   cloneDropped:true,authenticatedRouteTested:false});
 }
 return {contract:'komerce-fx-market-physical-gate/v31',
  sha:env.GITHUB_SHA||null,source:anchor,cases,allClonesDropped:true,
  staticSourceHash:anchor.hash,
  limits:'Two canonical service exercises only; no auth middleware, market membership, market isolation, floating EUR/USD freshness or production correctness certified.'};
}
if(require.main===module){
 run().then(x=>{
  if(process.argv[2]){
   fs.mkdirSync(path.resolve(process.argv[2]),{recursive:true});
   fs.writeFileSync(path.join(path.resolve(process.argv[2]),'v31-fx-market-gate.json'),
    JSON.stringify(x,null,2)+'\n');
  }
  console.log('BUSINESS_AUDIT_V31_OWNER_GATE '+JSON.stringify({
   modes:x.cases.map(c=>c.mode),fx:x.cases[0].oracle.detail,
   marketChecks:x.cases[1].oracle.checks,
   negative:x.cases.map(c=>c.negativeControl.signals),
   allClonesDropped:x.allClonesDropped
  }));
 }).catch(e=>{console.error('BUSINESS_AUDIT_V31_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2});
}
module.exports={run,sourceAnchor};
