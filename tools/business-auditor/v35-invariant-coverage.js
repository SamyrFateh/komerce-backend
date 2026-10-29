'use strict';
/**
 * G2 - source-grounded FEATURE invariant coverage inventory, no DB/PSP or app import.
 * Declared {test} => test address, NOT a passed test, and definitely NOT
 * an independently proven business invariant.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const ROOT=path.resolve(__dirname,'../..');
const {loadRunners,classifyTest,coveredByOfficialRunner}=require('../../scripts/feature-invariant-check');
const {DOMAINS}=require('./v34-experiment-registry');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function failure(m){throw Error('V35_INVARIANT_REGISTRY_TOOL_ERROR: '+m)}
const clean=x=>String(x||'').replace(/\s+/g,' ').trim();
const domainMap={
 sourcing:'sourcing',catalog:'catalogue',catalogue:'catalogue',
 orders:'orders',purchasing:'inventory',inventory:'inventory','local-stock':'inventory',
 payments:'finance',refunds:'finance',settlement:'finance',wallet:'finance','wallet-loyalty':'finance',
 logistics:'logistics',customs:'logistics',
 'economic-engine':'pricing','business-rules':'pricing',
 auth:'authorization','auth-identity':'authorization','auth-passkey':'authorization',
 market:'authorization','market-control-plane':'authorization',
 'market-autonomy':'authorization','market-delegation':'authorization',
 'market-operator-dashboard':'authorization'
};
function parseCard(source,filename){
 const context={module:{exports:{}},exports:{}};
 try{
  const script=new vm.Script(source,{filename});
  script.runInNewContext(context,{timeout:1200});
  const c=context.module.exports;
  if(!c||typeof c!=='object'||Array.isArray(c))failure('non-object feature card: '+filename);
  return c;
 }catch(e){failure('unable to load feature card '+filename+': '+e.message)}
}
function normalizedPath(p){
 if(typeof p!=='string'||!p||p.startsWith('/')||p.includes('\0')||
  p.split(/[\\/]/).includes('..')||p.includes('\\'))return null;
 return p;
}
function probeTest(test,root,runners){
 const file=normalizedPath(test),kind=typeof test==='string'?classifyTest(test):'unknown';
 const exists=Boolean(file&&fs.existsSync(path.join(root,file))&&
  fs.statSync(path.join(root,file)).isFile());
 const runnerCovered=exists&&coveredByOfficialRunner(test,kind,runners);
 return {test:file||null,kind,exists,runnerCovered,
  status:!file?'INVALID_TEST_REFERENCE':!exists?'TEST_FILE_MISSING':
   !runnerCovered?'TEST_RUNNER_MISSING':'TEST_DECLARED_RUNNER_REGISTERED'};
}
function cardFiles(card){
 const result=[];
 for(const category of ['services','routes','middleware','utils','core','validators']){
  for(const p of Array.isArray(card.files?.[category])?card.files[category]:[]){
   const f=normalizedPath(p);
   if(f)result.push(f);
  }
 }
 return [...new Set(result)].sort();
}
function build({root=ROOT,cardEntries,runners,fileExists=fs.existsSync}={}){
 if(!Array.isArray(cardEntries)||!cardEntries.length)failure('no feature-card files observed');
 const records=[],cards=[],hashes=[],keys=new Set();
 for(const e of cardEntries.slice().sort((a,b)=>a.file.localeCompare(b.file))){
  const file=normalizedPath(e.file);
  if(!file||!file.startsWith('features/')||!file.endsWith('.feature.js')||keys.has(file))
   failure('invalid/duplicated feature card path '+e.file);
  keys.add(file);
  const source=e.source,card=parseCard(source,file);
  const feature=String(card.name||card.id||path.basename(file,'.feature.js'));
  const domain=domainMap[card.domain]||domainMap[feature]||null;
  const inv=card.invariants;
  if(!Array.isArray(inv))failure('invariants not an array '+file);
  const ownedPaths=cardFiles(card),cardHash=sha(source);
  hashes.push(file+':'+cardHash);
  const before=records.length;
  const seen=new Map();
  for(let index=0;index<inv.length;index++){
   const v=inv[index];
   const statement=clean(typeof v==='string'?v:v?.statement);
   if(!statement)failure('empty/unrecognizable invariant '+file+' #'+index);
   const ref=(v&&typeof v==='object')?v.test:null;
   const declared=typeof ref==='string'&&ref.trim().length>0;
   const test=declared?probeTest(ref,root,runners):null;
   const repeated=(seen.get(statement)||0)+1;seen.set(statement,repeated);
   const id='KINV-'+sha(file+'|'+index+'|'+statement).slice(0,18);
   const r={id,feature,featureFile:file,featureDomain:card.domain||null,
    auditorDomain:domain,ordinal:index+1,statement,owner:card.owner||null,
    ownedSources:ownedPaths,
    declaration:declared?'DECLARED_WITH_TEST':'TEXT_ONLY',
    test:test?.test||null,testKind:test?.kind||null,
    testStatus:test?.status||'NO_EXECUTABLE_TEST_DECLARED',
    testExists:test?.exists||false,officialRunnerRegistered:test?.runnerCovered||false,
    runtimeTestResult:'NOT_EXECUTED_BY_THIS_AUDIT',
    businessOracle:'NOT_LINKED_TO_INVARIANT',
    physicalEvidence:'NOT_ATTRIBUTED_TO_THIS_INVARIANT',
    fullyCertified:false,
    duplicateStatementWithinCard:repeated>1};
   records.push(r);
  }
  cards.push({file,name:feature,domain:card.domain||null,
   auditorDomain:domain,owner:card.owner||null,sourceHash:cardHash,
   declarationCount:records.length-before,ownedSources:ownedPaths});
 }
 const unique=new Set(records.map(r=>r.id));
 if(unique.size!==records.length)failure('invariant id collision');
 const count=status=>records.filter(r=>r.testStatus===status).length;
 const byFeature=cards.map(c=>{
  const rows=records.filter(r=>r.featureFile===c.file);
  return {feature:c.name,domain:c.auditorDomain,featureFile:c.file,
   total:rows.length,textOnly:rows.filter(r=>r.declaration==='TEXT_ONLY').length,
   registered:rows.filter(r=>r.officialRunnerRegistered).length,
   missingTest:rows.filter(r=>r.testStatus==='TEST_FILE_MISSING').length,
   missingRunner:rows.filter(r=>r.testStatus==='TEST_RUNNER_MISSING').length,
   observedPassing:0,independentOraclesLinked:0};
 });
 const byDomain=[...DOMAINS,'UNMAPPED'].map(d=>{
  const subset=records.filter(r=>(r.auditorDomain||'UNMAPPED')===d);
  return {domain:d,total:subset.length,textOnly:subset.filter(r=>r.declaration==='TEXT_ONLY').length,
   registered:subset.filter(r=>r.officialRunnerRegistered).length,
   observedPassing:0,independentOraclesLinked:0};
 });
 const metrics={cards:cards.length,declared:records.length,
  textOnly:count('NO_EXECUTABLE_TEST_DECLARED'),
  declaredWithTest:records.filter(r=>r.declaration==='DECLARED_WITH_TEST').length,
  testFileMissing:count('TEST_FILE_MISSING'),
  testRunnerMissing:count('TEST_RUNNER_MISSING'),
  invalidTestReference:count('INVALID_TEST_REFERENCE'),
  testAddressRegistered:count('TEST_DECLARED_RUNNER_REGISTERED'),
  actuallyExecutedInvariantTests:0,
  individuallyLinkedIndependentOracles:0,
  independentlyCertifiedInvariants:0,
  certificationFraction:0,
  readinessFraction:records.length?
   count('TEST_DECLARED_RUNNER_REGISTERED')/records.length:0,
  unknownAuditorDomain:records.filter(r=>!r.auditorDomain).length};
 if(metrics.textOnly+metrics.declaredWithTest!==metrics.declared||
   metrics.testAddressRegistered+metrics.testFileMissing+metrics.testRunnerMissing+
    metrics.invalidTestReference!==metrics.declaredWithTest)
  failure('non-partitioned coverage denominator');
 return {contract:'komerce-invariant-provenance-registry/v35',
  registryHash:sha(hashes.join('\n')),
  source:'features/*.feature.js; owner/test metadata are declarations not proof',
  metrics,features:byFeature,domains:byDomain,cards,invariants:records,
  limitations:{
   testPathNotExecuted:true,testFileExistsNotProofOfAssertion:true,
   domainCalibrationNotInvariantCertification:true,
   featureDomainMappingNotAuthoritative:true,
   otherGovernanceInvariantsOutsideCardsNotCounted:true,
   runtimeOracleMappingRequiresExplicitHumanOrMachineReview:true}};
}
function discover(root=ROOT){
 const dir=path.join(root,'features');
 const entries=fs.readdirSync(dir).filter(f=>f.endsWith('.feature.js')).sort().map(f=>({
  file:'features/'+f,source:fs.readFileSync(path.join(dir,f),'utf8')}));
 const runners=loadRunners(root);
 return build({root,cardEntries:entries,runners});
}
function reportMarkdown(c){
 const m=c.metrics;
 const rows=[
  '# G2 — Registre de provenance des invariants métier','',
  '- Cartes effectivement analysées : '+m.cards,
  '- Invariants déclarés : '+m.declared,
  '- Invariants textuels uniquement : '+m.textOnly,
  '- Invariants déclarant un test : '+m.declaredWithTest,
  '- Références avec fichier ET runner officiel : '+m.testAddressRegistered,
  '- Fichiers test absents : '+m.testFileMissing,
  '- Tests sans runner officiel : '+m.testRunnerMissing,
  '- Tests réellement exécutés dans ce lot : '+m.actuallyExecutedInvariantTests,
  '- Invariants liés à un oracle métier indépendant : '+m.individuallyLinkedIndependentOracles,
  '- Invariants métier certifiés individuellement : '+m.independentlyCertifiedInvariants+'/'+m.declared,
  '- Taux de préparation des références de test (PAS couverture réelle) : '+(100*m.readinessFraction).toFixed(1)+' %',
  '- Empreinte des cartes : '+c.registryHash,
  '','## Répartition par domaine du scanner','',
  '| Domaine | Déclarés | Textuels | Test officiellement adressable | Certifiés individuellement |',
  '|---|---:|---:|---:|---:|',
  ...c.domains.map(d=>'| '+d.domain+' | '+d.total+' | '+d.textOnly+' | '+d.registered+' | '+d.independentOraclesLinked+' |'),
  '','## Défauts de traçabilité / prochaine décision','',
  ...c.features.filter(f=>f.missingTest||f.missingRunner).map(f=>'- '+f.feature+
   ' : '+f.missingTest+' fichiers absents et '+f.missingRunner+' runners absents'),
  '','Une déclaration de test, même portée par un runner Jest/E2E, n’est jamais comptée comme une preuve exécutée dans ce scanner.',
  'Les 12 scénarios physiques V3.4 restent un registre distinct : aucune attribution automatique mensongère à une des règles textuelles.',
  'La couverture G2 concerne ici les Feature Cards ; les invariants de code/DB hors cartes ont un dénominateur distinct à compléter.',''
 ];
 return rows.join('\n');
}
module.exports={discover,build,parseCard,probeTest,reportMarkdown};
