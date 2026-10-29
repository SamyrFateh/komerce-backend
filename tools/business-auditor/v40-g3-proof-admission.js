'use strict';
/**
 * A G3 document is not proof because it contains true booleans. Check the
 * full generated case population, each independent oracle, and held-out
 * source mutation observations against the exact source SHA.
 */
const crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const isHash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function accepts(p,sha){
 if(p?.contract!=='komerce-generated-experiment-proof/v1'||
    p.sha!==sha||!isHash(p.source?.hash)||
    p.source?.service!=='services/inventory-service.js'||
    p.generatedPlan?.contract!=='komerce-generated-inventory-plan/v40'||
    p.generatedPlan.anchorHash!==p.source.hash||
    p.generatedPlan.owner!==p.source.service||
    p.generatedPlan.mutationsVisibleToGenerator!==false||
    !isHash(p.generatedPlan.selectionHash)||
    !Array.isArray(p.generatedPlan.selected)||
    !Array.isArray(p.baseline)||!Array.isArray(p.mutants)||
    p.generatedCases!==p.baseline.length||p.baseline.length<6||
    p.generatedPlan.selected.length!==p.baseline.length||
    p.mutants.length!==2||p.independentOracle!==true||
    p.realOwnerOnClonedPg!==true||p.allClonesDropped!==true||
    p.withheldMutationDetected!==true||
    p.generatorDidNotChooseMutants!==true||
    p.benchmarkKind!=='INTERNAL_WITHHELD_PILOT_NOT_INDEPENDENT_BLIND_G4'||
    p.summary?.healthy!==p.baseline.length||
    p.summary?.detected!==2||p.summary?.missed!==0||
    p.summary?.falsePositives!==0||p.summary?.toolErrors!==0||
    p.summary?.verdict!=='PASS_BOUNDED_INVENTORY')return false;
 const seen=new Set();
 for(let i=0;i<p.baseline.length;i++){
  const x=p.baseline[i],s=p.generatedPlan.selected[i];
  if(JSON.stringify(x?.spec)!==JSON.stringify(s)||
     x.caseHash!==hash(s)||seen.has(x.caseHash)||
     x.sourceMutation!==null||x.cloneDropped!==true||
     x.canonicalPostgres!==true||x.realOwnerCalled!==true||
     x.verdict!=='PASS_WITH_EVIDENCE'||
     x.oracle?.contract!=='komerce-independent-generated-inventory-oracle/v40'||
     x.oracle?.realOwnerExecuted!==true||
     x.oracle?.mutationApplied!==false||
     x.oracle?.violation!==false||
     !Array.isArray(x.oracle?.signals)||x.oracle.signals.length!==0)
   return false;
  seen.add(x.caseHash);
 }
 const expected=['SKIP_COMPLETION','RELAX_FOREIGN_GUARD'];
 for(let i=0;i<2;i++){
  const x=p.mutants[i];
  if(x?.sourceMutation!==expected[i]||!seen.has(x.caseHash)||
     x.cloneDropped!==true||x.canonicalPostgres!==true||
     x.realOwnerCalled!==true||x.verdict!=='BUSINESS_VIOLATION'||
     x.oracle?.contract!=='komerce-independent-generated-inventory-oracle/v40'||
     x.oracle?.realOwnerExecuted!==true||x.oracle?.mutationApplied!==true||
     x.oracle?.violation!==true||
     !Array.isArray(x.oracle?.signals)||x.oracle.signals.length===0||
     x.spec?.relation!==(i===0?'IMPLICIT':'FOREIGN'))return false;
 }
 return true;
}
module.exports={accepts};
