'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path');
const {readLiterals,extractWrites}=require('./writer-sql');
const {archHeader,cardAuthorities,qualify}=require('./writer-ownership');
const {sourceScope,buildWriterInventory}=require('./writer-inventory');
const ROOT=path.resolve(__dirname,'../..');
test('SQL in JS comments is not a writer candidate',()=>{
 const s="// UPDATE orders SET status='bad'\n"+
 "/* INSERT INTO refunds VALUES (1) */\n"+
 "client.query('UPDATE orders SET status = $1 WHERE id=$2')";
 const out=extractWrites(s,'services/example.js');
 assert.deepEqual(out.map(x=>[x.action,x.table]),[['UPDATE','orders']]);
 assert.equal(out[0].binding,'DIRECT_QUERY_ARGUMENT');
 assert.equal(out[0].executed,false);
});
test('detect INSERT/UPDATE/DELETE/CTE writes in real quoted and template SQL',()=>{
 const t=String.fromCharCode(96);
 const src="db.query('DELETE FROM parcel_items WHERE id=$1');\n"+
  "await tx.query("+t+"WITH c AS (SELECT 1) UPDATE orders SET status='paid'"+t+");\n"+
  "await tx.query("+t+"INSERT INTO public.refunds (id) VALUES($1)"+t+");";
 const out=extractWrites(src,'services/example.js');
 assert.deepEqual(out.map(x=>x.table),['parcel_items','orders','refunds']);
 assert.equal(out.every(x=>x.binding==='DIRECT_QUERY_ARGUMENT'),true);
});
test('feature owner ! and technical writer ~ remain different roles',()=>{
 const cards=cardAuthorities([
  {file:'features/logistics.feature.js',source:"module.exports={db:{tables:['parcel_items: RW!','orders: R', 'scans: W~']}};"},
  {file:'features/orders.feature.js',source:"module.exports={db:{tables:['orders: RW!','scans: R']}};"},
 ]);
 assert.deepEqual(cards.authorities.parcel_items.owners,['logistics']);
 assert.deepEqual(cards.authorities.orders.owners,['orders']);
 assert.deepEqual(cards.authorities.scans.owners,[]);
 assert.deepEqual(cards.authorities.scans.technicalWriters,['logistics']);
});
test('headers are declarations not a permission grant or proof of correct writer',()=>{
 const src="/**\n * @komerce-arch\n * @role local-test\n * @domain logistics\n * @db-write parcel_items, parcels\n */\n";
 const hdr=archHeader(src);
 assert.equal(hdr.domain,'logistics');
 assert.deepEqual(hdr.declaredWrites,['parcel_items','parcels']);
 const results=qualify([{file:'services/x.js',table:'parcel_items'}],
  {'services/x.js':hdr},{parcel_items:{owners:['logistics'],writers:['logistics']}});
 assert.equal(results[0].ownerResolution,'OWNER_DOMAIN_MATCH_DECLARATION');
 assert.equal(results[0].headerStatus,'HEADER_MATCH_NOT_AUTHORIZATION');
 assert.equal(results[0].ownerValidated,false);
});
test('cross-domain writer, absent ! and no header never become confirmed bugs',()=>{
 const out=qualify([
  {file:'services/payment.js',table:'parcels'},
  {file:'services/other.js',table:'orders'},
  {file:'services/lost.js',table:null},
 ],{'services/payment.js':{headerPresent:true,domain:'payments',declaredWrites:['parcels']},
    'services/other.js':{headerPresent:true,domain:'orders',declaredWrites:['orders']}},
 {parcels:{owners:['logistics'],writers:['logistics','payments']},
  orders:{owners:[],writers:['orders']}});
 assert.deepEqual(out.map(x=>x.ownerResolution),[
  'CROSS_DOMAIN_WRITE_REVIEW','FEATURE_OWNER_NOT_EXPLICIT','DYNAMIC_TABLE_UNRESOLVED']);
 assert.equal(out.every(x=>x.ownerValidated===false),true);
});
test('non-runtime file scopes are excluded, not mistaken for safe business code',()=>{
 assert.equal(sourceScope('services/auto-parcel.js'),'APPLICATION_CANDIDATE');
 assert.equal(sourceScope('routes/orders.js'),'APPLICATION_CANDIDATE');
 for(const s of ['tests/unit/a.test.js','scripts/seed.js','features/orders.feature.js','tools/business-auditor/cli.js'])
  assert.notEqual(sourceScope(s),'APPLICATION_CANDIDATE');
});
test('true tracked project metadata yields a non-empty cross-domain traceable inventory',()=>{
 const result=buildWriterInventory(ROOT);
 assert.equal(result.contract,'komerce-business-writer-inventory/v1');
 assert.ok(result.coverage.applicationFiles>50,'Expected substantial active source subset');
 assert.ok(result.coverage.featureCardsRead>=20,'Feature Cards need coverage');
 assert.ok(result.summary.candidateWrites>50,'No silent empty SQL result');
 assert.ok(result.tableSummary.some(t=>t.table==='orders'&&t.explicitOwners.length>0));
 assert.ok(result.tableSummary.some(t=>t.table==='parcel_items'));
 assert.ok(result.writes.some(x=>x.file==='services/auto-parcel.js'&&x.table==='parcel_items'));
 assert.equal(result.summary.confirmedBusinessBugs,0);
});
