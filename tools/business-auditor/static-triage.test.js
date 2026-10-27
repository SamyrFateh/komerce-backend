'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {prepareStaticTriage,summarizeTriage}=require('./static-triage');
const {ENTRY,gitBlobHash,reviewerSourceState,qualifyStaticTriage,triageCounts}=require('./triage-ledger');
const path=require('node:path');
const samples=[
 ['LS-04','routes/admin/system.js'],['LS-04','routes/parcels.js'],
 ['LS-03','routes/wallet.js'],['LS-04','scripts/research/golden-parcel-maturity-pg.js'],
 ['LS-04','scripts/research/golden-shared-multiorder-handoff-pg.js'],
 ['LS-04','scripts/seed-a8-staging-two-orders.js'],
 ['LS-04','services/auto-parcel.js'],['LS-05','services/auto-parcel.js'],
 ['LS-04','services/parcel-auto-create-service.js'],
 ['LS-05','services/parcel-item-mutation-service.js'],
 ['LS-04','services/parcel-operations.js'],
 ['LS-04','services/parcelOptimizationService.js'],
 ['LS-05','services/parcelOptimizationService.js'],
 ['LS-06','services/payment-paypal.js'],['LS-06','services/payment-paypal.js'],
 ['LS-01','services/payment-service.js'],['LS-03','services/paypal-client.js'],
 ['LS-06','services/refund-service.js'],
 ['LS-04','services/simulator/cleanup.js'],['LS-04','services/simulator/state-advancer.js'],
 ['LS-01','tools/business-auditor/engine.test.js'],
 ['LS-06','utils/refunds.js']
].map(([rule,file],i)=>({rule,file,line:i+1,priority:rule==='LS-06'?'P2':'P1',fingerprint:file+'|'+rule}));
test('the exact 22 observed CI findings are source-reviewed without inventing confirmations',()=>{
 assert.equal(samples.length,22);
 const rows=qualifyStaticTriage(prepareStaticTriage(samples));
 assert.equal(rows.length,22);
 assert.ok(rows.every(x=>x.reviewedFromSource&&x.evidenceReview!=='UNREVIEWED'&&x.confirmedBug===false));
 assert.equal(Object.keys(ENTRY).length,22); // one PayPal source line appears twice
 assert.equal(triageCounts(rows).targetedCandidateCount,13);
});
test('legitimate owner operations are not automatically reported as rule violations',()=>{
 const rows=qualifyStaticTriage(prepareStaticTriage(samples));
 assert.equal(rows.find(x=>x.file==='services/payment-service.js').evidenceReview,'CANONICAL_OWNER_OPERATION');
 assert.equal(rows.find(x=>x.file==='services/parcel-item-mutation-service.js').evidenceReview,'CANONICAL_OWNER_OPERATION');
});
test('scripts, simulators, and scanner test do not get production exposure by default',()=>{
 const rows=qualifyStaticTriage(prepareStaticTriage(samples));
 for(const f of rows.filter(x=>/scripts\/research\/|scripts\/seed-|services\/simulator\/|engine\.test/.test(x.file)))
  assert.ok(['DISPOSABLE_RESEARCH_FIXTURE','ONE_OFF_DATA_SEED','SIMULATOR_WRITER','TEST_SOURCE_FALSE_POSITIVE'].includes(f.evidenceReview));
});
test('new unknown path remains unreviewed and attached to an owner investigation',()=>{
 const rows=qualifyStaticTriage(prepareStaticTriage([...samples,{
  rule:'LS-03',file:'routes/surprise-wallet.js',line:41,priority:'P1',
 }]));
 const last=rows.at(-1);
 assert.equal(last.reviewedFromSource,false);
 assert.equal(last.evidenceReview,'UNREVIEWED');
 assert.equal(last.confirmedBug,false);
 assert.equal(last.owner,'Payments / Idempotency');
});
test('family grouping is actionable and tracks occurrences without declaring bugs',()=>{
 const rows=prepareStaticTriage(samples);
 const grouped=summarizeTriage(rows);
 const paypal=grouped.find(x=>x.rule==='LS-06'&&x.owner==='Payments / PSP');
 assert.equal(paypal.occurrences,4); // payment-paypal twice, refund-service, utils/refunds
 assert.ok(grouped.length>=5);
});

test('reviewed file Git object is verified against real code, not merely its path',()=>{
 const root=path.resolve(__dirname,'../..');
 const source=qualifyStaticTriage(prepareStaticTriage(samples),{root});
 assert.equal(source.length,22);
 assert.equal(source.filter(x=>x.currentReviewValid===true).length,22);
 assert.equal(triageCounts(source).staleOrUnknownReviews,0);
 assert.equal(reviewerSourceState('routes/wallet.js',{root}),'SOURCE_UNCHANGED');
});
test('changed source invalidates manual review without silently erasing original suspicion',()=>{
 const root=path.resolve(__dirname,'../..');
 const source=qualifyStaticTriage(prepareStaticTriage([{
  rule:'LS-03',file:'routes/wallet.js',line:10,priority:'P1',
 }]),{root,readFile:()=>Buffer.from('changed wallet source')});
 assert.equal(source[0].reviewedFromSource,true);
 assert.equal(source[0].currentReviewValid,false);
 assert.equal(source[0].reviewerSourceState,'SOURCE_CHANGED_REVIEW_STALE');
 assert.equal(source[0].confirmedBug,false);
});
test('source path without review baseline is never considered current',()=>{
 const root=path.resolve(__dirname,'../..');
 const r=qualifyStaticTriage(prepareStaticTriage([{
  rule:'LS-03',file:'routes/new-wallet.js',line:12,priority:'P1',
 }]),{root});
 assert.equal(r[0].currentReviewValid,false);
 assert.equal(r[0].reviewerSourceState,'BASELINE_NOT_RECORDED');
});
test('Git blob hashing respects byte lengths and refuses textual similarity',()=>{
 const a=Buffer.from('hello\n'),b=Buffer.from('hello');
 assert.notEqual(gitBlobHash(a),gitBlobHash(b));
 assert.match(gitBlobHash(a),/^[a-f0-9]{40}$/);
});
