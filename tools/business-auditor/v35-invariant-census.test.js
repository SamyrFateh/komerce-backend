'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalize,coverage,readCard,VERIFIED_LINKS}=require('./v35-invariant-census');
test('feature-card invariant census is non-empty, stable, and never certifies declarations',()=>{
 const c=normalize();
 assert.ok(c.summary.featureFiles>=25);
 assert.ok(c.summary.declaredInvariants>=100);
 assert.equal(new Set(c.all.map(x=>x.id)).size,c.all.length);
 assert.equal(c.summary.certifiedByDeclaration,0);
 assert.ok(c.all.every(x=>x.status==='DECLARED_UNCALIBRATED'&&x.proof==='NOT_EXECUTED_BY_THIS_SCANNER'));
});
test('source test reference never becomes a verified test assertion',()=>{
 const c=normalize();
 assert.ok(c.summary.associatedTests>0);
 assert.equal(coverage(c,[]).summary.physicallyVerifiedLinks,0);
 assert.equal(coverage(c,[]).featureCardInvariantsCertified,0);
 assert.equal(coverage(c,[]).summary.coveragePercent,null);
});
test('physical witness at domain level still cannot certify a feature-card statement',()=>{
 const c=normalize();
 const index=VERIFIED_LINKS.map((x,i)=>({id:'known-'+i,domain:x.domain,
  verdict:x.status,cloneDropped:true}));
 const r=coverage(c,index);
 assert.equal(r.summary.physicallyVerifiedLinks,VERIFIED_LINKS.length);
 assert.equal(r.featureCardInvariantsCertified,0);
});
test('untrusted feature registry with require is rejected before execution',()=>{
 const x=readCard("module.exports={invariants:[require('fs')]};",'features/test.feature.js');
 assert.equal(x.error,'FEATURE_NOT_SAFE_TO_EVALUATE');
});
test('bad feature path cannot be used to reach outside repo',()=>{
 assert.throws(()=>readCard("module.exports={invariants:[]}",'../../secrets.js'),/G2_UNSAFE_FEATURE_PATH/);
});
