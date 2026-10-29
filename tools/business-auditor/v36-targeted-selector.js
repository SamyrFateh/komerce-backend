'use strict';
/* G3a: deterministic source-to-invariant-to-REVIEWED-adapter selection.
 * NO automated claims that any arbitrary writer pair is executable.
 * No PostgreSQL or app module imported by this selector.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {ADAPTERS}=require('./v34-experiment-registry');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const ROOT=path.resolve(__dirname,'../..');
const OWNER_PATHS=Object.freeze({
 inventory:Object.freeze(['services/inventory-service.js']),
 'fx-market':Object.freeze(['services/fx-authority.js','services/market-operation-guard.js']),
 'catalog-authorization':Object.freeze([
  'services/market-delegation-catalog-service.js',
  'services/catalog-market-exposure-service.js',
  'services/market-delegation-service.js']),
 'orders-sourcing':Object.freeze([
  'services/order-status-machine.js','services/sourcing-candidate-import-service.js'])
});
function fail(s){throw Error('V36_TARGETED_SELECTOR_TOOL_ERROR: '+s)}
function norm(p){
 if(typeof p!=='string'||!p.trim()||p.startsWith('/')||p.includes('\\')||
  p.includes('\0')||p.split('/').includes('..'))fail('unsafe source path');
 return p.replace(/^\.\//,'').replace(/\/+/g,'/');
}
function choose({files,catalog,maxClones=2,exists=(p)=>fs.existsSync(path.join(ROOT,p))}){
 if(!Array.isArray(files)||files.length<1||!catalog||
  catalog.contract!=='komerce-invariant-provenance-registry/v35'||
  !Array.isArray(catalog.invariants)||!Array.isArray(catalog.cards)||
  !/^[a-f0-9]{64}$/.test(catalog.registryHash||''))
  fail('missing source files/invariant registry provenance');
 if(!Number.isInteger(maxClones)||maxClones<0||maxClones>12)
  fail('invalid clone budget 0..12');
 const changed=[...new Set(files.map(norm))].sort();
 const impacted=catalog.invariants.filter(inv=>
  changed.includes(inv.featureFile)||
  (Array.isArray(inv.ownedSources)&&inv.ownedSources.some(p=>changed.includes(p)))||
  (inv.test&&changed.includes(inv.test))).map(inv=>({
  id:inv.id,feature:inv.feature,domain:inv.auditorDomain,
  status:inv.testStatus,explicitOracleLinked:false})); // no false claim.
 const candidates=[];
 for(const a of ADAPTERS){
  const exact=changed.filter(p=>(OWNER_PATHS[a.id]||[]).includes(p));
  if(exact.length)
   candidates.push({id:a.id,matchedOwners:exact,clones:a.modes.length,
    reason:'EXACT_CANONICAL_OWNER_REVIEWED_GATE',
    domains:a.domains,actualReachabilityProven:false,
    riskScore:exact.length*100+impacted.filter(i=>a.domains.includes(i.domain)).length});
 }
 candidates.sort((a,b)=>b.riskScore-a.riskScore||a.id.localeCompare(b.id));
 let spent=0;const selected=[],deferred=[];
 for(const c of candidates){
  if(spent+c.clones<=maxClones){selected.push(c);spent+=c.clones}
  else deferred.push({...c,reason:'BUDGET_DEFERRED_NO_EXECUTION'});
 }
 const unmatched=changed.filter(p=>!Object.values(OWNER_PATHS).some(paths=>paths.includes(p)));
 const statuses=changed.map(p=>({
  file:p,exists:Boolean(exists(p)),
  impactInvariantIds:impacted.filter(x=>catalog.invariants.some(inv=>
    inv.id===x.id&&(inv.featureFile===p||inv.ownedSources.includes(p)||inv.test===p)))
    .map(x=>x.id),
  reviewedGateCandidate:Object.entries(OWNER_PATHS).filter(([id,paths])=>paths.includes(p))
   .map(([id])=>id),
  execution:'NOT_CERTIFIED_BY_SELECTION_ONLY'
 }));
 const payload={contract:'komerce-targeted-experiment-plan/v36',
  featureRegistryHash:catalog.registryHash,files:changed,
  impactedInvariants:impacted,changedSources:statuses,
  candidateAdapters:candidates,selectedAdapters:selected,
  deferredAdapters:deferred,unmatchedChanges:unmatched,
  cloneBudget:maxClones,plannedClones:spent,
  untestedFileCount:unmatched.length,
  arbitraryFixtureGeneration:false,
  unknownPairExecutability:'NOT_COVERED',
  selectionDoesNotProveBug:true};
 return {...payload,selectionHash:sha(JSON.stringify(payload))};
}
module.exports={choose,OWNER_PATHS,norm};
