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
  const ids={orders:[],items:[],products:[],disputes:[],receipts:[],relais:[],users:[]};
  let client,market,admin,relayA,relayB,reqA,reqB,prodA,agentA,agentB;
  const sql=(stmt,params)=>client.query(stmt,params);
  const receive=(requestId,actor=agentA,zone='A')=>intake.recordIntake({
    actor,requestId,condition:'opened',zone,observation:'Carton présenté au relais, constat physique signé.',db
  });

  async function privilegedFixture(fn){
    await sql("SET session_replication_role='replica'");
    try{await fn();}finally{await sql("SET session_replication_role='origin'");}
  }
  async function makeCase(label,relay){
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
      await sql(`INSERT INTO order_items(id,order_id,product_id,quantity,qty_collected,price_kmf)
                 VALUES($1,$2,$3,1,1,10000)`,[item,order,product]);
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
    agentA={id:admin,role:'agent_relais',relais_id:relayA};
    agentB={id:admin,role:'agent_relais',relais_id:relayB};
    const a=await makeCase('A',relayA);
    const b=await makeCase('B',relayA);
    reqA=a.request;reqB=b.request;prodA=a.product;
  });
  afterAll(async()=>{
    if(!client)return;
    try{
      await privilegedFixture(async()=>{
        const deletion=[
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
}
