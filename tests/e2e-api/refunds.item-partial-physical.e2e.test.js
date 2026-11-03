'use strict';
/** @test-kind e2e @test-runner jest @test-requires postgres
 * E7: vraies transactions PG16, deux sessions concurrentes, manquant physique,
 * remise partielle, et clôture atomique du ledger financier/qty_refunded. Aucun PSP.
 */
const crypto=require('crypto');
const {describeE2E}=require('../helpers/e2eDbKit');
const {reserveVerifiedShortage}=require('../../services/item-refund-reservation-service');
const {finalizeVerifiedRefund}=require('../../services/item-refund-psp-orchestrator');
const id=()=>crypto.randomUUID();

describeE2E('E7 PG physique : article manquant + reliquat + PSP vérifié',({db})=>{
  const schema='e7_item_'+crypto.randomBytes(7).toString('hex');
  const orderId=id(),marketId=id(),itemId=id(),secondItemId=id(),incidentId=id(),adminId=id();
  let admin,workerA,workerB;
  function adapter(client){
    return {getClient:async()=>({query:client.query.bind(client),release:()=>{}}),
      query:client.query.bind(client)};
  }
  const input=(operationKey,client,quantity=1)=>({
    orderId,orderItemId:itemId,incidentId,quantity,operationKey,
    reason:'Article manquant attesté au relais',actor:{id:adminId,role:'admin'},db:adapter(client)
  });
  beforeAll(async()=>{
    admin=await db.connect();
    try{
      await admin.query('CREATE SCHEMA '+schema);
      // Copies check constraints and indexes from migration 365, without
      // touching business data. These tables are E2E-only in a fresh schema.
      await admin.query('CREATE TABLE '+schema+'.orders (id uuid PRIMARY KEY, market_id uuid NOT NULL,'
        +'payment_status text, payment_mode text, total_kmf numeric(14,2), total_eur numeric(12,2),'
        +'stripe_payment_id text, paypal_capture_id text)');
      await admin.query('CREATE TABLE '+schema+'.order_items (id uuid PRIMARY KEY,order_id uuid,'
        +'quantity int,price_kmf numeric(12,2),qty_collected int DEFAULT 0,qty_refunded int DEFAULT 0,'
        +'CHECK(qty_refunded>=0 AND qty_collected+qty_refunded<=quantity))');
      await admin.query('CREATE TABLE '+schema+'.international_shipment_relay_receipts ('
        +'order_item_id uuid,incident_id uuid,expected_qty int,received_qty int)');
      await admin.query('CREATE TABLE '+schema+'.refund_execution_intents '
        +'(LIKE public.refund_execution_intents INCLUDING ALL)');
      await admin.query('CREATE TABLE '+schema+'.order_item_refund_reservations '
        +'(LIKE public.order_item_refund_reservations INCLUDING ALL)');
      await admin.query('CREATE TABLE '+schema+'.refunds ('
        +'id uuid DEFAULT gen_random_uuid(),order_id uuid,amount_kmf numeric(14,2),'
        +'amount_eur numeric(12,2),refund_type text,refund_method text,stripe_refund_id text,'
        +'reason text,status text,completed_at timestamptz,'
        +'UNIQUE(order_id,refund_type))');
      workerA=await db.connect();workerB=await db.connect();
      for(const c of [admin,workerA,workerB])await c.query('SET search_path TO '+schema+',public');
      const ps=await Promise.all([admin,workerA,workerB].map(async c=>
        (await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid));
      expect(new Set(ps).size).toBe(3);
    }catch(e){
      for(const c of [workerB,workerA,admin])if(c){await c.query('RESET search_path').catch(()=>{});c.release()}
      admin=workerA=workerB=null;
      await db.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE').catch(()=>{});
      throw e;
    }
  });
  beforeEach(async()=>{
    await admin.query('TRUNCATE order_item_refund_reservations,refund_execution_intents,'
      +'international_shipment_relay_receipts,refunds,order_items,orders');
    await admin.query(`INSERT INTO orders(id,market_id,payment_status,payment_mode,total_kmf,total_eur,stripe_payment_id)
      VALUES($1,$2,'paid','stripe_eur',6000,12.00,'pi_test_e7')`,[orderId,marketId]);
    await admin.query('INSERT INTO order_items(id,order_id,quantity,price_kmf,qty_collected,qty_refunded) VALUES'
      +'($1,$3,3,1000,2,0),($2,$3,3,1000,0,0)',[itemId,secondItemId,orderId]);
    await admin.query('INSERT INTO international_shipment_relay_receipts('
      +'order_item_id,incident_id,expected_qty,received_qty) VALUES($1,$2,3,2)',
      [itemId,incidentId]);
  });
  afterAll(async()=>{
    for(const c of [workerB,workerA,admin])if(c){await c.query('RESET search_path').catch(()=>{});c.release()}
    await db.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE').catch(()=>{});
  });
  test('deux agents réservent simultanément le même reliquat : une seule quantité',async()=>{
    const firstKey=id(),secondKey=id();
    const results=await Promise.allSettled([
      reserveVerifiedShortage(input(firstKey,workerA)),
      reserveVerifiedShortage(input(secondKey,workerB))
    ]);
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(x=>x.status==='rejected')[0].reason.code)
      .toBe('ITEM_REFUND_EXCEEDS_VERIFIED_SHORTAGE');
    const count=await admin.query('SELECT COUNT(*)::int AS n,SUM(quantity)::int AS q FROM order_item_refund_reservations');
    expect(count.rows[0]).toEqual({n:1,q:1});
    expect((await admin.query('SELECT COUNT(*)::int AS n FROM refund_execution_intents')).rows[0].n).toBe(1);
  });
  test('double-clic identique : même réservation durable, pas deux captures',async()=>{
    const key=id();
    const [a,b]=await Promise.all([
      reserveVerifiedShortage(input(key,workerA)),
      reserveVerifiedShortage(input(key,workerB))
    ]);
    expect(a.reservationId).toBe(b.reservationId);
    expect([a.replayed,b.replayed].sort()).toEqual([false,true]);
    expect((await admin.query('SELECT COUNT(*)::int AS n FROM refund_execution_intents')).rows[0].n).toBe(1);
  });
  test('reçu PSP : rembourse une unité, conserve les deux remises et l autre article',async()=>{
    const created=await reserveVerifiedShortage(input(id(),admin));
    await admin.query(`UPDATE refund_execution_intents SET status='confirmed',provider_ref='re_e7_ok'
      WHERE id=$1`,[created.intentId]);
    await admin.query(`UPDATE order_item_refund_reservations SET status='processing'
      WHERE id=$1`,[created.reservationId]);
    const result=await finalizeVerifiedRefund({
      reservationId:created.reservationId,providerRef:'re_e7_ok',db:adapter(workerA)
    });
    expect(result).toMatchObject({status:'confirmed',paid:true,replayed:false});
    const rows=await admin.query('SELECT id,qty_collected,qty_refunded FROM order_items ORDER BY id');
    expect(rows.rows.find(x=>x.id===itemId)).toMatchObject({qty_collected:2,qty_refunded:1});
    expect(rows.rows.find(x=>x.id===secondItemId)).toMatchObject({qty_collected:0,qty_refunded:0});
    const refund=await admin.query('SELECT order_id,amount_kmf,amount_eur,refund_type,status FROM refunds');
    expect(refund.rows).toHaveLength(1);
    // La projection PostgreSQL peut renvoyer les colonnes montants en number
    // (integer) ou string (numeric). Vérifier les valeurs sans imposer le
    // format de sérialisation du driver.
    expect(refund.rows[0]).toMatchObject({order_id:orderId,status:'completed'});
    expect(Number(refund.rows[0].amount_kmf)).toBe(1000);
    expect(Number(refund.rows[0].amount_eur)).toBe(2);
    const replay=await finalizeVerifiedRefund({
      reservationId:created.reservationId,providerRef:'re_e7_ok',db:adapter(workerB)
    });
    expect(replay.replayed).toBe(true);
    expect((await admin.query('SELECT qty_refunded FROM order_items WHERE id=$1',[itemId])).rows[0].qty_refunded).toBe(1);
    expect((await admin.query('SELECT COUNT(*)::int AS n FROM refunds')).rows[0].n).toBe(1);
  });
  test('preuve PSP absente : pas de ligne financière ni quantité artificielle',async()=>{
    const created=await reserveVerifiedShortage(input(id(),admin));
    await expect(finalizeVerifiedRefund({
      reservationId:created.reservationId,providerRef:'re_missing',db:adapter(workerA)
    })).rejects.toMatchObject({code:'ITEM_REFUND_NOT_PROVIDER_VERIFIED'});
    expect((await admin.query('SELECT qty_refunded FROM order_items WHERE id=$1',[itemId])).rows[0].qty_refunded).toBe(0);
    expect((await admin.query('SELECT COUNT(*)::int AS n FROM refunds')).rows[0].n).toBe(0);
  });
});
