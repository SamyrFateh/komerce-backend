'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * Issue #2939 acceptance: one product, two real orders and order_items,
 * genuine Inventory receiveItem + PostgreSQL CI. All changes ROLLBACK.
 * The service transaction is mapped to nested SAVEPOINT for safe isolation.
 */
const ci=process.env.GITHUB_ACTIONS==='true'
 &&process.env.NODE_ENV==='test'
 &&process.env.KOMERCE_DISABLE_CRONS==='true'
 &&process.env.DATABASE_URL==='postgresql://komerce:komerce@localhost:5432/komerce_test';
if(!ci){
 describe.skip('Inventory canonical order ownership regression — PostgreSQL CI only',()=>{test('skipped',()=>{})});
}else{
 const {randomUUID}=require('node:crypto');
 const {Pool}=require('pg');
 let mockPgClient, mockInventoryTx=0;
 jest.mock('../../db',()=>({
   query:(...args)=>mockPgClient.query(...args),
   getClient:async()=>mockPgClient,
   connect:async()=>{
     const name='inv_tx_'+(++mockInventoryTx);
     return {
       query:(sql,params)=>{
         const op=String(sql).trim().toUpperCase();
         if(op==='BEGIN')return mockPgClient.query('SAVEPOINT '+name);
         if(op==='COMMIT')return mockPgClient.query('RELEASE SAVEPOINT '+name);
         if(op==='ROLLBACK')return mockPgClient.query('ROLLBACK TO SAVEPOINT '+name);
         return mockPgClient.query(sql,params);
       },
       release:()=>{}
     };
   },
 }));
 const {receiveItem}=require('../../services/inventory-service');
 const feature=require('../../features/inventory.feature');
 const orders=require('../../features/orders.feature');
 const pool=new Pool({connectionString:process.env.DATABASE_URL});
 const mk=()=>randomUUID();
 let conn, ids, guard;
 beforeAll(async()=>{
  expect(feature.name).toBe('inventory');
  expect(orders.name).toBe('orders');
  expect(feature.db.tables).toContain('inventory_items: RW');
  expect(orders.db.tables).toContain('orders: RW!');
  conn=await pool.connect();mockPgClient=conn;
  await conn.query('BEGIN');
  guard=true;
  const {rows:[market]}=await conn.query("SELECT id FROM markets WHERE code = 'KM'");
  if(!market)throw Error('CI schema/boot has no KM market');
  ids={relais:mk(),product:mk(),a:mk(),b:mk(),itemA:mk(),itemB:mk()};
  const ref=mk().slice(0,12);
  await conn.query(
   'INSERT INTO relais(id,name,phone,address,market_id) VALUES($1,$2,$3,$4,$5)',
   [ids.relais,'CI Discover Hub', '+269100000', 'CI nowhere', market.id]);
  await conn.query('INSERT INTO products(id,name,price_kmf,stock) VALUES($1,$2,5000,20)',
   [ids.product,'CI cross-order boundary']);
  await conn.query(
   `INSERT INTO orders(id,reference,relais_id,market_id,total_kmf,payment_mode,status)
    VALUES($1,$3,$5,$6,5000,'stripe_eur','confirmed'),
          ($2,$4,$5,$6,5000,'stripe_eur','confirmed')`,
   [ids.a,ids.b,'CI-INV-A-'+ref,'CI-INV-B-'+ref,ids.relais,market.id]);
  await conn.query(
   `INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf)
    VALUES($1,$3,$5,1,5000),($2,$4,$5,1,5000)`,
   [ids.itemA,ids.itemB,ids.a,ids.b,ids.product]);
  await conn.query('SAVEPOINT healthy_seed');
 });
 afterAll(async()=>{
  if(conn){
   if(guard)await conn.query('ROLLBACK').catch(()=>{});
   conn.release();
  }
  await pool.end();
 });
 const inspect=async()=>{
  const {rows:line}=await conn.query(
   `SELECT ii.order_item_id,ii.order_id AS inventory_order,
           oi.order_id AS authoritative_order
      FROM inventory_items ii JOIN order_items oi ON oi.id=ii.order_item_id
     WHERE ii.order_item_id=$1`,[ids.itemA]);
  const {rows:statuses}=await conn.query(
   `SELECT id,items_received,items_total,completion_ratio FROM orders
     WHERE id IN ($1,$2) ORDER BY id`,[ids.a,ids.b]);
  return {row:line[0]||null,orders:statuses};
 };
 beforeEach(async()=>{await conn.query('ROLLBACK TO SAVEPOINT healthy_seed');});
 test('DEVIATION: supplying order B for line A returns 409 with no foreign receipt or completion',async()=>{
  const before=await inspect();
  await expect(receiveItem({order_item_id:ids.itemA,order_id:ids.b}))
   .rejects.toMatchObject({status:409,code:'INVENTORY_ORDER_MISMATCH'});
  const after=await inspect();
  expect(after.row).toBeNull();
  expect(after.orders).toEqual(before.orders);
  console.log('INVENTORY_FIX_PROOF '+JSON.stringify({mode:'ORDER_MISMATCH_REJECTED',db:'POSTGRES_REAL',status:409,inventoryCreated:false,unmodifiedOrders:true}));
 });
 test('NOMINAL: no order_id supplied resolves order from the immutable source row',async()=>{
  const before=await inspect();
  const result=await receiveItem({order_item_id:ids.itemA});
  const after=await inspect();
  expect(result.item.order_id).toBe(ids.a);
  expect(after.row).toMatchObject({inventory_order:ids.a,authoritative_order:ids.a});
  const orderA=after.orders.find(o=>o.id===ids.a),orderB=after.orders.find(o=>o.id===ids.b);
  expect(orderA.items_received).toBe(1);
  expect(orderA.completion_ratio).toBe(1);
  expect(orderB).toEqual(before.orders.find(o=>o.id===ids.b));
  console.log('INVENTORY_FIX_PROOF '+JSON.stringify({mode:'CANONICAL_NOMINAL',db:'POSTGRES_REAL',inventoryOrder:after.row.inventory_order,sourceOrder:after.row.authoritative_order,foreignOrderUnchanged:true}));
 });
 test('NOMINAL: explicitly correct order_id remains accepted',async()=>{
  const result=await receiveItem({order_item_id:ids.itemA,order_id:ids.a});
  expect(result.item.order_id).toBe(ids.a);
  const state=await inspect();
  expect(state.row.inventory_order).toBe(ids.a);
  console.log('INVENTORY_FIX_PROOF '+JSON.stringify({mode:'EXPLICIT_MATCH',db:'POSTGRES_REAL',correctOrder:true}));
 });
 test('CONTROL: unknown order_item cannot persist a phantom receipt',async()=>{
  const before=await inspect();
  await expect(receiveItem({order_item_id:mk(),order_id:ids.b}))
   .rejects.toMatchObject({status:404,code:'ORDER_ITEM_NOT_FOUND'});
  const after=await inspect();
  expect(after).toEqual(before);
  console.log('INVENTORY_FIX_PROOF '+JSON.stringify({mode:'UNKNOWN_LINE',db:'POSTGRES_REAL',status:404,unchanged:true}));
 });
}
