#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {run:runV34}=require('./v34-delivery-engine');
const {normalize,coverage,toMarkdown}=require('./v35-invariant-census');
const {semanticLedger,markdown:semanticMarkdown}=require('./v40-semantic-ledger');
async function run(argv=process.argv.slice(2),env=process.env,deps={}){
 const base=await (deps.baseRun||runV34)(argv,env,deps.baseDeps||{});
 if(base.help)return base;
 const census=await (deps.census||normalize)();
 if(census.contract!=='komerce-feature-invariant-census/v35'||
  census.summary.declaredInvariants===0||census.summary.featureFiles===0)
  throw Error('G2_TOOL_ERROR: cannot claim feature-card census');
 const matrix=coverage(census,base.physicalCaseIndex);
 const semantic=semanticLedger(census,base.physicalCaseIndex);
 const report={...base,contract:'komerce-unified-business-logic-auditor/v35',
  featureInvariants:{summary:census.summary,sourceCards:census.cards,errors:census.errors},
  invariantCoverage:matrix,
  semanticInvariantLedger:{contract:semantic.contract,byDomain:semantic.byDomain,summary:semantic.summary},
  summary:{...base.summary,featureInvariantsDeclared:census.summary.declaredInvariants,
   featureInvariantsCertified:0,
   invariantCoveragePercent:null,
   physicallyWitnessedDomainLinks:matrix.summary.physicallyVerifiedLinks,
   featureCardSemanticOracleMappingComplete:false},
  limits:{...base.limits,featureInvariantsNotSemanticallyMapped:true},
  reportDirectory:undefined};
 const out=base.reportDirectory;
 fs.writeFileSync(path.join(out,'unified-audit.json'),JSON.stringify(report,null,2)+'\n');
 fs.appendFileSync(path.join(out,'unified-audit.md'),'\n'+toMarkdown(census,matrix));
 fs.writeFileSync(path.join(out,'invariant-census.json'),JSON.stringify(census,null,2)+'\n');
 fs.writeFileSync(path.join(out,'invariant-coverage.json'),JSON.stringify(matrix,null,2)+'\n');
 fs.writeFileSync(path.join(out,'invariant-semantic-ledger.json'),JSON.stringify(semantic,null,2)+'\n');
 fs.writeFileSync(path.join(out,'invariant-semantic-ledger.md'),semanticMarkdown(semantic).join('\n')+'\n');
 console.log('BUSINESS_AUDIT_G2_CENSUS '+JSON.stringify({
  sha:report.sha,declared:census.summary.declaredInvariants,
  parsedCards:census.summary.parsedCards,errors:census.summary.parseErrors,
  featureCardCertified:0,physicalWitnesses:matrix.summary.physicallyVerifiedLinks,
  semanticCoveragePercent:null,reportDirectory:out
 }));
 return {...report,reportDirectory:out};
}
if(require.main===module)run().then(x=>{
 if(x.help)console.log('npm run audit:logic:unified -- --mode quick|data|physical|full');
}).catch(e=>{console.error('G2_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2});
module.exports={run};
