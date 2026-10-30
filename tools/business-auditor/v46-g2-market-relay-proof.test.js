'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalize}=require('./v35-invariant-census');
const {semanticLedger}=require('./v40-semantic-ledger');
const {evaluate:evaluateStock}=require('./v41-g2-local-stock-proof');
const {STATEMENTS,RULES,evaluate,amend}=require('./v46-g2-market-relay-proof');
const sha='a'.repeat(40);
function sample(){
 return {contract:'komerce-market-relay-physical-raw/v46',rolledBack:true,
  joinResolved:true,rules:RULES.map(r=>({...r,notNull:true,
   foreignKeyDefinition:'FOREIGN KEY ('+r.column+') REFERENCES '+r.references+'('+r.refColumn+')',
   negativeSqlState:'23502',negativeColumn:r.column,
   unchangedAfterRejectedWrite:true,validWriteObserved:true}))};
}
function prior(){
 const census=normalize(),ledger=semanticLedger(census,[]);
 const stockItem=census.all.find(x=>x.source==='features/local-stock.feature.js'&&
  x.statement==='qty_physical ne descend jamais sous zéro');
 const row=ledger.rows.find(x=>x.id===stockItem.id);
 row.verdict='CERTIFIED_DB_CONSTRAINT';row.exactAssertionVerified=true;
 ledger.summary.semanticallyVerified=1;ledger.summary.notCovered=census.all.length-1;
 const domain=ledger.byDomain.find(x=>x.domain===stockItem.domain);
 domain.certified++;domain.notCovered--;
 const audit={contract:'komerce-unified-business-logic-auditor/v35',sha,
  summary:{featureInvariantsDeclared:census.all.length,featureInvariantsCertified:1},
  semanticInvariantLedger:{summary:{semanticallyVerified:1,notCovered:census.all.length-1},
   byDomain:structuredClone(ledger.byDomain)},
  invariantCoverage:{featureCardInvariantsCertified:1,summary:{coveragePercent:0}},
  exactSemanticProofs:[{invariantId:stockItem.id}]};
 const raw={contract:'komerce-local-stock-constraint-raw/v1',
  table:'public.local_stock',constraint:'local_stock_qty_non_negatif',
  constraintDefinition:'CHECK ((qty_physical >= 0))',
  initialQuantity:1,positiveQuantity:2,negativeSqlState:'23514',
  negativeConstraint:'local_stock_qty_non_negatif',
  quantityAfterRejectedWrite:2,rolledBack:true};
 const stockProof={sha,invariantId:stockItem.id,sourceFileHash:stockItem.sourceHash,
  statementSha:stockItem.sha,raw,oracle:evaluateStock(raw)};
 const matches=STATEMENTS.map(statement=>{
  const item=census.all.find(x=>x.source==='features/market.feature.js'&&x.statement===statement);
  assert.ok(item,'Exact literal Feature Card statement must be found: '+statement);
  return {invariantId:item.id,statementHash:item.sha,sourceHash:item.sourceHash};
 });
 const proof={sha,cloneDropped:true,matches,oracle:evaluate(sample())};
 return {census,ledger,audit,stockProof,proof};
}
test('G2 NOT NULL proof requires actual FK, SQLSTATE, unchanged valid row and rollback',()=>{
 assert.equal(evaluate(sample()).verdict,'PASS_WITH_EVIDENCE');
 const edits=[
  x=>{x.rolledBack=false;},
  x=>{x.joinResolved=false;},
  x=>{x.rules[0].notNull=false;},
  x=>{x.rules[1].foreignKeyDefinition='FOREIGN KEY (relais_id) REFERENCES strangers(id)';},
  x=>{x.rules[0].negativeSqlState='00000';},
  x=>{x.rules[1].negativeColumn='market_id';},
  x=>{x.rules[0].unchangedAfterRejectedWrite=false;},
  x=>{x.rules[0].validWriteObserved=false;}
 ];
 for(const edit of edits){
  const x=sample();edit(x);
  assert.throws(()=>evaluate(x),/G2_RELAY_PROOF_ERROR/);
 }
});
test('G2 links exactly two market statements with hashes, preserves prior stock proof and incomplete G2',()=>{
 const {census,ledger,audit,stockProof,proof}=prior();
 const x=amend(audit,ledger,census,proof,stockProof);
 assert.equal(x.audit.summary.featureInvariantsCertified,3);
 assert.equal(x.ledger.summary.semanticallyVerified,3);
 assert.equal(x.ledger.summary.notCovered,census.all.length-3);
 assert.equal(x.ledger.rows.filter(r=>r.exactAssertionVerified).length,3);
 assert.equal(x.audit.summary.featureCardSemanticOracleMappingComplete,false);
 assert.equal(x.audit.exactSemanticProofs.length,3);
 assert.equal(audit.summary.featureInvariantsCertified,1);
 const fake={...proof,matches:structuredClone(proof.matches)};
 fake.matches[0].statementHash='wrong';
 assert.throws(()=>amend(audit,ledger,census,fake,stockProof),/G2_RELAY_PROOF_ERROR/);
 const spoof={...stockProof,sourceFileHash:'fake'};
 assert.throws(()=>amend(audit,ledger,census,proof,spoof),/G2_RELAY_PROOF_ERROR/);
 const repeated={...audit,summary:{...audit.summary,featureInvariantsCertified:3}};
 assert.throws(()=>amend(repeated,ledger,census,proof,stockProof),/G2_RELAY_PROOF_ERROR/);
});
