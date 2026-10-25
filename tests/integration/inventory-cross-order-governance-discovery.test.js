'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * Blind governance-graph discovery POC. One supplier product, two genuine
 * orders, two real order_items, actual inventory receiveItem and PostgreSQL.
 * No fabricated business status, all changes in one transaction rolled back.
 * This is a diagnostic counterexample, NOT the corrected application test.
 */
const ci=process.env.GITHUB_ACTIONS==='true'
 &&process.env.NODE_ENV==='test'
 &&process.env.KOMERCE_DISABLE_CRONS==='true'
 &&process.env.DATABASE_URL==='postgresql://komerce:komerce@localhost:5432/komerce_test';
if(!ci){
 describe.skip('Inventory ownership discovery: disposable CI PostgreSQL only',()=>{test('skipped',()=>{})});
}else{
 const {randomUUID}=require('node:crypto');
 const {Pool}=require('pg');
 let mockPgClient;
 jest.mock('../../db',()=>({
   query:(...args)=>mockPgClient.query(...args),
   getClient:async()=>mockPgClient,
   connect:async()=>mockPgClient,
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
 test('counterexample: inventory accepts foreign order and inflates B completion',async()=>{
  const result=await receiveItem({order_item_id:ids.itemA,order_id:ids.b});
  expect(result.item.order_item_id).toBe(ids.itemA);
  const observed=await inspect();
  expect(observed.row).toMatchObject({
   inventory_order:ids.b,authoritative_order:ids.a,
  });
  const receivedB=observed.orders.find(o=>o.id===ids.b);
  expect(receivedB).toMatchObject({items_received:1,items_total:1,completion_ratio:1});
  console.log('NOVEL_BUG_PROOF',JSON.stringify({
   category:'CROSS_ORDER_INVENTORY_RECEIPT',
   observed: {
    inventoryOrder:observed.row.inventory_order,
    canonicalOrder:observed.row.authoritative_order,
    receivingOrderCompletion:receivedB.completion_ratio,
   },
   invariantBroken:observed.row.inventory_order!==observed.row.authoritative_order,
   codeOwner:'inventory',
   dataOwner:'orders',
   severity:'P1',
   confidence:'REAL_POSTGRES_COUNTEREXAMPLE',
  }));
 });
 test('negative control: without foreign order the canonical link is respected',async()=>{
  await conn.query('ROLLBACK TO SAVEPOINT healthy_seed');
  const result=await receiveItem({order_item_id:ids.itemA});
  expect(result.item.order_id).toBe(ids.a);
  const observed=await inspect();
  expect(observed.row).toMatchObject({
   inventory_order:ids.a,authoritative_order:ids.a,
  });
  const receivedA=observed.orders.find(o=>o.id===ids.a);
  const receivedB=observed.orders.find(o=>o.id===ids.b);
  expect(receivedA).toMatchObject({items_received:1,items_total:1,completion_ratio:1});
  expect(receivedB).toMatchObject({items_received:0,items_total:0,completion_ratio:0});
  console.log('NOVEL_NEGATIVE_CONTROL',JSON.stringify({
   category:'CROSS_ORDER_INVENTORY_RECEIPT',
   rowMatches:observed.row.inventory_order===observed.row.authoritative_order,
   otherOrderCompletion:receivedB.completion_ratio,
  }));
 });
}