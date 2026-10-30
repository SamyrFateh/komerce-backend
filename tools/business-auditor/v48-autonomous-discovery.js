#!/usr/bin/env node
'use strict';
/**
 * Autonomous, bounded discovery over real owner code.
 * No mutant IDs, test-only source loader, truth labels, or expected findings.
 * The SOURCE DIFF chooses reviewed owners; independent physical oracles judge
 * their actual execution on ephemeral local PG16 clones. Unsupported files
 * remain untested, never PASS. This is not full-repository certification.
 */
const fs=require('node:fs'),path=require('node:path'),
 cp=require('node:child_process'),crypto=require('node:crypto');
const {assertLocalTestTarget}=require('./cli');
const {withClone}=require('./v16-cloned-database');
const {start,one}=require('./v45-multidomain-physical');
const {plan:inventoryPlan,execute:inventoryExecute}=require('./v40-generated-inventory');
const {sourceAnchor}=require('./v30-inventory-gate');
const {inspect:sourcingOracle}=require('./v33-orders-sourcing-oracle');
const ROOT=path.resolve(__dirname,'../..');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const OWNER_REGISTRY=Object.freeze({
 'services/inventory-service.js':['INVENTORY'],
 'services/fx-authority.js':['FX'],
 'services/market-operation-guard.js':['MARKET'],
 'services/order-status-machine.js':['ORDER'],
 'services/sourcing-candidate-import-service.js':['SOURCING']
});
const SUPPORTED=Object.freeze(['INVENTORY','FX','MARKET','ORDER','SOURCING']);
const fail=s=>{throw Error('V48_DISCOVERY_ERROR: '+s)};
function git(...args){return cp.execFileSync('git',args,{
 cwd:ROOT,encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024}).trim()}
