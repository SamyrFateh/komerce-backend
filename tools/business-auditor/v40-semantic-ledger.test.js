'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalize}=require('./v35-invariant-census');
const {semanticLedger,norm}=require('./v40-semantic-ledger');
test('G2 all source declarations accounted for, with explicit denominator',()=>{
 const census=normalize(),r=semanticLedger(census);
 assert.equal(r.summary.declared,census.summary.declaredInvariants);
 assert.equal(r.summary.notCovered,r.summary.declared);
 assert.equal(r.summary.eligibleDenominator,r.summary.declared);
 assert.equal(r.summary.coveragePercent,0);
 assert.equal(r.summary.semanticallyVerified,0);
 assert.equal(r.summary.gate,'NO_GO');
 assert.equal(r.byDomain.reduce((a,x)=>a+x.declared,0),r.rows.length);
});
test('G2 a physical domain witness is not equivalent to semantic proof',()=>{
 const c=normalize(),x=c.all.find(x=>x.domain==='inventory');
 assert.ok(x);
 const r=semanticLedger(c,[{id:'INV-RECEIVE-FOREIGN_ORDER',
  domain:'inventory',verdict:'PASS_WITH_EVIDENCE',
  cloneDropped:true,independentOracle:true}]);
 const s=r.rows.find(row=>row.id===x.id);
 assert.ok(s.domainWitnessIds.includes('INV-RECEIVE-FOREIGN_ORDER'));
 assert.equal(s.verdict,'NOT_COVERED');
 assert.equal(s.exactAssertionVerified,false);
 assert.equal(r.summary.semanticallyVerified,0);
});
test('G2 forgery cannot introduce duplicate Feature Card identity',()=>{
 const c=normalize();c.all.push({...c.all[0]});c.summary.declaredInvariants++;
 assert.throws(()=>semanticLedger(c),/duplicate or corrupted/);
});
test('G2 canonical dedupe does not erase a declaration',()=>{
 const c=normalize();const a=c.all[0];
 c.all.push({...a,id:'FC-duplicate-statement',index:999,
  statement:'  '+a.statement.toUpperCase()+'  '});
 c.summary.declaredInvariants++;
 const r=semanticLedger(c);
 assert.equal(r.rows.length,c.all.length);
 assert.ok(r.rows.at(-1).duplicateOf);
 assert.equal(norm('A   B'),norm('a b'));
});
test('G2 absent or untrusted evidence cannot certify a declaration',()=>{
 const c=normalize();
 const r=semanticLedger(c,[{id:'fake',domain:'sourcing',
  verdict:'PASS_WITH_EVIDENCE',cloneDropped:false,independentOracle:true}]);
 assert.equal(r.summary.semanticallyVerified,0);
 assert.ok(r.rows.every(x=>x.verdict==='NOT_COVERED'));
});
