#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          cj-golden-trigger-purchasing-proof
 * @domain        purchasing
 * @layer         script
 * @criticality   high
 * @inputs        ephemeral Postgres, CJ sandbox credentials, live CJ product
 * @outputs       Golden B2C paid order -> PO -> CJ sandbox order -> persisted supplier_order_id -> idempotent replay
 * @depends       db.js, services/purchasing-trigger-service.js, services/suppliers/connectors/cj-connector.js
 * @db-read       markets, products, product_skus, suppliers, product_suppliers, purchase_orders, purchase_lines
 * @db-write      ephemeral proof fixtures only
 * @db-txn        via purchasing-trigger-service
 * @doctrine      docs/doctrine/DOCTRINE_PURCHASING_PROVIDER_GOLDEN_E2E.md
 * @impact-areas  purchasing, supplier-integration
 */
'use strict';

const db = require('../db');
const cj = require('../services/suppliers/connectors/cj-connector');
const { triggerPurchasing } = require('../services/purchasing-trigger-service');

const DEFAULT_PID = '2508300753261628300';
const DEFAULT_VID = '2508300753271620000';

function guard(env = process.env) {
  const runtime = String(env.KOMERCE_ENV || env.NODE_ENV || '').trim().toLowerCase();
  if (runtime === 'production') throw new Error('REFUS: CJ Golden interdit en production');
  if (env.KOMERCE_ALLOW_CJ_GOLDEN_TRIGGER !== '1') throw new Error('KOMERCE_ALLOW_CJ_GOLDEN_TRIGGER=1 requis');
  if (env.KOMERCE_CJ_SANDBOX !== '1') throw new Error('KOMERCE_CJ_SANDBOX=1 requis');
  if (env.KOMERCE_CJ_AUTO_ORDER_ENABLED !== '1') throw new Error('KOMERCE_CJ_AUTO_ORDER_ENABLED=1 requis');
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
}

async function ensureMarket() {
  const { rows: [existing] } = await db.query("SELECT id FROM markets WHERE code='KM' LIMIT 1");
  if (existing) return existing.id;
  const { rows: [row] } = await db.query(
    "INSERT INTO markets(code,name,currency,minor_unit,is_active) VALUES('KM','Comores','KMF',0,true) RETURNING id"
  );
  return row.id;
}

async function bind(observationId, grain, canonicalEntityId, tag) {
  const { rows: [decision] } = await db.query(
    `INSERT INTO sourcing_resolution_decisions
       (decision_type, grain, observation_id, canonical_entity_id, actor_type, actor_ref, rationale, evidence_snapshot)
     VALUES ('LINK',$1,$2,$3,'system',$4,$5,'{}'::jsonb)
     RETURNING decision_id`,
    [grain, observationId, canonicalEntityId, 'cj-golden-trigger', tag]
  );
  await db.query(
    `INSERT INTO sourcing_resolution_bindings
       (observation_id, grain, canonical_entity_id, asserted_by_decision_id)
     VALUES ($1,$2,$3,$4)`,
    [observationId, grain, canonicalEntityId, decision.decision_id]
  );
}

