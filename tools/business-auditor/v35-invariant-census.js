'use strict';
/**
 * G2: lossless, source-grounded feature invariant census. No application code
 * imports; feature declarations run in restricted VM only after lexical guard.
 * A linked test is EVIDENCE_REFERENCE, never an executed proof.
 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const DOMAIN_MAP={payment:'finance',payments:'finance',refunds:'finance',
 wallet:'finance','wallet-loyalty':'finance',settlement:'finance',
 catalog:'catalogue',catalogue:'catalogue','economic-engine':'pricing',
 market:'authorization','market-delegation':'authorization',
 'market-autonomy':'authorization','market-control-plane':'authorization',
 'market-operator-dashboard':'authorization',purchasing:'inventory',
 'local-stock':'inventory',customs:'logistics',orders:'orders',
 sourcing:'sourcing',inventory:'inventory',logistics:'logistics'};
function readCard(source,file){
 if(!/^features\/[\w.-]+\.feature\.js$/.test(file))throw Error('G2_UNSAFE_FEATURE_PATH');
 // The catalog is a literal registry; modules with side-effects are NOT loaded.
 if(/\b(?:const|let|var)\s+\w+\s*=\s*require\s*\(/.test(source)||
    /\bmodule\.exports\s*=\s*\{\s*invariants\s*:\s*\[\s*require\s*\(/.test(source))
  return {error:'FEATURE_NOT_SAFE_TO_EVALUATE',feature:file};
 const module={exports:null};
 try{
  vm.runInNewContext(source,{module,exports:{}},{
   timeout:1000,filename:file,contextCodeGeneration:{strings:false,wasm:false}});
  if(!module.exports||!Array.isArray(module.exports.invariants))
   return {error:'NO_INVARIANTS_ARRAY',feature:file};
  return {data:module.exports};
 }catch(e){return {error:'FEATURE_PARSE_FAILED',feature:file,reason:String(e.message).slice(0,120)}}
}
function normalize(root=ROOT,{files=null,read=null}={}){
 const list=(files||fs.readdirSync(path.join(root,'features'))
  .filter(x=>x.endsWith('.feature.js')).map(x=>'features/'+x)).slice().sort();
 const get=read||(p=>fs.readFileSync(path.join(root,p),'utf8'));
 const cards=[],errors=[],all=[];
 for(const file of list){
  const source=get(file),result=readCard(source,file);
  if(result.error){errors.push({file,code:result.error});continue}
  const card=result.data,feature=card.name||path.basename(file,'.feature.js'),
   declaredDomain=card.domain||feature,domain=DOMAIN_MAP[declaredDomain]||'unmapped';
  const entries=card.invariants;
  cards.push({file,feature,declaredDomain,domain,count:entries.length,hash:sha(source)});
  for(let i=0;i<entries.length;i++){
   const entry=entries[i],statement=typeof entry==='string'?entry:entry?.statement;
   const test=typeof entry==='object'&&typeof entry?.test==='string'?entry.test:null;
   if(typeof statement!=='string'||!statement.trim()){
    errors.push({file,index:i,code:'INVALID_INVARIANT_STATEMENT'});continue;
   }
   const id='FC-'+sha(file+'\0'+String(i)+'\0'+statement.trim()).slice(0,20);
   const exists=Boolean(test&&fs.existsSync(path.join(root,test)));
   all.push({id,feature,domain,source:file,index:i,statement:statement.trim(),
    associatedTest:test,associatedTestExists:exists,
    status:'DECLARED_UNCALIBRATED',
    proof:'NOT_EXECUTED_BY_THIS_SCANNER',
    programmaticOracleAssigned:false,
    sha:sha(statement.trim()),sourceHash:sha(source)});
  }
 }
 return {contract:'komerce-feature-invariant-census/v35',cards,errors,all,
  summary:{featureFiles:list.length,parsedCards:cards.length,parseErrors:errors.length,
   declaredInvariants:all.length,
   associatedTests:all.filter(x=>x.associatedTest).length,
   associatedTestsFound:all.filter(x=>x.associatedTestExists).length,
   certifiedByDeclaration:0,unmappedDomain:all.filter(x=>x.domain==='unmapped').length}};
}
const VERIFIED_LINKS=Object.freeze([
 {adapter:'orders-sourcing',mode:'SOURCING',invariant:'SRC3_ARCHIVE_EVENT_OLD_STATE_LOST',
  owner:'services/sourcing-candidate-import-service.js',domain:'sourcing',
  status:'BUSINESS_VIOLATION',issue:3127},
 {adapter:'orders-sourcing',mode:'ORDER',invariant:'ORD2_VALID_TRANSITION_LACKS_CANONICAL_HISTORY',
  owner:'services/order-status-machine.js',domain:'orders',status:'PASS_WITH_EVIDENCE'},
 {adapter:'inventory',mode:'FOREIGN_ORDER',invariant:'INV1_CANONICAL_ORDER_IDENTITY_BROKEN',
  owner:'services/inventory-service.js',domain:'inventory',status:'PASS_WITH_EVIDENCE'},
 {adapter:'fx-market',mode:'FX',invariant:'FX1_PIVOT_RESULT_OR_ROUNDING_MISMATCH',
  owner:'services/fx-authority.js',domain:'pricing',status:'PASS_WITH_EVIDENCE'},
 {adapter:'catalog-authorization',mode:'CATALOG',invariant:'CAT2_EXPOSURE_LEAKED_TO_ANOTHER_MARKET',
  owner:'services/market-delegation-catalog-service.js',domain:'catalogue',
  status:'PASS_WITH_EVIDENCE'},
 {adapter:'catalog-authorization',mode:'AUTH',invariant:'AUTH2_MARKET_OR_MEMBERSHIP_ISOLATION_BROKEN',
  owner:'services/market-delegation-team-service.js',domain:'authorization',
  status:'PASS_WITH_EVIDENCE'}
]);
function coverage(census,physicalIndex=[]){
 if(census.contract!=='komerce-feature-invariant-census/v35')
  throw Error('G2_CENSUS_MISSING');
 const cases=new Map(physicalIndex.map(x=>[x.id,x]));
 const covered=VERIFIED_LINKS.map(x=>({...x,physicalWitness:
  [...cases.values()].some(y=>y.domain===x.domain&&
   y.verdict===x.status&&y.cloneDropped===true)}));
 const domains=[...new Set(census.all.map(x=>x.domain))].sort();
 return {contract:'komerce-invariant-coverage/v35',
  source:'FEATURE_CARD_DECLARATIONS_AND_EXPLICIT_SCANNER_LINKS',
  declaredInvariants:census.summary.declaredInvariants,
  declaredFeatures:census.summary.parsedCards,
  declarationsWithUnitTest:census.summary.associatedTests,
  assertionsExecutedByFeatureCensus:0,
  linkedScannerWitnesses:covered,
  featureCardInvariantsCertified:0,
  domainDetails:domains.map(domain=>({
   domain,declared:census.all.filter(x=>x.domain===domain).length,
   declarationsCertifiedByThisCensus:0,
   reviewedIndependentWitnessLinks:covered.filter(x=>x.domain===domain).length,
   witnessedInThisRun:covered.filter(x=>x.domain===domain&&x.physicalWitness).length
  })),
  summary:{unclassified:census.summary.unmappedDomain,
   declaredButNotCertified:census.summary.declaredInvariants,
   knownReviewLinks:covered.length,physicallyVerifiedLinks:covered.filter(x=>x.physicalWitness).length,
   coveragePercent:null,
   warning:'Witness links DO NOT establish semantic equivalence to specific feature-card statements; independent statement matching is still required.'}};
}
function toMarkdown(c,cover){
 return ['# G2 — inventaire des invariants déclarés','',
  '- Fiches analysées : '+c.summary.parsedCards+'/'+c.summary.featureFiles,
  '- Invariants déclarés : '+c.summary.declaredInvariants,
  '- Références de tests associées : '+c.summary.associatedTests,
  '- Témoins physiques reliés aux domaines : '+cover.summary.physicallyVerifiedLinks,
  '- Invariants des fiches certifiés par ce recensement : **0**',
  '- Taux de couverture sémantique certifiée : **NON CALCULABLE** avant mapping statement→oracle','',
  '| Domaine | Déclarés | Témoins de domaine | Certifiés au niveau invariant |',
  '|---|---:|---:|---:|',
  ...cover.domainDetails.map(x=>'| '+x.domain+' | '+x.declared+' | '+
   x.witnessedInThisRun+' | 0 |'),
  '','## Alertes de schéma','',
  ...c.errors.map(x=>'- '+x.file+': '+x.code),
  '','## Limites','',
  'Un test référencé par une fiche ne prouve PAS qu’il a été exécuté.',
  'Une preuve de domaine ne démontre pas chaque invariant déclaré.',
  'Le matching sémantique et les preuves par invariant sont le prochain travail G2.',
  ''].join('\n');
}
module.exports={readCard,normalize,coverage,toMarkdown,VERIFIED_LINKS};
