'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration relay-return-intake-postgres.test.js
 * @brief SAV V1-2 — preuves physiques : DB guard, immutabilité, isolation, zone non exclusive.
 */
jest.setTimeout(60000);
if (!process.env.DATABASE_URL) {
  describe.skip('relay-return-intake PostgreSQL (DATABASE_URL required)',()=>{
    test('skipped',()=>{});
  });
} else {
  const {randomUUID,randomBytes}=require('crypto');
  const db=require('../../db');
  const intake=require('../../services/relay-product-return-intake-service');
  const uid=()=>randomUUID();
  const tag='RETINT-'+randomBytes(6).toString('hex').toUpperCase();
  const ids={orders:[],items:[],products:[],disputes:[],receipts:[],refunds:[],relais:[],users:[]};
  let client,market,admin,relayA,relayB,reqA,reqB,prodA,agentA,agentB;
  const sql=(stmt,params)=>client.query(stmt,params);
  const receive=(requestId,actor=agentA,zone='A')=>intake.recordIntake({
    actor,requestId,condition:'opened',zone,observation:'Carton présenté au relais, constat physique signé.',db
  });

  async function privilegedFixture(fn){
    await sql("SET session_replication_role='replica'");
    try{await fn();}finally{await sql("SET session_replication_role='origin'");}
  }
  async function makeCase(label,relay,source=null){
    const order=uid(),item=uid(),product=uid(),request=uid();
    ids.orders.push(order);ids.items.push(item);ids.products.push(product);ids.disputes.push(request);
    await sql(`INSERT INTO products(id,name,price_kmf,cost_kmf,volume_cm3,stock,price_aed,inventory_model)
               VALUES($1,$2,10000,3000,1000,0,100,'SKU')`,
      [product,'Test return '+tag+' '+label]);
    await sql(`INSERT INTO orders
      (id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur)
      VALUES($1,$2,$3,$4,$5,'collected','paid','cash_relais',10000,20)`,
      [order,admin,relay,market,tag+'-'+label]);
    await privilegedFixture(async()=>{
      await sql(`INSERT INTO order_items(id,order_id,product_id,quantity,qty_collected,price_kmf,fulfillment_source)
                 VALUES($1,$2,$3,1,1,10000,$4)`,[item,order,product,source]);
    });
    await sql(`INSERT INTO disputes
      (id,order_id,type,status,description,return_order_item_id,return_quantity,return_reason,created_by)
      VALUES($1,$2,'product_return','open','Produit à examiner',$3,1,'defective',$4)`,
      [request,order,item,admin]);
    return {request,order,item,product};
  }

  beforeAll(async()=>{
    client=await db.getClient();
    market=(await sql("SELECT id FROM markets WHERE code='KM' LIMIT 1")).rows[0].id;
    admin=uid();ids.users.push(admin);
    await sql("INSERT INTO users(id,full_name,email,phone,role) VALUES($1,$2,$3,$4,'admin')",
      [admin,'SAV test '+tag,tag.toLowerCase()+'@komerce.test','+2693'+String(Date.now()).slice(-7)]);
    relayA=uid();relayB=uid();ids.relais.push(relayA,relayB);
    await sql("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'A','+2693000011','RETOUR',$3)",
      [relayA,tag+'-RA',market]);
    await sql("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'B','+2693000012','RETOUR',$3)",
      [relayB,tag+'-RB',market]);
    const createRelayAgent=async(relay,label)=>{
      const id=uid();
      ids.users.push(id);
      await sql(`INSERT INTO users(id,full_name,email,phone,role,relais_id)
        VALUES($1,$2,$3,$4,'agent_relais',$5)`,
        [id,'Agent SAV '+label,tag.toLowerCase()+'-'+label+'@komerce.test',
          '+2693'+String(BigInt('0x'+randomBytes(4).toString('hex')) % 10000000n).padStart(7,'0'),relay]);
      return {id,role:'agent_relais',relais_id:relay};
    };
    agentA=await createRelayAgent(relayA,'a');
    agentB=await createRelayAgent(relayB,'b');
    const a=await makeCase('A',relayA);
    const b=await makeCase('B',relayA);
    reqA=a.request;reqB=b.request;prodA=a.product;
  });
  afterAll(async()=>{
    if(!client)return;
    try{
      await privilegedFixture(async()=>{
        const deletion=[
          ['transaction_documents','subject_id',ids.refunds],
          ['refunds','id',ids.refunds],
          ['relay_return_compensations','request_id',ids.disputes],
          ['refund_execution_intents','order_id',ids.orders],
          ['parcel_items','order_item_id',ids.items],
          ['scans','order_id',ids.orders],
          ['parcels','order_id',ids.orders],
          ['local_stock_allocations','order_id',ids.orders],
          ['local_stock','product_id',ids.products],
          ['order_status_history','order_id',ids.orders],
          ['relay_product_return_receipts','request_id',ids.disputes],
          ['disputes','id',ids.disputes],
          ['order_items','id',ids.items],
          ['orders','id',ids.orders],
          ['products','id',ids.products],
          ['relais','id',ids.relais],
          ['users','id',ids.users],
        ];
        for(const [table,column,values] of deletion)
          if(values.length)await sql(`DELETE FROM ${table} WHERE ${column} = ANY($1::uuid[])`,[values]);
      });
    }finally{client.release();}
  });

  test('le mauvais relais ne peut pas recevoir, aucune mutation',async()=>{
    await expect(receive(reqA,agentB)).rejects.toMatchObject({status:404,code:'RETURN_INTAKE_NOT_FOUND'});
    expect((await sql('SELECT COUNT(*)::int n FROM relay_product_return_receipts WHERE request_id=$1',[reqA])).rows[0].n).toBe(0);
  });
  test('preuve physique réelle et rejeu strictement identique',async()=>{
    const once=await receive(reqA);
    expect(once.replayed).toBe(false);
    expect(once.receipt.quantity).toBe(1);
    expect(once.receipt.storage_zone).toBe('A');
    const again=await receive(reqA);
    expect(again.replayed).toBe(true);
    expect(again.receipt.id).toBe(once.receipt.id);
    await expect(receive(reqA,agentA,'B')).rejects.toMatchObject({status:409,code:'RETURN_INTAKE_ALREADY_RECORDED'});
  });
  test('une lettre non exclusive peut contenir plusieurs retours identifiés',async()=>{
    const other=await receive(reqB,agentA,'A');
    expect(other.receipt.storage_zone).toBe('A');
    const n=(await sql("SELECT COUNT(*)::int n FROM relay_product_return_receipts WHERE storage_zone='A' AND request_id=ANY($1::uuid[])",
      [[reqA,reqB]])).rows[0].n;
    expect(n).toBe(2);
  });
  test('le trigger DB refuse un faux relais, et empêche UPDATE / DELETE',async()=>{
    const bad=uid();const other=await makeCase('C',relayA);
    await expect(sql(`INSERT INTO relay_product_return_receipts
      (request_id,relay_id,quantity,condition_code,observation,received_by)
      VALUES($1,$2,1,'unknown','Constat direct non autorisé.',$3)`,[other.request,relayB,admin]))
      .rejects.toMatchObject({code:'23514'});
    const id=(await sql('SELECT id FROM relay_product_return_receipts WHERE request_id=$1',[reqA])).rows[0].id;
    await expect(sql("UPDATE relay_product_return_receipts SET storage_zone='B' WHERE id=$1",[id]))
      .rejects.toMatchObject({code:'P0001'});
    await expect(sql('DELETE FROM relay_product_return_receipts WHERE id=$1',[id]))
      .rejects.toMatchObject({code:'P0001'});
  });
  test('aucune remise en stock ni modification du dossier SAV',async()=>{
    const stock=(await sql('SELECT stock FROM products WHERE id=$1',[prodA])).rows[0].stock;
    expect(Number(stock)).toBe(0);
    const state=(await sql('SELECT status FROM disputes WHERE id=$1',[reqA])).rows[0].status;
    expect(state).toBe('open');
  });
  test('remplacement local : preuve de reprise, allocation normale, un ordre sans facturation malgré deux décisions concurrentes', async()=>{
    const original=await makeCase('RES',relayA,'LOCAL_STOCK');
    const compensate=require('../../services/relay-return-compensation-service').decideCompensation;
    const decision={ actor:{id:admin,role:'admin'},requestId:original.request,movement:'reship',
      reason:'Remplacement validé après constat physique',db };
    await expect(compensate(decision)).rejects.toMatchObject({code:'COMPENSATION_RESHIP_RECEIPT_REQUIRED'});
    await receive(original.request);
    await sql(`INSERT INTO local_stock(product_id,market_id,qty_physical,commercial_exposure)
       VALUES($1,$2,1,'ENABLED')`, [original.product,market]);
    const results=await Promise.all([compensate(decision),compensate(decision)]);
    const replacement=results[0].compensation.replacement_order_id;
    ids.orders.push(replacement);
    expect(results.map(x=>x.compensation.replacement_order_id)).toEqual([replacement,replacement]);
    expect(results.filter(x=>x.replayed)).toHaveLength(1);
    const {rows:[record]}=await sql(`SELECT o.status,o.payment_mode,o.total_kmf,o.user_id,o.relais_id,
       oi.id AS item_id,oi.replacement_source_item_id,oi.quantity,a.consumed_at,s.qty_physical
       FROM orders o JOIN order_items oi ON oi.order_id=o.id
       JOIN local_stock_allocations a ON a.order_id=o.id JOIN local_stock s ON s.id=a.local_stock_id
       WHERE o.id=$1`,[replacement]);
    ids.items.unshift(record.item_id);
    expect(record).toMatchObject({status:'ordered',payment_mode:'sav_replacement',total_kmf:0,user_id:admin,
      relais_id:relayA,replacement_source_item_id:original.item,quantity:1,qty_physical:0});
    expect(record.consumed_at).toBeTruthy();
    await expect(require('../../services/invoice-service').getOrCreateInvoice(replacement))
      .rejects.toThrow(/sans facturation/);
    const receiveReplacement=require('../../services/local-relay-receipt-service').recordLocalRelayReceipt;
    await expect(receiveReplacement({orderId:replacement,actor:agentB,physicalReceived:true}))
      .resolves.toMatchObject({status:403});
    await expect(receiveReplacement({orderId:replacement,actor:agentA,physicalReceived:true}))
      .resolves.toMatchObject({ok:true});
    expect((await sql('SELECT status FROM orders WHERE id=$1',[replacement])).rows[0].status).toBe('available');
    const reveal=await require('../../services/pickup-secret-access-service').revealOnce({orderId:replacement,userId:admin});
    expect(reveal.status).toBe(200);
    const collect=require('../../services/pickup-collection-service').collectByPickupCode;
    const handover={code:reveal.body.code,user:agentA,expectedOrderId:replacement};
    expect((await collect(handover)).status).toBe(200);
    expect((await collect(handover)).status).toBeGreaterThanOrEqual(400);
    expect((await sql('SELECT qty_collected FROM order_items WHERE id=$1',[record.item_id])).rows[0].qty_collected).toBe(1);

    expect((await sql('SELECT status FROM orders WHERE id=$1',[original.order])).rows[0].status).toBe('collected');
  });

  test('ledger SAV : réserve sur PostgreSQL, rapproche le PSP simulé, écrit un seul remboursement et reçu', async()=>{
    const original=await makeCase('LEDGER',relayA);
    const capture='pi_'+tag;
    await sql("UPDATE orders SET payment_mode='stripe_eur',stripe_payment_id=$2 WHERE id=$1",[original.order,capture]);
    const env={KOMERCE_ENV:'staging',E7_ITEM_RESERVATIONS_ENABLED:'1',
      E7_SANDBOX_REFUND_EXECUTION_ENABLED:'1',STRIPE_SECRET_KEY:'sk_test_fixture'};
    const providerRef='re_'+tag;
    const stripe={refunds:{
      create:jest.fn(async(payload)=>{
        const {rows:[intent]}=await sql("SELECT status FROM refund_execution_intents WHERE order_id=$1",[original.order]);
        expect(intent.status).toBe('processing');
        expect(payload).toMatchObject({payment_intent:capture,amount:400});
        return {id:providerRef};
      }),
      retrieve:jest.fn().mockResolvedValue({id:providerRef,payment_intent:capture,amount:400,currency:'eur',status:'succeeded'}),
    }};
    const compensate=require('../../services/relay-return-compensation-service').decideCompensation;
    const decision={actor:{id:admin,role:'admin'},requestId:original.request,movement:'ledger_refund',amount:2000,
      reason:'Remboursement validé après constat physique',db,env,stripe};
    const first=await compensate(decision);
    expect(first.refund_status).toBe('confirmed');
    const {rows:[refund]}=await sql('SELECT id,amount_eur,status FROM refunds WHERE order_id=$1',[original.order]);
    ids.refunds.push(refund.id);
    expect(refund).toMatchObject({amount_eur:4,status:'completed'});
    expect(await compensate(decision)).toMatchObject({refund_status:'confirmed',replayed:true});
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripe.refunds.retrieve).toHaveBeenCalledTimes(1);
    const {rows:[docs]}=await sql("SELECT count(*)::int AS count FROM transaction_documents WHERE subject_id=$1 AND document_type='refund_receipt'",[refund.id]);
    expect(docs.count).toBe(1);
  });

}
