'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalize}=require('./v35-invariant-census');
const {evaluate,amend}=require('./v41-g2-local-stock-proof');
const sha='a'.repeat(40);
function raw(){
 return {contract:'komerce-local-stock-constraint-raw/v1',
  table:'public.local_stock',constraint:'local_stock_qty_non_negatif',
  constraintDefinition:'CHECK ((qty_physical >= 0))',
  initialQuantity:1,positiveQuantity:2,negativeSqlState:'23514',
  negativeConstraint:'local_stock_qty_non_negatif',
  quantityAfterRejectedWrite:2,rolledBack:true};
}
test('G2 DB-level independent oracle requires positive and negative physical control',()=>{
 assert.equal(evaluate(raw()).verdict,'PASS_WITH_EVIDENCE');
 for(const [k,v] of [['negativeSqlState','00000'],['negativeConstraint','wrong'],
  ['quantityAfterRejectedWrite',-1],['rolledBack',false],
  ['constraintDefinition','CHECK ((qty_physical >= -999))']]){
  const f={...raw(),[k]:v};
  assert.throws(()=>evaluate(f),/G2_EXACT_PROOF_TOOL_ERROR/);
 }
});
test('G2 exact Feature Card statement admitted only with source hashes and probe',()=>{
 const c=normalize(),item=c.all.find(x=>x.source==='features/local-stock.feature.js'&&
  x.statement==='qty_physical ne descend jamais sous zéro');
 assert.ok(item);
 const audit={contract:'komerce-unified-business-logic-auditor/v35',sha,
  invariantCoverage:{featureCardInvariantsCertified:0,summary:{coveragePercent:null}},
  summary:{featureInvariantsDeclared:c.summary.declaredInvariants,
   featureInvariantsCertified:0,invariantCoveragePercent:null},
  semanticInvariantLedger:{summary:{semanticallyVerified:0,notCovered:c.summary.declaredInvariants},
    byDomain:[{domain:item.domain,certified:0,notCovered:c.all.filter(x=>x.domain===item.domain).length}]}};
 const proof={sha,sourceFile:item.source,sourceFileHash:item.sourceHash,
  statementSha:item.sha,cloneDropped:true,raw:raw(),oracle:evaluate(raw())};
 const done=amend(audit,c,proof);
 assert.equal(done.invariantCoverage.featureCardInvariantsCertified,1);
 assert.equal(done.summary.featureInvariantsCertified,1);
 assert.ok(done.summary.invariantCoveragePercent>0);
 assert.equal(done.summary.featureCardSemanticOracleMappingComplete,false);
 assert.equal(done.exactSemanticProofs[0].scope,'DATABASE_CONSTRAINT_ALL_WRITERS_ONLY');
 assert.equal(audit.summary.featureInvariantsCertified,0);
 assert.throws(()=>amend(audit,c,{...proof,sourceFileHash:'fake'}),/G2_EXACT_PROOF_TOOL_ERROR/);
});