function validatePaths(paths){
 if(!Array.isArray(paths)||paths.some(p=>typeof p!=='string'||
   p.startsWith('/')||p.includes('..')||p.includes('\\')||
   !/^[a-zA-Z0-9._/-]+$/.test(p)))fail('untrusted source diff path');
 return [...new Set(paths)].sort();
}
function select({changedPaths=[],allReviewed=false}={}){
 const paths=validatePaths(changedPaths);
 const selected=allReviewed?SUPPORTED:
  [...new Set(paths.flatMap(p=>OWNER_REGISTRY[p]||[]))];
 const uncovered=paths.filter(p=>p.startsWith('services/')||
  p.startsWith('routes/')||p.startsWith('features/'))
  .filter(p=>!Object.hasOwn(OWNER_REGISTRY,p));
 return {contract:'komerce-change-driven-owner-selection/v48',
  mode:allReviewed?'ALL_REVIEWED_OWNERS':'GIT_CHANGE_DRIVEN',
  changedPaths:paths,selected,
  unsupportedChangedPaths:uncovered,
  entirelyCovered:uncovered.length===0,
  genericAllRepositoryDetectionCertified:false};
}
function changed(base=null,deps={}){
 const run=deps.git||git;
 if(base&&!/^[a-f0-9]{40}$/.test(base))fail('invalid base SHA');
 if(base){
  try{run('merge-base','--is-ancestor',base,'HEAD');}
  catch{fail('base is not an ancestor of checkout');}
 }
 const modified=[...new Set([
  ...(base?run('diff','--name-only',base,'HEAD'):'' ).split('\n'),
  ...run('diff','--name-only','HEAD').split('\n')
 ].filter(Boolean))];
 return validatePaths(modified);
}
async function sourcing(env,deps={}){
 const physical=await (deps.withClone||withClone)(env,
  url=>(deps.start||start)(url,'SOURCING',null,env));
 if(physical.cloneCreated!==true||physical.cloneDroppedAfterExecution!==true)
  fail('sourcing disposable clone lifecycle unproven');
 const raw=physical.result;
 if(raw.mode!=='SOURCING'||raw.contract!=='komerce-orders-sourcing-physical/v33'||
  raw.v45MutationApplied!==false||raw.ownerInvoked!==true||
  raw.canonicalPg!==true||raw.noExternalNetwork!==true)
  fail('sourcing real owner provenance missing');
 const observation=sourcingOracle(raw);
 return {mode:'SOURCING',signals:observation.signals,oracle:observation.contract,
  realOwnerExecuted:true,cloneDropped:true,canonicalPg:true,mutantIdSupplied:false};
}
async function inventory(env,deps={}){
 const anchor=await (deps.anchor||sourceAnchor)();
 const chosen=inventoryPlan({files:['services/inventory-service.js'],budget:6,anchor});
 const rows=[];
 for(const spec of chosen.selected)rows.push(
  await (deps.inventoryExecute||inventoryExecute)(spec,env,null));
 if(rows.some(x=>!x.realOwnerCalled&&x.realOwnerCalled!==undefined||
  x.verdict!=='PASS_WITH_EVIDENCE'&&x.verdict!=='BUSINESS_VIOLATION'||
  x.cloneDropped!==true||x.canonicalPostgres!==true||
  x.sourceMutation!==null))
  fail('inventory physical case lacks unmutated owner/PG proof');
 return {mode:'INVENTORY',
  signals:[...new Set(rows.flatMap(x=>x.oracle?.signals||[]))],
  oracle:'komerce-independent-generated-inventory-oracle/v40',
  generatedCases:rows.length,realOwnerExecuted:true,
  cloneDropped:rows.every(x=>x.cloneDropped),
  canonicalPg:rows.every(x=>x.canonicalPostgres),mutantIdSupplied:false};
}
async function run({base=null,allReviewed=false,out=null}={},env=process.env,deps={}){
 assertLocalTestTarget(env);
 const sourceSha=env.GITHUB_SHA||git('rev-parse','HEAD');
 if(!/^[a-f0-9]{40}$/.test(sourceSha)||sourceSha!==(deps.git||git)('rev-parse','HEAD'))
  fail('CI SHA not matching repository checkout');
 const files=await (deps.changed||changed)(base,deps);
 const selection=select({changedPaths:files,allReviewed});
 const results=[],errors=[];
 for(const mode of selection.selected){
  try{
   const observation=mode==='INVENTORY'?await (deps.inventory||inventory)(env,deps):
    mode==='SOURCING'?await (deps.sourcing||sourcing)(env,deps):
    await (deps.one||one)(mode,null,env);
   if(observation.mode!==mode||!Array.isArray(observation.signals)||
     observation.realOwnerExecuted!==true||observation.cloneDropped!==true||
     observation.canonicalPg!==true||observation.mutationApplied===true)
    fail('owner evidence incomplete '+mode);
   results.push({mode,verdict:observation.signals.length?
    'BUSINESS_VIOLATION':'PASS_WITH_EVIDENCE',
    signals:observation.signals,cloneDropped:true,
    ownerCodeExecuted:true,sourceMutantIdProvided:false,
    generatedCases:observation.generatedCases||null});
  }catch(e){
   errors.push({mode,code:'OWNER_EXPERIMENT_FAILED',
    diagnostic:String(e.message||e).slice(0,280)});
  }
 }
 const report={contract:'komerce-autonomous-code-diff-discovery/v48',
  sha:sourceSha,selection,
  ownerSourceFingerprints:Object.fromEntries(selection.selected.map(mode=>{
   const f=Object.entries(OWNER_REGISTRY).find(([,m])=>m.includes(mode))[0];
   return [f,hash(fs.readFileSync(path.join(ROOT,f),'utf8'))];
  })),
  knownBusinessIssues:{SRC3_ARCHIVE_EVENT_OLD_STATE_LOST:3127},
  observations:results,errors,
  summary:{reviewedOwnersExecuted:results.length,
   touchedReviewedOwners:selection.selected.length,
   ownerErrors:errors.length,
   observedViolationOwners:results.filter(x=>x.verdict==='BUSINESS_VIOLATION').length,
   observedSignals:[...new Set(results.flatMap(x=>x.signals))],
   unsupportedChangedPaths:selection.unsupportedChangedPaths.length,
   status:errors.length?'EXPERIMENT_ERROR':
    selection.selected.length===0?'NO_ELIGIBLE_OWNER':
    results.some(x=>x.signals.length)?'BUSINESS_CONTRADICTION_FOUND':
    'NO_CONTRADICTION_IN_REVIEWED_FIXTURES'},
  classification:'SELF_SELECTED_PHYSICAL_OWNER_PROBES_NOT_BLIND_G4',
  limits:['EXISTING_REVIEWED_ORACLES_ONLY',
   'NO_ARBITRARY_SERVICE_FIXTURE_GENERATION',
   'NO_UNKNOWN_BUG_DISCOVERY_CERTIFICATION',
   'UNSUPPORTED_SOURCE_FILES_NOT_RUN',
   'NO_HUMAN_CONFIRMATION_OF_NEW_SIGNALS'],
  certifiedAutonomousUnknownBugDiscovery:false};
 if(out){
  fs.mkdirSync(path.resolve(out),{recursive:true});
  fs.writeFileSync(path.join(path.resolve(out),'autonomous-discovery.json'),
   JSON.stringify(report,null,2)+'\n');
  fs.writeFileSync(path.join(path.resolve(out),'autonomous-discovery.md'),[
   '# V48 self-selected real-owner discovery','',
   '- Source SHA: '+sourceSha,
   '- Selected real owners: '+selection.selected.join(', '),
   '- Sources not covered: '+selection.unsupportedChangedPaths.join(', '),
   '- Verdict: '+report.summary.status,
   '- Signals: '+report.summary.observedSignals.join(', '),
   '- Independent blind benchmark: NOT EXECUTED',
   '- New unknown production bug confirmed: NO',
   '- Business source mutations supplied to scanner: NONE',''].join('\n'));
 }
 console.log('AUDITOR_V48_AUTONOMOUS '+JSON.stringify({
  sha:sourceSha,selected:selection.selected,signals:report.summary.observedSignals,
  status:report.summary.status,errors:errors.length}));
 if(errors.length)fail('one or more actual owner experiments failed: '+JSON.stringify(errors));
 return report;
}
function parse(args){
 const opts={base:null,allReviewed:false,out:null};
 for(let i=0;i<args.length;i++){
  if(args[i]==='--all-reviewed'){opts.allReviewed=true;continue}
  if(!['--base','--out'].includes(args[i])||!args[i+1])
   fail('usage [--base SHA] [--all-reviewed] [--out DIR]');
  opts[args[i]==='--base'?'base':'out']=args[++i];
 }
 return opts;
}
if(require.main===module)run(parse(process.argv.slice(2))).catch(e=>{
 console.error(e.stack||e.message);process.exitCode=2});
module.exports={OWNER_REGISTRY,SUPPORTED,validatePaths,select,changed,sourcing,inventory,run,parse};
