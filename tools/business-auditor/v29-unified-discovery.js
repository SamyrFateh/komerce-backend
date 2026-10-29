#!/usr/bin/env node
'use strict';
/**
 * V2.9 one-command discovery mode built on V2.8 safe isolated engine.
 * Source ranking derives from actual runtime writer inventory, feature cards,
 * static route/owner graph and seven independent SQL invariants.
 * No generic new test is executed until an oracle+fixture is reviewed.
 */
const fs=require('node:fs'),path=require('node:path');
const v28=require('./v28-unified-engine');
const {assertLocalTestTarget}=require('./cli');
const {physicalProof}=require('./v28-proof-adapters');
const {fromRepo}=require('./v29-metadata-selector');
function humanDigest(r){
 const d=r.sourceDiscovery;
 const lines=[
  '','## V2.9 — découverte des paires depuis le dépôt (statique, sans DB)','',
  '- SHA : '+d.sha+' ; hash de sélection : '+d.selectionHash,
  '- Candidats détectés : '+d.summary.totalWriterPairs+
   ' ; classes d’équivalence : '+d.summary.equivalenceClasses,
  '- Tables à examiner hors paires : '+d.summary.singleWriterOrUnpairedTables,
  '- Nombre de scénarios réellement exécutables : '+d.calibration.selected.length,
  '- Autres candidats : NON EXÉCUTÉS — ADAPTATEUR ET ORACLE À DÉVELOPPER',
  '','### File de revue des paires les plus prioritaires','',
  '| Rang | Table | Domaine | Score heuristique | Statut |','|---:|---|---|---:|---|',
  ...d.pairs.reviewQueue.slice(0,15).map((x,i)=>
   '| '+(i+1)+' | '+x.table+' | '+x.domain+
   ' | '+x.rankScore+' | '+x.physicalStatus+' |'),
  '','### Exécutions retenues et justification','',
  ...d.calibration.selected.map(x=>'- '+x.id+' : '+x.selectionReason+
   ' (preuves source : '+JSON.stringify(x.ownerEvidence)+')'),
  '','### Contrat de prudence','',
  '- Le classement est heuristique : aucun résultat statique ne prouve la route ou le bug.',
  '- Une paire sans adaptateur reste candidate en attente ; jamais exécutée avec un oracle inventé.',
  '- Les nouvelles preuves sont des clones locaux avec les propriétaires canoniques et les oracles existants.',
  '- Six domaines attendent encore des fixtures physiques certifiées.',''
 ];
 return lines.join('\n')+'\n';
}
function validateDiscovery(d,sha){
 if(d?.contract!=='komerce-metadata-driven-selection/v29'||d.sha!==sha||
  !/^[a-f0-9]{64}$/.test(d.selectionHash||'')||
  d.pairs?.equivalenceClasses<1||
  d.pairs?.reviewQueue?.length!==d.pairs.equivalenceClasses||
  d.inventory?.summary?.candidateWrites<1||
  d.rules?.count!==7||
  !Array.isArray(d.calibration?.selected)||d.calibration.selected.length<1||
  d.calibration.selected.length>4||
  !/^[a-f0-9]{64}$/.test(d.calibration.hash||'')||
  d.calibration.selected.some(x=>!x.ownerEvidence)||
  !d.summary.requiresNewAdapterForFullCoverage)
  throw Error('V29_SELECTION_TOOL_ERROR: missing source-derived evidence or false claim of general coverage');
}
async function run(argv=process.argv.slice(2),env=process.env,deps={}){
 const options=v28.parse(argv);
 if(options.help)return {help:true};
 const usesData=['data','full','physical'].includes(options.mode);
 if(usesData)assertLocalTestTarget(env); // reject Railway/production before scan
 const source=await (deps.sourceScan||fromRepo)({
  maxCases:options.maxCases,domains:options.domains});
 const expectedSha=deps.sha||source.sha;
 validateDiscovery(source,expectedSha);
 const v28Deps={...deps,sha:expectedSha,
  freeze:({maxCases,domains})=>{
   if(source.calibration.budget!==maxCases||
      domains.join('|')!==options.domains.join('|'))
    throw Error('V29_SELECTION_TOOL_ERROR: case budget drift');
   return source.calibration;
  },
  physicalScan:deps.physicalScan||((environment,opts)=>
   physicalProof(environment,{...opts,calibratedSelection:source.calibration}))
 };
 const original=await v28.run(options,env,v28Deps);
 if(original.sha!==source.sha)throw Error('V29_SELECTION_TOOL_ERROR: source and physical SHA mismatch');
 if(original.physical&&
  (original.physical.selection.hash!==source.calibration.hash||
   original.physical.cases.map(x=>x.id).join('|')!==
    source.calibration.selected.map(x=>x.id).join('|')))
  throw Error('V29_SELECTION_TOOL_ERROR: selected and executed recipes disagree');
 const merged={
  ...original,contract:'komerce-unified-business-logic-auditor/v29',
  sourceDiscovery:source,selectionSha:source.selectionHash,
  limits:{
   sourceRankingIsHeuristic:true,automaticGenericPhysicalFixtureGeneration:false,
   onlyReviewedCalibrationRecipesExecute:true,
   noProductionRuntimeCertifications:true
  },
  reportDirectory:undefined
 };
 const directory=original.reportDirectory;
 fs.writeFileSync(path.join(directory,'unified-audit.json'),JSON.stringify(merged,null,2)+'\n');
 const originalMarkdown=fs.readFileSync(path.join(directory,'unified-audit.md'),'utf8');
 fs.writeFileSync(path.join(directory,'unified-audit.md'),originalMarkdown+humanDigest(merged));
 const summary={sha:merged.sha,discoveryPairs:source.summary.totalWriterPairs,
  rankClasses:source.summary.equivalenceClasses,
  unpairedTables:source.summary.singleWriterOrUnpairedTables,
  executed:merged.physical?.cases.map(x=>x.id)||[],
  unexecutableHypotheses:source.summary.priorityUnexecutable,
  missingDomains:merged.summary.domainsNotPhysicallyCovered,
  reportDirectory:directory,
  productionFixProven:false};
 console.log('BUSINESS_AUDIT_V29_DISCOVERY '+JSON.stringify(summary));
 return {...merged,reportDirectory:directory};
}
if(require.main===module){
 run().then(r=>{if(r.help)console.log(
  'npm run audit:logic:unified -- [--mode quick|data|physical|full] [--max-cases 1..4] [--domains finance,logistics] [--out DIR] [--base SHA]\n'+
  'V2.9: source-derived writer pair queue + only reviewed calibrated physical fixtures. Default quick has NO DB.'
 )}).catch(e=>{console.error('BUSINESS_AUDIT_V29_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2});
}
module.exports={run,validateDiscovery,humanDigest};
