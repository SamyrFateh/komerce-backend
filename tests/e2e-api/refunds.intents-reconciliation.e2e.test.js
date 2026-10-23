'use strict';
/** @test-kind e2e @test-runner jest @test-requires postgres */
const { describeE2E } = require('../helpers/e2eDbKit');
const { reconcileRefundIntent } = require('../../services/refund-intent-reconciliation');
const ORDER='22222222-3333-4444-8555-666666666666';
const MARKET='33333333-4444-4555-8666-777777777777';
const INTENT='11111111-2222-4333-8444-555555555555';
describeE2E('RC-5/RC-9 reconciliation durable SQL seul',({db})=>{
 let client,isolated;
 beforeAll(async()=>{
  client=await db.connect();
  isolated={query:client.query.bind(client),connect:async()=>({
    query:client.query.bind(client), release:()=>{} })};
  await client.query('CREATE TEMP TABLE orders (id uuid PRIMARY KEY, market_id uuid)');
  await client.query('CREATE TEMP TABLE refund_execution_intents (LIKE public.refund_execution_intents INCLUDING ALL)');
 });
 beforeEach(async()=>{
  await client.query('TRUNCATE refund_execution_intents, orders');
  await client.query('INSERT INTO orders (id,market_id) VALUES ($1,$2)',[ORDER,MARKET]);
  await client.query("INSERT INTO refund_execution_intents (id,order_id,market_id,provider,capture_ref,operation_key,amount_eur,status) VALUES ($1,$2,$3,'stripe','pi_mock','test:op',20.00,'processing')",[INTENT,ORDER,MARKET]);
 });
 afterAll(async()=>{
  if(!client)return;
  await client.query('DROP TABLE IF EXISTS pg_temp.refund_execution_intents').catch(()=>{});
  await client.query('DROP TABLE IF EXISTS pg_temp.orders').catch(()=>{});
  client.release();
 });
 const args=()=>({intentId:INTENT,providerRefundId:'re_mock',db:isolated,
   stripe:{refunds:{retrieve:jest.fn().mockResolvedValue({
    id:'re_mock',payment_intent:'pi_mock',amount:2000,currency:'eur',status:'succeeded'})}}});
 test('confirmé avec preuve PSP: SQL persistant, rejeu sans 2e update',async()=>{
  const a=args();
  expect((await reconcileRefundIntent(a)).status).toBe('confirmed');
  const q=await client.query('SELECT status,provider_ref,confirmed_at FROM refund_execution_intents WHERE id=$1',[INTENT]);
  expect(q.rows[0]).toMatchObject({status:'confirmed',provider_ref:'re_mock'});
  expect(q.rows[0].confirmed_at).toBeTruthy();
  expect((await reconcileRefundIntent(a)).replayed).toBe(true);
  expect(a.stripe.refunds.retrieve).toHaveBeenCalledTimes(1);
 });
 test('timeout PSP ne confirme jamais, la ligne reste UNKNOWN',async()=>{
  const a=args();a.stripe.refunds.retrieve.mockRejectedValue(Error('timeout'));
  expect((await reconcileRefundIntent(a)).status).toBe('unknown');
  const q=await client.query('SELECT status FROM refund_execution_intents WHERE id=$1',[INTENT]);
  expect(q.rows[0].status).toBe('unknown');
 });
 test('marché changé bloque toute confirmation, rollback',async()=>{
  await client.query('UPDATE orders SET market_id=$1 WHERE id=$2',
    ['44444444-4444-4444-8444-444444444444',ORDER]);
  await expect(reconcileRefundIntent(args())).rejects.toMatchObject({code:'REFUND_MARKET_MISMATCH'});
  const q=await client.query('SELECT status FROM refund_execution_intents WHERE id=$1',[INTENT]);
  expect(q.rows[0].status).toBe('processing');
 });
 test('la preuve partielle ne modifie ni refunds ni statut de commande',async()=>{
  expect((await reconcileRefundIntent(args())).status).toBe('confirmed');
  const q=await client.query('SELECT status,amount_eur FROM refund_execution_intents WHERE id=$1',[INTENT]);
  expect(q.rows[0].status).toBe('confirmed');
  expect(q.rows[0].amount_eur).toBe('20.00');
 });
});