async function seedFixture(env = process.env) {
  const pid = String(env.KOMERCE_CJ_GOLDEN_PID || DEFAULT_PID).trim();
  const wantedVid = String(env.KOMERCE_CJ_GOLDEN_VID || DEFAULT_VID).trim();

  const live = await cj.fetchProducts({ productIds: [pid], env });
  const productLive = live.products?.[0];
  if (!productLive) throw new Error('CJ_GOLDEN_PRODUCT_NOT_FOUND');
  const unit = (productLive.sellable_units || []).find((x) => String(x.supplier_unit_ref) === wantedVid);
  if (!unit) throw new Error('CJ_GOLDEN_UNIT_NOT_FOUND');
  if (!unit.is_active || !(Number(unit.stock_available) > 0) || !(Number(unit.purchase_price) > 0)) {
    throw new Error('CJ_GOLDEN_UNIT_NOT_COMMANDABLE');
  }

  const tag = `cj-golden-${Date.now()}`;
  const marketId = await ensureMarket();

  const { rows: [relais] } = await db.query(
    `INSERT INTO relais(name,agent_name,phone,address,island,market_id,is_active)
     VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id`,
    [tag, tag, '+2693999999', 'Golden fixture', 'Ngazidja', marketId]
  );

  const { rows: [product] } = await db.query(
    `INSERT INTO products(name,price_kmf,stock,is_active,inventory_model)
     VALUES ($1,25990,0,true,'SKU') RETURNING id`,
    [`${tag} product`]
  );

  const { rows: [supplier] } = await db.query(
    `INSERT INTO suppliers(name,platform,auto_order,is_active)
     VALUES ($1,'cj',true,true) RETURNING id`,
    [`${tag} CJ`]
  );

  const { rows: [productSupplier] } = await db.query(
    `INSERT INTO product_suppliers
       (product_id,supplier_id,supplier_sku,supplier_price_aed,supplier_url,priority,is_active)
     VALUES ($1,$2,$3,NULL,NULL,1,true) RETURNING id`,
    [product.id, supplier.id, unit.supplier_sku]
  );

  const identity = unit.supplier_order_identity;
  const { rows: [sku] } = await db.query(
    `INSERT INTO product_skus
       (product_id,sku,variant_combo,stock,is_active,source,supplier_sku,supplier_unit_ref,supplier_order_identity)
     VALUES ($1,$2,'{}'::jsonb,$3,true,'SUPPLIER',$4,$5,$6::jsonb)
     RETURNING id`,
    [product.id, `CJ-GOLDEN-${wantedVid}`, Number(unit.stock_available), unit.supplier_sku, wantedVid, JSON.stringify(identity)]
  );

  const { rows: [catalogImport] } = await db.query(
    `INSERT INTO supplier_catalog_imports(supplier_name,source_type,total_items,notes)
     VALUES ('CJdropshipping','api',1,$1) RETURNING id`,
    [tag]
  );
  await db.query(
    `INSERT INTO sourcing_candidates
       (import_id,supplier_name,supplier_product_id,product_name,purchase_price,currency,state,product_id)
     VALUES ($1,'CJdropshipping',$2,$3,$4,'USD','imported_to_catalog',$5)`,
    [catalogImport.id, pid, `${tag} source`, Number(unit.purchase_price), product.id]
  );

  const sourceId = `api:cj:${tag}`;
  await db.query(
    `INSERT INTO sourcing_sources(source_id,adapter_type,acquisition,continuity,status)
     VALUES ($1,'cj','pull','recurring','active')`,
    [sourceId]
  );
  const { rows: [capture] } = await db.query(
    `INSERT INTO sourcing_captures(source_id,status,completed_at,stats)
     VALUES ($1,'complete',NOW(),$2::jsonb) RETURNING capture_id`,
    [sourceId, JSON.stringify({ import_id: catalogImport.id })]
  );
  const { rows: [productObs] } = await db.query(
    `INSERT INTO sourcing_observations(capture_id,grain,source_ref,observed_at,normalized,raw_fragment)
     VALUES ($1,'product',$2,NOW(),$3::jsonb,'{}'::jsonb) RETURNING observation_id`,
    [capture.capture_id, pid, JSON.stringify({ title: productLive.product_name || tag })]
  );
  const { rows: [offerObs] } = await db.query(
    `INSERT INTO sourcing_observations(capture_id,grain,source_ref,parent_observation_id,observed_at,normalized,raw_fragment)
     VALUES ($1,'offer',$2,$3,NOW(),$4::jsonb,'{}'::jsonb) RETURNING observation_id`,
    [capture.capture_id, `${pid}:offer`, productObs.observation_id, JSON.stringify({ purchase_price: Number(unit.purchase_price), currency: 'USD' })]
  );
  const { rows: [unitObs] } = await db.query(
    `INSERT INTO sourcing_observations(capture_id,grain,source_ref,parent_observation_id,observed_at,normalized,raw_fragment)
     VALUES ($1,'unit',$2,$3,NOW(),$4::jsonb,'{}'::jsonb) RETURNING observation_id`,
    [capture.capture_id, wantedVid, offerObs.observation_id, JSON.stringify({
      supplier_unit_ref: wantedVid,
      supplier_sku: unit.supplier_sku,
      purchase_price: Number(unit.purchase_price),
      currency: 'USD',
      stock_available: Number(unit.stock_available),
      availability: 'available',
      is_active: true,
      supplier_order_identity: identity,
    })]
  );

  const { rows: [cp] } = await db.query("INSERT INTO sourcing_canonical_entities(grain) VALUES('product') RETURNING canonical_entity_id");
  const { rows: [co] } = await db.query("INSERT INTO sourcing_canonical_entities(grain,parent_entity_id) VALUES('offer',$1) RETURNING canonical_entity_id", [cp.canonical_entity_id]);
  const { rows: [cu] } = await db.query("INSERT INTO sourcing_canonical_entities(grain,parent_entity_id) VALUES('unit',$1) RETURNING canonical_entity_id", [co.canonical_entity_id]);

  await bind(productObs.observation_id, 'product', cp.canonical_entity_id, tag);
  await bind(offerObs.observation_id, 'offer', co.canonical_entity_id, tag);
  await bind(unitObs.observation_id, 'unit', cu.canonical_entity_id, tag);
  await db.query(
    `INSERT INTO sourcing_canonical_entity_refs(canonical_entity_id,source_id,ref_kind,ref_value)
     VALUES ($1,$2,'supplier_unit_ref',$3)`,
    [cu.canonical_entity_id, sourceId, wantedVid]
  );

  const reference = `CJ-GOLDEN-${Date.now()}`;
  const { rows: [order] } = await db.query(
    `INSERT INTO orders(reference,relais_id,market_id,total_kmf,payment_mode,payment_status,status)
     VALUES ($1,$2,$3,25990,'cash_relais','paid','ordered') RETURNING id,reference`,
    [reference, relais.id, marketId]
  );
  const { rows: [item] } = await db.query(
    `INSERT INTO order_items(order_id,product_id,quantity,price_kmf,sku_id,variant_combo,fulfillment_source)
     VALUES ($1,$2,1,25990,$3,'{}'::jsonb,'IMPORT') RETURNING id`,
    [order.id, product.id, sku.id]
  );

  return { tag, order, item, sku, supplier, productSupplier, identity, unit };
}

