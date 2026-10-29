'use strict';
/**
 * G2: domain-level witness != semantic proof of a Feature Card invariant.
 * Every declared statement is accounted for, including duplicate declarations,
 * missing test references and unmapped domains. Pure; no app imports/DB.
 */
const crypto=require('node:crypto');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const norm=s=>String(s).normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();

function semanticLedger(census,physicalCaseIndex=[]){
 if(census?.contract!=='komerce-feature-invariant-census/v35'||
    !Array.isArray(census.all)||!Array.isArray(physicalCaseIndex))
  throw Error('G2_SEMANTIC_TOOL_ERROR: feature census/physical cases required');
 const ids=new Set(),groups=new Map(),rows=[];
 for(const entry of census.all){
  if(!entry.id||ids.has(entry.id)||!/^[a-f0-9]{64}$/.test(entry.sha||'')||
     !entry.source||typeof entry.statement!=='string')
   throw Error('G2_SEMANTIC_TOOL_ERROR: duplicate or corrupted Feature Card record');
  ids.add(entry.id);
  const key=sha(entry.domain+'\0'+norm(entry.statement));
  const primary=groups.get(key);
  if(!primary)groups.set(key,entry.id);
  const witnesses=physicalCaseIndex.filter(x=>x.domain===entry.domain&&
   x.cloneDropped===true&&x.independentOracle===true);
  rows.push({id:entry.id,source:entry.source,sourceHash:entry.sourceHash,
   statementHash:entry.sha,domain:entry.domain,
   duplicateOf:primary||null,semanticKey:key,
   associatedTest:entry.associatedTest,
   testReferenceExists:entry.associatedTestExists===true,
   evidenceReferenceStatus:entry.associatedTestExists===true?
    'REFERENCE_ONLY_NOT_EXECUTED':'NO_EXECUTED_TEST_EVIDENCE',
   domainWitnessIds:witnesses.map(x=>x.id),
   semanticOracleId:null,exactAssertionVerified:false,
   verdict:'NOT_COVERED',
   reason:witnesses.length?'DOMAIN_WITNESS_NOT_SEMANTIC_EQUIVALENCE':
    'NO_INDEPENDENT_PHYSICAL_ORACLE_FOR_STATEMENT'});
 }
 const n=rows.length,unmapped=rows.filter(x=>x.domain==='unmapped').length,
  duplicateDeclarations=rows.filter(x=>x.duplicateOf!==null).length;
 const byDomain=Object.entries(Object.groupBy?
   Object.groupBy(rows,x=>x.domain):
   rows.reduce((a,x)=>{(a[x.domain]||=[]).push(x);return a;},{}))
  .map(([domain,members])=>({domain,declared:members.length,
   unique:members.filter(x=>!x.duplicateOf).length,
   referencedTests:members.filter(x=>x.testReferenceExists).length,
   withDomainWitness:members.filter(x=>x.domainWitnessIds.length>0).length,
   certified:0,notCovered:members.length})).sort((a,b)=>a.domain.localeCompare(b.domain));
 if(n!==census.summary.declaredInvariants||n!==byDomain.reduce((s,x)=>s+x.declared,0))
  throw Error('G2_SEMANTIC_TOOL_ERROR: unaccounted Feature Card declarations');
 return {contract:'komerce-semantic-invariant-ledger/v40',
  source:'SOURCE_CARDS_UNEXECUTED_TEST_REFERENCES_AND_DOMAIN_ONLY_WITNESSES',
  rows,byDomain,
  summary:{declared:n,uniqueStatements:n-duplicateDeclarations,
   duplicateDeclarations,unmapped,missingTestReferences:rows.filter(x=>!x.testReferenceExists).length,
   domainWitnessedDeclarations:rows.filter(x=>x.domainWitnessIds.length>0).length,
   semanticallyVerified:0,notCovered:n,eligibleDenominator:n,
   coveragePercent:n?0:null,physicalCasesSupplied:physicalCaseIndex.length,
   gate:'NO_GO',mustNotPromoteDomainWitnessToCertified:true}};
}
function markdown(x){
 return ['# G2 — typologie des invariants déclarés','',
  '- Déclarations : '+x.summary.declared,
  '- Énoncés uniques par domaine : '+x.summary.uniqueStatements,
  '- Doublons : '+x.summary.duplicateDeclarations,
  '- Références de tests absentes ou non exécutées : '+x.summary.missingTestReferences,
  '- Invariants prouvés sémantiquement : **0**',
  '- Dénominateur : '+x.summary.eligibleDenominator,
  '- Couverture : **'+x.summary.coveragePercent+' %**',
  '- Verdict G2 : **NO_GO**','','| Domaine | Déclarés | Uniques | Témoins du domaine | Certifiés |',
  '|---|---:|---:|---:|---:|',
  ...x.byDomain.map(d=>'| '+d.domain+' | '+d.declared+' | '+d.unique+' | '+
    d.withDomainWitness+' | '+d.certified+' |'),
  '','Une référence à un test ou un témoin du domaine ne certifie jamais un énoncé.',
  'Une certification exige un lien exact à un oracle exécuté, son résultat et son empreinte de source.',
  ''];
}
module.exports={semanticLedger,markdown,norm};
