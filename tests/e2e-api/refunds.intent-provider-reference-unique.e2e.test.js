'use strict';
/** @test-kind e2e @test-runner jest @test-requires postgres */
const { describeE2E } = require('../helpers/e2eDbKit');
const O1='22222222-3333-4444-8555-666666666666';
const O2='22222222-3333-4444-8555-666666666667';
const M='33333333-4444-4555-8666-777777777777';
describeE2E('RC-9: même remboursement PSP jamais réutilisé sur une autre intention',({db})=>{
 let client;
 beforeAll(async()=>{
   client=await db.connect();
   await client.query('CREATE TEMP TABLE refund_execution_intents (LIKE public.refund_execution_intents INCLUDING ALL)');
 });
 beforeEach(async()=>client.query('TRUNCATE refund_execution_intents'));
 afterAll(async()=>{
   if(!client)return;
   await client.query('DROP TABLE IF EXISTS pg_temp.refund_execution_intents').catch(()=>{});
   client.release();
 });
 async function confirmed(orderId,operationKey,provider,providerRef){
   return client.query(
     "INSERT INTO refund_execution_intents (order_id,market_id,provider,capture_ref,operation_key,amount_eur,status,provider_ref) VALUES ($1,$2,$3,'capture_mock',$4,10.00,'confirmed',$5)",
     [orderId,M,provider,operationKey,providerRef]
   );
 }
 test('Stripe re_mock même ref et deuxième event : conflit SQL 23505',async()=>{
   await confirmed(O1,'evt:1','stripe','re_mock');
   await expect(confirmed(O2,'evt:2','stripe','re_mock'))
     .rejects.toMatchObject({code:'23505'});
   expect((await client.query('SELECT COUNT(*)::int AS n FROM refund_execution_intents')).rows[0].n).toBe(1);
 });
 test('PayPal RF_mock même ref et deuxième event : conflit SQL 23505',async()=>{
   await confirmed(O1,'evt:1','paypal','RF_mock');
   await expect(confirmed(O2,'evt:2','paypal','RF_mock'))
     .rejects.toMatchObject({code:'23505'});
 });
 test('références distinctes permettent des remboursements partiels légitimes',async()=>{
   await confirmed(O1,'evt:1','stripe','re_part1');
   await confirmed(O1,'evt:2','stripe','re_part2');
   expect((await client.query('SELECT COUNT(*)::int AS n FROM refund_execution_intents')).rows[0].n).toBe(2);
 });
 test('un même libellé chez deux PSP n est pas un même remboursement',async()=>{
   await confirmed(O1,'evt:1','stripe','ref_same');
   await confirmed(O2,'evt:2','paypal','ref_same');
   expect((await client.query('SELECT COUNT(*)::int AS n FROM refund_execution_intents')).rows[0].n).toBe(2);
 });
});
