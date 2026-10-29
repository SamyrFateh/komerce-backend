#!/usr/bin/env node
'use strict';
/**
 * G2 attaches the Feature Card provenance and measured denominator to the
 * already flat V3.4 engine. It never turns a declared test into a PASS.
 */
const fs=require('node:fs'),path=require('node:path');
const v34=require('./v34-delivery-engine');
const {discover,reportMarkdown}=require('./v35-invariant-coverage');
function failure(s){throw Error('V35_COVERAGE_TOOL_ERROR: '+s)}
async function run(argv=process.argv.slice(2),env=process.env,deps={}){
 // Establish a source-grounded registry before any physical database work.
 const catalog=await (deps.catalog||discover)();
 if(catalog?.contract!=='komerce-invariant-provenance-registry/v35'||
  !/^[a-f0-9]{64}$/.test(catalog.registryHash||'')||
  catalog.metrics.declared<1||
  catalog.metrics.declared!==catalog.invariants.length||
  catalog.metrics.independentlyCertifiedInvariants!==0||
  catalog.metrics.actuallyExecutedInvariantTests!==0)
  failure('bad registry/provenance or undeclared proof');
 const b=await (deps.previous||v34.run)(argv,env,deps.previousDeps||{});
 if(b.help)return b;
 if(b.contract!=='komerce-unified-business-logic-auditor/v34'||
  !Array.isArray(b.coverage)||b.coverage.length!==8||
  !b.reportDirectory)failure('V3.4 baseline and report missing');
 const dir=b.reportDirectory;
 const domainCases=Object.fromEntries(b.coverage.map(c=>[c.domain,c.physicalCaseIds||[]]));
 const domains=catalog.domains.map(x=>({...x,
  partialDomainWitnesses:domainCases[x.domain]||[],
  individualInvariantAttribution:'NONE_ESTABLISHED'}));
 const coverage={...catalog,domains,scanSha:b.sha,
  physicalEvidencePresent:Boolean(b.physical),
  knownPhysicalCaseCount:b.physicalCaseIndex.length,
  observedIndependentOracleCoverage:0,
  allBusinessInvariantsCertified:false};
 const combined={...b,contract:'komerce-unified-business-logic-auditor/v35',
  invariantCoverage:{contract:coverage.contract,registryHash:coverage.registryHash,
   metrics:coverage.metrics,limitations:coverage.limitations,
   artifact:'invariant-coverage.json'},
  summary:{...b.summary,
   declaredFeatureInvariants:coverage.metrics.declared,
   textualFeatureInvariants:coverage.metrics.textOnly,
   testReferencedFeatureInvariants:coverage.metrics.declaredWithTest,
   testsWithRegisteredRunner:coverage.metrics.testAddressRegistered,
   individuallyCertifiedFeatureInvariants:0,
   invariantCertificationFraction:0,
   actualInvariantCoverageRatio:0,
   noClaimOfExecutedTestsFromFeatureDeclarations:true},
  limits:{...b.limits,featureCardCoverageIsDeclarationInventoryNotExecution:true,
   allNonFeatureInvariantsNotYetMapped:true},
  allBusinessDomainsCertified:false,productionFixProven:false,
  reportDirectory:undefined};
 fs.writeFileSync(path.join(dir,'invariant-coverage.json'),JSON.stringify(coverage,null,2)+'\n');
 fs.writeFileSync(path.join(dir,'invariant-coverage.md'),reportMarkdown(coverage)+'\n');
 fs.writeFileSync(path.join(dir,'unified-audit.json'),JSON.stringify(combined,null,2)+'\n');
 fs.appendFileSync(path.join(dir,'unified-audit.md'),[
  '','## G2 — Invariants déclarés (jamais assimilés à un test exécuté)','',
  '- Déclarés : '+coverage.metrics.declared,
  '- Textuels sans test : '+coverage.metrics.textOnly,
  '- Test référencé et runner identifié : '+coverage.metrics.testAddressRegistered,
  '- Invariants individuellement certifiés par ce scanner : 0 (aucun mapping établi)',
  '- Registre source-hash : '+coverage.registryHash,
  '- Détail : invariant-coverage.json / invariant-coverage.md',''
 ].join('\n'));
 console.log('BUSINESS_AUDIT_V35_COVERAGE '+JSON.stringify({
  sha:combined.sha,cards:coverage.metrics.cards,
  declared:coverage.metrics.declared,textOnly:coverage.metrics.textOnly,
  runnerRegistered:coverage.metrics.testAddressRegistered,
  individuallyCertified:0,physicalCases:b.physicalCaseIndex.length,
  registryHash:coverage.registryHash,reportDirectory:dir}));
 return {...combined,reportDirectory:dir};
}
if(require.main===module)run().then(r=>{
 if(r.help)console.log('npm run audit:logic:unified -- --mode quick|data|physical|full');
}).catch(e=>{console.error('BUSINESS_AUDIT_V35_COVERAGE_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2});
module.exports={run};
