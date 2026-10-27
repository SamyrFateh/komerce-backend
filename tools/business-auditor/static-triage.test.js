'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {prepareStaticTriage,summarizeTriage}=require('./static-triage');
const {ENTRY,qualifyStaticTriage,triageCounts}=require('./triage-ledger');
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
 assert.equal(Object.keys(ENTRY).length,21); // one PayPal source line appears twice
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