async function run(env = process.env) {
  guard(env);
  const fixture = await seedFixture(env);

  const first = await triggerPurchasing(fixture.order.id, { context: { env } });
  const firstPo = first.purchase_orders?.[0];
  if (firstPo?.status !== 'auto_ordered') {
    throw new Error(`CJ_GOLDEN_FIRST_TRIGGER_FAILED:${JSON.stringify(firstPo)}`);
  }

  const { rows: [po] } = await db.query(
    `SELECT id,status,supplier_order_id,product_sku_id,supplier_unit_ref,supplier_order_identity,qty
       FROM purchase_orders WHERE id=$1`,
    [firstPo.purchase_order_id]
  );
  if (!po || po.status !== 'confirmed' || !po.supplier_order_id) throw new Error('CJ_GOLDEN_PO_NOT_CONFIRMED');
  if (String(po.product_sku_id) !== String(fixture.sku.id)) throw new Error('CJ_GOLDEN_SKU_MISMATCH');
  if (String(po.supplier_unit_ref) !== String(fixture.unit.supplier_unit_ref)) throw new Error('CJ_GOLDEN_UNIT_MISMATCH');

  const second = await triggerPurchasing(fixture.order.id, { context: { env } });
  const secondPo = second.purchase_orders?.[0];
  if (secondPo?.status !== 'already_exists') {
    throw new Error(`CJ_GOLDEN_REPLAY_NOT_IDEMPOTENT:${JSON.stringify(secondPo)}`);
  }
  if (String(secondPo.purchase_order_id) !== String(po.id)) throw new Error('CJ_GOLDEN_REPLAY_PO_CHANGED');

  const { rows: [count] } = await db.query(
    'SELECT COUNT(*)::int AS n FROM purchase_orders WHERE order_id=$1',
    [fixture.order.id]
  );
  if (count.n !== 1) throw new Error(`CJ_GOLDEN_DUPLICATE_PO:${count.n}`);

  const result = {
    proof: 'CJ_GOLDEN_TRIGGER_PURCHASING',
    sandbox: true,
    payment_invoked: false,
    confirmation_invoked: false,
    order_id: fixture.order.id,
    purchase_order_id: po.id,
    supplier_order_id: po.supplier_order_id,
    supplier_unit_ref: po.supplier_unit_ref,
    first_status: firstPo.status,
    replay_status: secondPo.status,
    purchase_order_count: count.n,
  };
  console.log(`[cj-golden-trigger-purchasing] ${JSON.stringify(result)}`);
  return result;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(`[cj-golden-trigger-purchasing] FAILED: ${error.stack || error}`);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { guard, seedFixture, run };
