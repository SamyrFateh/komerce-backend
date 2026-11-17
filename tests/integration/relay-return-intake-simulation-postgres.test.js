'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration relay-return-intake-simulation-postgres.test.js
 * @brief Migration 422 : le garde de reprise SAV accepte une commande de recette (simulation_scope).
 */
jest.setTimeout(60000);
if (!process.env.DATABASE_URL) {
  describe.skip('relay-return-intake simulation (DATABASE_URL required)',()=>{ test('skipped',()=>{}); });
} else {
  const {randomUUID,randomBytes}=require('crypto');
  const db=require('../../db');
  const uid=()=>randomUUID();
  const tag='RETSIM-'+randomBytes(6).toString('hex').toUpperCase();
  let client,market,user,relay;
  const ids={order:uid(),item:uid(),product:uid(),request:uid()};
  const sql=(s,p)=>client.query(s,p);

  beforeAll(async()=>{
    client=await db.getClient();
    market=(await sql("SELECT id FROM markets WHERE code='KM' LIMIT 1")).rows[0].id;
    user=uid();relay=uid();
    await sql("INSERT INTO users(id,full_name,email,phone,role) VALUES($1,$2,$3,$4,'admin')",
      [user,'SAV sim '+tag,tag.toLowerCase()+'@komerce.test','+2693'+String(Date.now()).slice(-7)]);
    await sql("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'A','+2693000021','RETOUR',$3)",
      [relay,tag+'-R',market]);
    await sql(`INSERT INTO products(id,name,price_kmf,cost_kmf,volume_cm3,stock,price_aed,inventory_model)
               VALUES($1,$2,10000,3000,1000,0,100,'SKU')`,[ids.product,'Sim '+tag]);
    await sql(`INSERT INTO orders(id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur,simulation_scope)
               VALUES($1,$2,$3,$4,$5,'collected','paid','cash_relais',10000,20,'RCT1')`,
      [ids.order,user,relay,market,tag]);
    await sql("SET session_replication_role='replica'");
    try{
      await sql(`INSERT INTO order_items(id,order_id,product_id,quantity,qty_collected,price_kmf)
                 VALUES($1,$2,$3,1,1,10000)`,[ids.item,ids.order,ids.product]);
    }finally{await sql("SET session_replication_role='origin'");}
    await sql(`INSERT INTO disputes(id,order_id,type,status,description,return_order_item_id,return_quantity,return_reason,created_by)
               VALUES($1,$2,'product_return','open','Produit à examiner',$3,1,'defective',$4)`,
      [ids.request,ids.order,ids.item,user]);
  });
  afterAll(async()=>{
    if(!client)return;
    try{
      await sql("SET session_replication_role='replica'");
      await sql('DELETE FROM relay_product_return_receipts WHERE request_id=$1',[ids.request]);
      await sql('DELETE FROM disputes WHERE id=$1',[ids.request]);
      await sql('DELETE FROM order_items WHERE id=$1',[ids.item]);
      await sql('DELETE FROM orders WHERE id=$1',[ids.order]);
      await sql('DELETE FROM products WHERE id=$1',[ids.product]);
      await sql('DELETE FROM relais WHERE id=$1',[relay]);
      await sql('DELETE FROM users WHERE id=$1',[user]);
    }finally{await sql("SET session_replication_role='origin'").catch(()=>{});client.release();}
  });

  test('commande de recette : la reprise physique est acceptée', async()=>{
    const r=await sql(`INSERT INTO relay_product_return_receipts(request_id,relay_id,quantity,condition_code,observation,received_by)
      VALUES($1,$2,1,'opened','Carton présenté au relais, constat signé.',$3) RETURNING id`,[ids.request,relay,user]);
    expect(r.rows).toHaveLength(1);
  });
  test('les autres gardes restent actifs : mauvaise quantité refusée', async()=>{
    await expect(sql(`INSERT INTO relay_product_return_receipts(request_id,relay_id,quantity,condition_code,observation,received_by)
      VALUES($1,$2,2,'opened','Carton présenté au relais, constat signé.',$3)`,[ids.request,relay,user]))
      .rejects.toMatchObject({code:expect.stringMatching(/23514|23505/)});
  });
}
