'use strict';

/**
 * Persistent Golden setup for the visual acceptance cockpit.
 * Test/dev only: creates the canonical facts up to supplier fulfillment and
 * deliberately stops before HUB_INBOUND.
 */

const { assertTestDatabase, uuid } = require('./e2eDbKit');

function runTag() {
  return Date.now().toString(36).toUpperCase() + '-' + uuid().slice(0, 8).toUpperCase();
}

async function createGoldenJourney(db, { marketCode = 'KM' } = {}) {
  assertTestDatabase();
  const run = runTag();
  const ids = Object.fromEntries(
    ['user','relais','supplier','product','sku','order','item','po','line','execution','payment','fulfillment']
      .map(key => [key, uuid()])
  );
  const ref = 'K-GOLDEN-' + run;
  const supplierOrder = 'CJ-GOLDEN-' + run;
  const supplierUnit = 'VID-GOLDEN-' + run;
  const tracking = 'TRK-GOLDEN-' + run;
  const soi = { provider: 'cj', version: 1, payload: { supplier_unit_ref: supplierUnit, supplier_sku: 'CJ-SKU-' + run } };

  const market = (await db.query('SELECT id FROM markets WHERE code=$1 LIMIT 1', [marketCode])).rows[0];
  if (!market) throw new Error('Golden setup requires canonical market ' + marketCode);

  await db.query('BEGIN');
  try {
    await db.query("INSERT INTO users(id,full_name,email,phone,role) VALUES($1,'Golden Customer',$2,$3,'client')",
      [ids.user, 'golden-'+run.toLowerCase()+'@komerce.test', '+2693'+String(Date.now()).slice(-7)]);
    await db.query("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'Golden Agent','+2693000001','Golden Relay',$3)",
      [ids.relais, 'Golden Relay '+run, market.id]);
    await db.query("INSERT INTO suppliers(id,name,platform,contact_phone,auto_order,is_active) VALUES($1,$2,'cj','+971500000001',true,true)",
      [ids.supplier, 'Golden CJ Supplier '+run]);
    await db.query("INSERT INTO products(id,name,price_kmf,cost_kmf,volume_cm3,stock,price_aed,inventory_model) VALUES($1,$2,25000,7000,100000,0,200,'SKU')",
      [ids.product, 'Golden Product '+run]);
    await db.query(`INSERT INTO product_skus
      (id,product_id,sku,stock,is_active,source,supplier_sku,supplier_unit_ref,supplier_order_identity)
      VALUES($1,$2,$3,10,true,'SUPPLIER',$4,$5,$6::jsonb)`,
      [ids.sku, ids.product, 'K-GOLDEN-SKU-'+run, soi.payload.supplier_sku, supplierUnit, JSON.stringify(soi)]);
    await db.query(`INSERT INTO orders
      (id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur)
      VALUES($1,$2,$3,$4,$5,'ordered','paid','stripe_eur',25000,50)`,
      [ids.order, ids.user, ids.relais, market.id, ref]);
    await db.query(`INSERT INTO order_items
      (id,order_id,product_id,quantity,price_kmf,sku_id,fulfillment_source)
      VALUES($1,$2,$3,1,25000,$4,'IMPORT')`, [ids.item, ids.order, ids.product, ids.sku]);
    await db.query(`INSERT INTO order_item_cost_imputations
      (order_id,order_item_id,product_id,quantity,sale_unit_price_kmf,sale_total_kmf,
       estimated_landed_relay_cost_kmf,estimated_business_complete_cost_kmf,
       estimated_margin_kmf,estimated_margin_pct,cost_breakdown,pricing_source)
      VALUES($1,$2,$3,1,25000,25000,11000,11000,14000,56,$4::jsonb,'golden-e2e')`,
      [ids.order, ids.item, ids.product, JSON.stringify({landed_relay:{product_purchase:7000,freight:1500,customs:2500},business:{payment:0}})]);
    await db.query(`INSERT INTO order_item_real_cost_allocations
      (order_id,order_item_id,cost_type,amount_kmf,allocation_method,source,is_actual,confidence)
      VALUES($1,$2,'product_purchase',7000,'direct','supplier_execution_payment',TRUE,'high')`,
      [ids.order, ids.item]);
    await db.query(`INSERT INTO purchase_orders
      (id,order_id,supplier_id,market_id,status,trigger_mode,procurement_hub_ref,qty,supplier_sku)
      VALUES($1,NULL,$2,$3,'draft','auto','DXB',NULL,NULL)`, [ids.po, ids.supplier, market.id]);
    await db.query(`INSERT INTO purchase_lines
      (id,purchase_order_id,order_item_id,supplier_id,product_sku_id,supplier_sku,
       supplier_unit_ref,supplier_order_identity,quantity,supplier_unit_price,supplier_currency,procurement_hub_ref)
      VALUES($1,NULL,$2,$3,$4,$5,$6,$7::jsonb,1,7,'USD','DXB')`,
      [ids.line, ids.item, ids.supplier, ids.sku, soi.payload.supplier_sku, supplierUnit, JSON.stringify(soi)]);
    await db.query('UPDATE purchase_lines SET purchase_order_id=$2,updated_at=NOW() WHERE id=$1', [ids.line, ids.po]);
    await db.query("UPDATE purchase_orders SET status='confirmed',supplier_order_id=$2,confirmed_at=NOW(),updated_at=NOW() WHERE id=$1",
      [ids.po, supplierOrder]);
    await db.query(`INSERT INTO supplier_execution_orders
      (id,purchase_order_id,provider,supplier_order_id,supplier_order_code,provider_status)
      VALUES($1,$2,'cj',$3,$4,'SHIPPED')`, [ids.execution, ids.po, supplierOrder, 'CODE-'+run]);
    await db.query('INSERT INTO supplier_execution_order_lines(supplier_execution_order_id,purchase_line_id,quantity) VALUES($1,$2,1)',
      [ids.execution, ids.line]);
    await db.query(`INSERT INTO supplier_execution_payments
      (id,purchase_order_id,provider,payment_execution_key,supplier_execution_order_id,payment_ref,
       expected_amount,observed_amount,currency,status,reconciliation_status,real_debit_verified)
      VALUES($1,$2,'cj',$3,$4,$5,7,7,'USD','succeeded','matched',true)`,
      [ids.payment, ids.po, 'golden-payment:'+run, ids.execution, 'PAY-GOLDEN-'+run]);
    await db.query(`INSERT INTO supplier_execution_fulfillments
      (id,supplier_execution_order_id,provider,fulfillment_execution_key,expected_quantity,observed_quantity,
       provider_status,carrier,tracking_number,shipped_at,reconciliation_status,evidence_source,evidence_ref,facts)
      VALUES($1,$2,'cj',$3,1,1,'SHIPPED','CJ',$4,NOW(),'matched','cj_order_detail',$5,$6::jsonb)`,
      [ids.fulfillment, ids.execution, 'fulfillment:'+ids.execution+':'+supplierUnit, tracking,
       'EVIDENCE-'+run, JSON.stringify({supplier_unit_ref:supplierUnit})]);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }

  return { reference: ref, marketCode, orderId: ids.order };
}

module.exports = { createGoldenJourney };
