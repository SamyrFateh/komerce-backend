'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration fable-cash-refund-handoff-postgres.test.js
 * @brief Fable #4114 cash: isolated PG real triggers, cross-rail lock, distinct actors,
 * custody ledger nonnegative, signed evidence, atomic refunds/qty, replay and races.
 */
jest.setTimeout(120000);
jest.mock('../../services/documents/refund-receipt', () => ({
  issue: jest.fn(async () => ({reference: 'REM-FABLE-PG-TEST'})),
}));
const crypto=require('crypto'),fs=require('fs'),path=require('path'),db=require('../../db');
const svc=require('../../services/local-cash-refund-handoff');
const uid=()=>crypto.randomUUID();
const describePg=process.env.DATABASE_URL?describe:describe.skip;
describePg('Fable F1 — cash proof, handoff and settlement (real PG)',()=>{
  const schema='fable_cash_'+crypto.randomBytes(7).toString('hex');
  let main,A,B,orderId,itemId,reservationId,marketId,relayId,holderId,adminId,ccId,incidentId;
  const sql=(s,p)=>main.query(s,p);
  const adapter=c=>({getClient:async()=>({query:c.query.bind(c),release:()=>{}})});
  const approve=(client=A,changes={})=>svc.authorizeCashRefund({
    orderId,orderItemId:itemId,reservationId,holderId,
    originalPayerProofRef:'ORIGINAL-RECU-SIGNE-2026',
    identityCheckProofRef:'IDENTITE-CHECK-DOUBLE-ACTEUR',
    actor:{id:adminId,role:'admin'},db:adapter(client),...changes,
  });
  const begin=(authorizationId,client=A,changes={})=>svc.beginCashHandoff({
    orderId,orderItemId:itemId,authorizationId,actor:{id:holderId,role:'agent_relais'},
    db:adapter(client),...changes,
  });
  const confirm=(authorizationId,client=A,changes={})=>svc.confirmCashHandoff({
    orderId,orderItemId:itemId,authorizationId,actor:{id:holderId,role:'agent_relais'},
    signedReceiptRef:'RECU-PAYEUR-SIGNE-001',
    payerSignatureProofRef:'PHOTO-PAYEUR-RECU-001',
    witnessProofRef:'ATTESTATION-TEMOIN-001',
    db:adapter(client),...changes,
  });
  beforeAll(async()=>{
    if(!['localhost','127.0.0.1','::1'].includes(new URL(process.env.DATABASE_URL).hostname))
      throw new Error('FABLE_CASH_TEST_LOCAL_POSTGRES_ONLY');
    main=await db.getClient();
    await main.query('CREATE SCHEMA '+schema);
    await main.query('SET search_path TO '+schema+',public');
    try{
      const create=[
        'CREATE TABLE users(id uuid PRIMARY KEY,role text,relais_id uuid)',
        'CREATE TABLE markets(id uuid PRIMARY KEY,currency text)',
        'CREATE TABLE relais(id uuid PRIMARY KEY,market_id uuid)',
        'CREATE TABLE orders(id uuid PRIMARY KEY,market_id uuid,relais_id uuid,payment_status text)',
        'CREATE TABLE order_items(id uuid PRIMARY KEY,order_id uuid,quantity integer,qty_collected integer DEFAULT 0,qty_refunded integer DEFAULT 0)',
        'CREATE TABLE incidents(id uuid PRIMARY KEY)',
        'CREATE TABLE cash_collections(id uuid PRIMARY KEY,order_id uuid,amount_kmf numeric(14,2),collected_by uuid,relais_id uuid,confirmed_at timestamptz DEFAULT now())',
        'CREATE TABLE cash_deposits(id uuid PRIMARY KEY,agent_id uuid,recipient_user_id uuid,market_id uuid,movement_kind text)',
        'CREATE TABLE cash_custody_receipts(id uuid PRIMARY KEY,deposit_id uuid,kind text,amount_kmf numeric(14,2),created_at timestamptz DEFAULT now(),reverses_id uuid)',
        'CREATE TABLE cash_custody_losses(id uuid PRIMARY KEY,deposit_id uuid,holder_id uuid,market_id uuid,kind text,amount_kmf numeric(14,2),created_at timestamptz DEFAULT now())',
        'CREATE TABLE international_shipment_relay_receipts(order_item_id uuid,incident_id uuid,expected_qty int,received_qty int)',
        'CREATE TABLE refund_execution_intents(id uuid PRIMARY KEY,order_id uuid)',
        'CREATE TABLE order_item_refund_reservations(id uuid PRIMARY KEY,order_id uuid)',
        'CREATE TABLE refunds(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid,amount_kmf numeric(14,2),amount_eur numeric(10,2),refund_type text,refund_method text,stripe_refund_id text,store_credit_id uuid,reason text,initiated_by uuid,status text,completed_at timestamptz,created_at timestamptz DEFAULT now(),UNIQUE(order_id,refund_type))',
      ];
      for(const cmd of create) await main.query(cmd);
      const m416=fs.readFileSync(path.join(__dirname,'../../migrations/416_fable_local_item_refund_reservations.sql'),'utf8');
      await main.query(m416.replace(/public\./g,schema+'.'));
      await main.query("CREATE FUNCTION cash_collection_market(uuid,uuid) RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT market_id FROM relais WHERE id=$1 $f$");
      await main.query("CREATE FUNCTION cash_custody_lock(uuid,uuid) RETURNS void LANGUAGE plpgsql AS $f$ DECLARE k text; BEGIN FOR k IN SELECT DISTINCT x FROM unnest(ARRAY[$1::text,$2::text]) x WHERE x IS NOT NULL ORDER BY x LOOP PERFORM pg_advisory_xact_lock(hashtext('cash_hold:'||k)); END LOOP; END $f$");
      const m417=fs.readFileSync(path.join(__dirname,'../../migrations/417_fable_cash_refund_custody_handoff.sql'),'utf8');
      await main.query(m417.replace(/public\./g,schema+'.'));
      A=await db.getClient(); B=await db.getClient();
      for(const c of [A,B]) await c.query('SET search_path TO '+schema+',public');
      const pids=await Promise.all([main,A,B].map(async c=>(await c.query('SELECT pg_backend_pid() id')).rows[0].id));
      expect(new Set(pids).size).toBe(3);
    }catch(err){
      for(const c of [B,A,main])if(c){await c.query('RESET search_path').catch(()=>{});c.release();}
      main=A=B=null;
      await db.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE').catch(()=>{});
      throw err;
    }
  });
  beforeEach(async()=>{
    await sql('TRUNCATE local_cash_refund_payouts,local_cash_refund_authorizations,local_item_refund_reservations,'+
      'cash_custody_receipts,cash_custody_losses,cash_deposits,cash_collections,order_item_refund_reservations,'+
      'refund_execution_intents,refunds,incidents,order_items,orders,relais,markets,users CASCADE');
    orderId=uid(); itemId=uid(); reservationId=uid();marketId=uid();relayId=uid();
    holderId=uid();adminId=uid();ccId=uid();incidentId=uid();
    await sql("INSERT INTO markets(id,currency) VALUES($1,'KMF')",[marketId]);
    await sql('INSERT INTO relais(id,market_id) VALUES($1,$2)',[relayId,marketId]);
    await sql("INSERT INTO users(id,role,relais_id) VALUES($1,'admin',NULL),($2,'agent_relais',$3)",[adminId,holderId,relayId]);
    await sql("INSERT INTO orders(id,market_id,relais_id,payment_status) VALUES($1,$2,$3,'paid')",[orderId,marketId,relayId]);
    await sql('INSERT INTO order_items(id,order_id,quantity,qty_collected,qty_refunded) VALUES($1,$2,3,1,0)',[itemId,orderId]);
    await sql('INSERT INTO incidents(id) VALUES($1)',[incidentId]);
    await sql('INSERT INTO cash_collections(id,order_id,amount_kmf,collected_by,relais_id) VALUES($1,$2,10000,$3,$4)',[ccId,orderId,holderId,relayId]);
    await sql('INSERT INTO local_item_refund_reservations '+
      '(id,order_id,order_item_id,source_incident_id,market_id,operation_key,payment_mode,'+
      'capture_ref,currency,minor_unit,amount_minor,amount_kmf,quantity,reason,initiated_by) '+
      "VALUES($1,$2,$3,$4,$5,$6,'cash_relais',$7,'KMF',0,2000,2000,2,'Rupture physique attestee et documentee',$8)",
      [reservationId,orderId,itemId,incidentId,marketId,uid(),ccId,adminId]);
  });
  afterAll(async()=>{
    for(const c of [B,A,main]) if(c){await c.query('RESET search_path').catch(()=>{});c.release();}
    await db.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE').catch(()=>{});
  });

  test('approved is not paid, start is not paid, signed handoff pays once and issues document',async()=>{
    const a=await approve();
    expect(a).toMatchObject({status:'approved',paid:false});
    expect((await sql('SELECT COUNT(*)::int n FROM refunds')).rows[0].n).toBe(0);
    const b=await begin(a.authorizationId);
    expect(b).toMatchObject({status:'handoff_pending',paid:false,replayed:false});
    expect((await sql('SELECT COUNT(*)::int n FROM local_cash_refund_payouts')).rows[0].n).toBe(0);
    const done=await confirm(a.authorizationId);
    expect(done).toMatchObject({status:'settled',paid:true,replayed:false,receiptRef:'REM-FABLE-PG-TEST'});
    const got=(await sql('SELECT qty_refunded FROM order_items WHERE id=$1',[itemId])).rows[0];
    expect(got.qty_refunded).toBe(2);
    const refunds=await sql('SELECT status,refund_method,amount_kmf,local_cash_refund_payout_id FROM refunds');
    expect(refunds.rows).toHaveLength(1);
    expect(refunds.rows[0]).toMatchObject({status:'completed',refund_method:'cash'});
    expect(Number(refunds.rows[0].amount_kmf)).toBe(2000);
    expect(refunds.rows[0].local_cash_refund_payout_id).toBe(done.payoutId);
    const custody=(await sql('SELECT SUM(delta_kmf)::numeric AS balance FROM cash_custody_movements WHERE holder_id=$1 AND market_id=$2',[holderId,marketId])).rows[0];
    expect(Number(custody.balance)).toBe(8000);
    const replay=await confirm(a.authorizationId,B);
    expect(replay).toMatchObject({paid:true,replayed:true,refundId:done.refundId});
    expect((await sql('SELECT COUNT(*)::int n FROM local_cash_refund_payouts')).rows[0].n).toBe(1);
    expect((await sql('SELECT COUNT(*)::int n FROM refunds')).rows[0].n).toBe(1);
  });

  test('fail-closed wrong holder / conflicting approval and original payer evidence',async()=>{
    await expect(approve(A,{holderId:adminId})).rejects.toMatchObject({code:'LOCAL_CASH_REFUND_DUAL_ACTOR_REQUIRED'});
    await expect(approve(A,{originalPayerProofRef:'short'})).rejects.toMatchObject({code:'LOCAL_CASH_REFUND_PROOF_REQUIRED'});
    const a=await approve();
    await expect(approve(B,{identityCheckProofRef:'SOMETHING-ELSE-1234'})).rejects.toMatchObject({code:'LOCAL_CASH_REFUND_AUTH_CONFLICT'});
    await expect(begin(a.authorizationId,B,{actor:{id:adminId,role:'admin'}})).rejects.toMatchObject({code:'LOCAL_CASH_REFUND_ACTOR_FORBIDDEN'});
    await begin(a.authorizationId);
    await expect(confirm(a.authorizationId,B,{actor:{id:adminId,role:'agent_relais'}})).rejects.toMatchObject({code:'LOCAL_CASH_REFUND_WRONG_HOLDER'});
  });

  test('insufficient custody refuses the handoff before cash can leave',async()=>{
    await sql('UPDATE cash_collections SET amount_kmf=1000 WHERE id=$1',[ccId]);
    const a=await approve();
    await expect(begin(a.authorizationId)).rejects.toMatchObject({code:'LOCAL_CASH_REFUND_DB_GUARD'});
    expect((await sql('SELECT status FROM local_cash_refund_authorizations')).rows[0].status).toBe('approved');
    expect((await sql('SELECT qty_refunded FROM order_items')).rows[0].qty_refunded).toBe(0);
    expect((await sql('SELECT COUNT(*)::int n FROM refunds')).rows[0].n).toBe(0);
    expect((await sql('SELECT COUNT(*)::int n FROM local_cash_refund_payouts')).rows[0].n).toBe(0);
    await expect(begin(a.authorizationId,B)).rejects.toMatchObject({code:'LOCAL_CASH_REFUND_DB_GUARD'});
  });

  test('pending handoff reserves custody without a ledger outflow and settles at exact balance',async()=>{
    await sql('UPDATE cash_collections SET amount_kmf=2000 WHERE id=$1',[ccId]);
    const a=await approve();
    await begin(a.authorizationId);
    expect(Number((await sql('SELECT SUM(delta_kmf) balance FROM cash_custody_movements')).rows[0].balance)).toBe(2000);
    // Model the existing cash-loss writer: it locks custody then asserts the
    // available balance in the same transaction after inserting the movement.
    await B.query('BEGIN');
    try {
      await B.query('SELECT cash_custody_lock($1,NULL)',[holderId]);
      await B.query("INSERT INTO cash_custody_losses(id,holder_id,market_id,kind,amount_kmf) VALUES($1,$2,$3,'LOSS',1)",
        [uid(),holderId,marketId]);
      await expect(B.query('SELECT cash_custody_assert_nonnegative($1,$2)',[holderId,marketId]))
        .rejects.toThrow(/CASH_CUSTODY_INSUFFICIENT_AVAILABLE_BALANCE/);
    } finally { await B.query('ROLLBACK'); }
    expect(await confirm(a.authorizationId)).toMatchObject({paid:true,status:'settled'});
    expect(Number((await sql('SELECT SUM(delta_kmf) balance FROM cash_custody_movements')).rows[0].balance)).toBe(0);
  });

  test('digital document outage cannot roll back physically paid cash; same POST reissues document',async()=>{
    const receipt=require('../../services/documents/refund-receipt');
    const a=await approve();await begin(a.authorizationId);
    receipt.issue.mockRejectedValueOnce(new Error('document-store temporarily unavailable'));
    const done=await confirm(a.authorizationId);
    expect(done).toMatchObject({paid:true,documentStatus:'pending',receiptRef:null,
      documentError:'REFUND_RECEIPT_RECONCILIATION_REQUIRED'});
    expect((await sql('SELECT COUNT(*)::int n FROM local_cash_refund_payouts')).rows[0].n).toBe(1);
    expect((await sql('SELECT COUNT(*)::int n FROM refunds WHERE status=$1',['completed'])).rows[0].n).toBe(1);
    expect((await sql('SELECT qty_refunded FROM order_items')).rows[0].qty_refunded).toBe(2);
    const replay=await confirm(a.authorizationId,B);
    expect(replay).toMatchObject({paid:true,replayed:true,documentStatus:'issued',refundId:done.refundId});
    expect((await sql('SELECT COUNT(*)::int n FROM local_cash_refund_payouts')).rows[0].n).toBe(1);
  });

  test('two physical PG sessions confirm same payout: one immutable custody outflow',async()=>{
    const a=await approve();await begin(a.authorizationId);
    const [x,y]=await Promise.all([confirm(a.authorizationId,A),confirm(a.authorizationId,B)]);
    expect(x.payoutId).toBe(y.payoutId);
    expect([x.replayed,y.replayed].sort()).toEqual([false,true]);
    expect((await sql('SELECT COUNT(*)::int n FROM local_cash_refund_payouts')).rows[0].n).toBe(1);
    expect(Number((await sql('SELECT SUM(delta_kmf)::numeric AS balance FROM cash_custody_movements WHERE holder_id=$1',[holderId])).rows[0].balance)).toBe(8000);
  });

  test('direct SQL cannot counterfeit completion, mutate payout or use another rail',async()=>{
    const a=await approve();
    await expect(sql("INSERT INTO refunds(order_id,amount_kmf,refund_type,refund_method,status) VALUES($1,2000,'fake','cash','completed')",[orderId])).rejects.toThrow(/REFUND_LOCAL_OBLIGATION_UNRESOLVED/);
    await expect(sql('INSERT INTO local_cash_refund_payouts(authorization_id,reservation_id,order_id,market_id,holder_id,paid_by,amount_kmf,signed_receipt_ref,payer_signature_proof_ref,witness_proof_ref) VALUES($1,$2,$3,$4,$5,$5,2000,$6,$7,$8)',
      [a.authorizationId,reservationId,orderId,marketId,holderId,'RECU-FAUX-0001','SIGNATURE-FAUX-001','WITNESS-FAUX-0001'])).rejects.toThrow(/CASH_REFUND_PAYOUT_INVALID_OR_UNATTESTED/);
    await begin(a.authorizationId);const done=await confirm(a.authorizationId);
    await expect(sql('UPDATE local_cash_refund_payouts SET amount_kmf=1 WHERE id=$1',[done.payoutId])).rejects.toThrow(/CASH_REFUND_PAYOUT_IMMUTABLE/);
    await expect(sql("INSERT INTO refunds(order_id,amount_kmf,refund_type,refund_method,status) VALUES($1,500,'fake2','cash','completed')",[orderId])).rejects.toThrow(/REFUND_LOCAL_OBLIGATION_UNRESOLVED/);
    await expect(sql('INSERT INTO order_item_refund_reservations(id,order_id) VALUES($1,$2)',[uid(),orderId])).rejects.toThrow(/ITEM_REFUND_LOCAL_CROSS_RAIL_UNRESOLVED/);
  });
});
