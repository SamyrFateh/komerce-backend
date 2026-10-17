'use strict';
// Persistent, opt-in staging fixture for A8 customs acceptance. Never deletes data.
const crypto = require('crypto');
const db = require('../db');
const TAG = 'A8-RECETTE-20261017';
const refs = [TAG+'-01', TAG+'-02'];
async function main() {
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
    await c.query("INSERT INTO relais(id,name,agent_name,phone,address,island,market_id) VALUES($1,$2,'A8 Test Agent','+269000111','Moroni Test','Ngazidja',$3)",[relayId,TAG+'-RELAIS',market.id]);
    await c.query("INSERT INTO customs_shipments(id,reference,shipment_date,transport_mode,cif_value_kmf,customs_paid_kmf,freight_kmf,allocation_method,status,market_id) VALUES($1,$2,CURRENT_DATE,'sea',30000,NULL,NULL,'by_cif_value','pending',$3)",[shipmentId,TAG+'-SHIP',market.id]);
    const orders=[];
    for (let i=0;i<2;i++) {
      const n=i===0?2:1, orderId=crypto.randomUUID(), productId=crypto.randomUUID();
      await c.query('INSERT INTO products(id,name,price_kmf,stock,weight_kg,cost_kmf) VALUES($1,$2,10000,100,1,4000)',[productId,TAG+'-PRODUCT-'+(i+1)]);
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
    await c.query('COMMIT');
    console.log(JSON.stringify({status:'CREATED',shipment:{reference:TAG+'-SHIP',id:shipmentId},orders},null,2));
  } catch(e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); await db.end(); }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
