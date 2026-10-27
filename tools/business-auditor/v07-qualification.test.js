'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildQualification,aliases,classify,matches}=require('./v07-qualification');
const cards=[{id:'payments',domain:'payment'},{id:'logistics',domain:'logistics'},
 {id:'orders',domain:'orders'}];
const w=(table,more={})=>({id:'KBA-W-fixture',file:'services/writer.js',line:42,
 table,rawTarget:table,action:'UPDATE',physicalTableDeclared:true,schemaEvidence:'IN_CHECKED_IN_CANONICAL_SCHEMA',
 explicitOwners:['payments'],declaredFeatureWriters:['payments'],declaredTechnicalWriters:[],
 declaredDomain:'payment',binding:'DIRECT_QUERY_ARGUMENT',headerStatus:'HEADER_MATCH_NOT_AUTHORIZATION',
 ownerResolution:'CROSS_DOMAIN_WRITE_REVIEW',...more});
const inv=(writes)=>({contract:'komerce-business-writer-inventory/v1',featureCards:cards,
 writes,summary:{candidateWrites:writes.length,physicalTableCandidates:writes.filter(x=>x.physicalTableDeclared).length,
 notProvenTableCandidates:writes.filter(x=>!x.physicalTableDeclared).length}});
test('Feature Card domain aliases avoid false cross-domain conclusions',()=>{
 const x=classify(w('payments'),aliases(cards));
 assert.equal(x.status,'OWNER_DOMAIN_ALIAS_DECLARED');
 assert.equal(x.authorized,false);assert.equal(x.runtimeWriteProven,false);
});
test('ambiguous domain aliases never count as owner',()=>{
 const map=aliases([...cards,{id:'other-payments',domain:'payment'}]);
 assert.equal(matches('payment',['payments'],map),false);
 assert.equal(classify(w('payments'),map).status,'CROSS_DOMAIN_UNDECLARED');
});
test('technical writer differs from owner and is not authorized',()=>{
 const x=classify(w('parcels',{declaredDomain:'logistics',explicitOwners:['orders'],
  declaredTechnicalWriters:['logistics'],declaredFeatureWriters:['logistics','orders']}),aliases(cards));
 assert.equal(x.status,'TECHNICAL_WRITER_DECLARED');
 assert.equal(x.authorized,false);
});
test('undeclared cross-domain direct query is a high-priority hypothesis',()=>{
 const x=classify(w('orders',{explicitOwners:['orders'],declaredDomain:'payment'}),aliases(cards));
 assert.equal(x.status,'CROSS_DOMAIN_UNDECLARED');assert.equal(x.priority,'HIGH');
 assert.equal(x.confirmedBusinessBug,false);assert.equal(x.verifiedCallPath,false);
});
test('all SQL candidates preserved including unknown targets',()=>{
 const rows=[w('orders',{explicitOwners:['orders'],declaredDomain:'orders'}),
  w('orders',{explicitOwners:['orders'],declaredDomain:'orders',line:73}),
  w('set',{physicalTableDeclared:false,schemaEvidence:'NOT_IN_CHECKED_IN_SCHEMA_REVIEW'}),
  w(null,{physicalTableDeclared:false,rawTarget:'${dynamic}',schemaEvidence:'DYNAMIC_TARGET_UNKNOWN'})];
 const a=buildQualification(inv(rows)),b=buildQualification(inv(rows));
 assert.deepEqual(a,b);assert.equal(a.summary.occurrences,4);assert.equal(a.summary.physical,2);
 assert.equal(a.summary.unresolved,2);assert.equal(a.summary.cases,3);
 assert.equal(a.cases.reduce((n,x)=>n+x.occurrences,0),4);
 assert.equal(a.summary.verifiedCallPaths,0);assert.equal(a.summary.confirmedBugs,0);
});
test('missing writer header and missing feature owner remain review',()=>{
 const x=classify(w('orders',{explicitOwners:[],headerStatus:'MISSING_HEADER',
 ownerResolution:'FEATURE_OWNER_NOT_EXPLICIT'}),aliases(cards));
 assert.equal(x.status,'OWNER_MISSING');assert.equal(x.needsReview,true);
 assert.ok(x.flags.includes('HEADER_MISSING'));
});
test('a non-inventory object fails closed',()=>{
 assert.throws(()=>buildQualification({writes:[]}),/writer-inventory/);
});
