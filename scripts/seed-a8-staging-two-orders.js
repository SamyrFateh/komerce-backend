'use strict';
// Persistent, opt-in staging fixture for A8 customs acceptance. Never deletes data.
// Isolation : produits et relais INACTIFS (invendables, non sélectionnables), stock 0, client NULL (aucun
// destinataire de notification), aucune ligne de paiement/achat/sourcing/expédition créée ; contrôlé dans la
// transaction (ROLLBACK si une table aval contient une ligne). `--verify` = lecture seule, sans écriture.
const crypto = require('crypto');
const db = require('../db');
const TAG = 'A8-RECETTE-20261017';
const refs = [TAG+'-01', TAG+'-02'];
// Tables aval qui doivent rester VIDES pour ces commandes (paiement, cash, achat/sourcing, notification, doc, remboursement).
const DOWNSTREAM = [
  ['cash_collections', 'order_id'], ['mobile_money_transactions', 'order_id'], ['sms_log', 'order_id'], ['invoices', 'order_id'],
  ['transaction_documents', 'order_id'], ['refunds', 'order_id'], ['wallet_consumptions', 'order_id'], ['incidents', 'order_id'],
  ['scans', 'order_id'], ['scan_events', 'order_id'], ['unsold_items', 'order_id'], ['hub_purchase_allocations', 'order_id'],
  ['local_stock_allocations', 'order_id'], ['store_credits', 'source_order_id'], ['loyalty_rewards', 'triggered_by_order_id'],
  ['purchase_lines', 'order_item_id', 'SELECT oi.id FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.reference = ANY($1::text[])'],
];
async function downstreamCounts(q) {
  const out = {};
  for (const [t, col, sub] of DOWNSTREAM) {
    const inner = sub || 'SELECT id FROM orders WHERE reference = ANY($1::text[])';
    const { rows: [r] } = await q.query(`SELECT count(*)::int AS n FROM ${t} WHERE ${col} IN (${inner})`, [refs]);
    out[t] = r.n;
  }
  return out;
}
async function verify() {
  const q = await db.connect();
  try {
    await q.query('SET default_transaction_read_only = on');
    const orders = (await q.query(`SELECT o.reference, o.status, o.payment_status, o.payment_mode, o.total_kmf, o.user_id, o.margin_real_pct, o.margin_alert, o.sourcing_blocked,
        (SELECT count(*)::int FROM parcels p WHERE p.order_id=o.id) AS parcels FROM orders o WHERE o.reference = ANY($1::text[]) ORDER BY o.reference`, [refs])).rows;
    const group = (await q.query(`SELECT cs.reference, cs.status, cs.cif_value_kmf, cs.customs_paid_kmf, count(csp.parcel_id)::int AS parcels, count(DISTINCT p.order_id)::int AS orders
        FROM customs_shipments cs JOIN customs_shipment_parcels csp ON csp.shipment_id=cs.id JOIN parcels p ON p.id=csp.parcel_id
        WHERE cs.reference = $1 GROUP BY cs.id`, [TAG+'-SHIP'])).rows;
    const products = (await q.query("SELECT name, is_active, is_available, stock FROM products WHERE name LIKE $1 ORDER BY name", [TAG+'-PRODUCT-%'])).rows;
    const relais = (await q.query('SELECT name, is_active FROM relais WHERE name = $1', [TAG+'-RELAIS'])).rows;
    const downstream = orders.length ? await downstreamCounts(q) : {};
    const ok = orders.length === 2 && orders.reduce((n, o) => n + o.parcels, 0) === 3 && group.length === 1 && group[0].parcels === 3 && group[0].orders === 2
      && products.every((x) => !x.is_active && !x.is_available) && relais.every((x) => !x.is_active) && Object.values(downstream).every((n) => n === 0);
    console.log(JSON.stringify({ status: ok ? 'VERIFIED' : 'NOT_VERIFIED', orders, group, products, relais, downstream }, null, 2));
    if (!ok) process.exitCode = 1;
  } finally { q.release(); await db.pool.end(); }
}
async function main() {
  if (process.argv.indexOf('--verify') !== -1) return verify();
  if (process.argv.indexOf('--apply') === -1) throw new Error('DRY RUN only: add --apply to create fixtures');
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging' && process.env.RAILWAY_ENVIRONMENT !== 'staging') {
    throw new Error('REFUSED: Railway staging environment required');
  }
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const market = (await c.query("SELECT id FROM markets WHERE code='KM'")).rows[0];
    if (!market) throw new Error('KM market not found');
    const existing = await c.query('SELECT reference FROM orders WHERE reference = ANY($1::text[])', [refs]);
    if (existing.rowCount) throw new Error('Fixture already exists; refusing partial/duplicate seed: '+existing.rows.map(x=>x.reference).join(','));
    const relayId = crypto.randomUUID(), shipmentId = crypto.randomUUID();
    await c.query("INSERT INTO relais(id,name,agent_name,phone,address,island,market_id,is_active) VALUES($1,$2,'A8 Test Agent','+269000111','Moroni Test','Ngazidja',$3,false)",[relayId,TAG+'-RELAIS',market.id]);
    await c.query("INSERT INTO customs_shipments(id,reference,shipment_date,transport_mode,cif_value_kmf,customs_paid_kmf,freight_kmf,allocation_method,status,market_id) VALUES($1,$2,CURRENT_DATE,'sea',30000,NULL,NULL,'by_cif_value','pending',$3)",[shipmentId,TAG+'-SHIP',market.id]);
    const orders=[];
    for (let i=0;i<2;i++) {
      const n=i===0?2:1, orderId=crypto.randomUUID(), productId=crypto.randomUUID();
      await c.query('INSERT INTO products(id,name,price_kmf,stock,weight_kg,cost_kmf,is_active,is_available) VALUES($1,$2,10000,0,1,4000,false,false)',[productId,TAG+'-PRODUCT-'+(i+1)]);
      await c.query("INSERT INTO orders(id,reference,user_id,relais_id,market_id,total_kmf,payment_mode,payment_status,status) VALUES($1,$2,NULL,$3,$4,$5,'cash_relais','paid','confirmed')",[orderId,refs[i],relayId,market.id,10000*n]);
      for(let j=0;j<n;j++){
        const itemId=crypto.randomUUID(), parcelId=crypto.randomUUID();
        await c.query('INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf) VALUES($1,$2,$3,1,10000)',[itemId,orderId,productId]);
        await c.query("INSERT INTO order_item_cost_imputations(order_id,order_item_id,product_id,quantity,sale_unit_price_kmf,sale_total_kmf,estimated_landed_relay_cost_kmf,estimated_business_variable_cost_kmf,estimated_business_complete_cost_kmf,cost_breakdown) VALUES($1,$2,$3,1,10000,10000,4000,4000,4000,$4::jsonb)",[orderId,itemId,productId,JSON.stringify({landed_relay:{product_purchase:4000,freight:0,customs:0},business:{payment:0,risk_provision:0}})]);
        await c.query("INSERT INTO parcels(id,order_id,reference,status) VALUES($1,$2,$3,'in_transit')",[parcelId,orderId,refs[i]+'-P'+(j+1)]);
        await c.query('INSERT INTO parcel_items(id,parcel_id,order_item_id,product_id,quantity,qty_allocated) VALUES($1,$2,$3,$4,1,1)',[crypto.randomUUID(),parcelId,itemId,productId]);
        await c.query('INSERT INTO customs_shipment_parcels(shipment_id,parcel_id,parcel_cif_kmf,parcel_weight_kg) VALUES($1,$2,10000,1)',[shipmentId,parcelId]);
      }
      orders.push({reference:refs[i],id:orderId,parcels:n});
    }
    const down = await downstreamCounts(c);
    const dirty = Object.entries(down).filter(([, n]) => n > 0);
    if (dirty.length) throw new Error('Effets aval inattendus, ROLLBACK : ' + JSON.stringify(dirty));
    await c.query('COMMIT');
    console.log(JSON.stringify({status:'CREATED',shipment:{reference:TAG+'-SHIP',id:shipmentId},orders},null,2));
  } catch(e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); await db.pool.end(); }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
