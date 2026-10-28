'use strict';
/** SQL detector calibration only. Disposable pg_temp tables shadow public tables. */
const allocation="CREATE TEMP TABLE order_item_real_cost_allocations (id text, order_id text, order_item_id text, cost_type text, parcel_id text, shipment_id text)";
const orderItems="CREATE TEMP TABLE order_items (id text, order_id text)";
const parcels="CREATE TEMP TABLE parcel_items (parcel_id text, order_item_id text)";
const order="CREATE TEMP TABLE orders (id text, payment_mode text, relais_id text)";
const CASES=Object.freeze([
 {id:'KBA-001',bad:'bad_alloc',tables:[allocation,orderItems],
 nominal:["INSERT INTO order_items VALUES ('item','order_a')",
  "INSERT INTO order_item_real_cost_allocations (id,order_id,order_item_id) VALUES ('good_alloc','order_a','item')"],
 adversarial:["INSERT INTO order_item_real_cost_allocations (id,order_id,order_item_id) VALUES ('bad_alloc','order_b','item')"]},
 {id:'KBA-002',bad:'bad_freight',tables:[allocation,parcels],
 nominal:["INSERT INTO parcel_items VALUES ('parcel_a','item')",
  "INSERT INTO order_item_real_cost_allocations (id,order_item_id,cost_type,parcel_id,shipment_id) VALUES ('good_freight','item','freight','parcel_a','ship_a')"],
 adversarial:["INSERT INTO order_item_real_cost_allocations (id,order_item_id,cost_type,parcel_id,shipment_id) VALUES ('bad_freight','item','freight','parcel_b','ship_a')"]},
 {id:'KBA-003',bad:'bad_shipment',tables:[allocation,
  "CREATE TEMP TABLE customs_shipment_parcels (shipment_id text,parcel_id text)"],
 nominal:["INSERT INTO customs_shipment_parcels VALUES ('ship_a','parcel_a')",
  "INSERT INTO order_item_real_cost_allocations (id,cost_type,parcel_id,shipment_id) VALUES ('good_shipment','customs','parcel_a','ship_a')"],
 adversarial:["INSERT INTO order_item_real_cost_allocations (id,cost_type,parcel_id,shipment_id) VALUES ('bad_shipment','customs','parcel_b','ship_a')"]},
 {id:'KBA-004',bad:'bad_cash',tables:[order,
  "CREATE TEMP TABLE cash_collections (id text,order_id text)"],
 nominal:["INSERT INTO orders (id,payment_mode) VALUES ('order_a','cash_relais')",
  "INSERT INTO cash_collections VALUES ('good_cash','order_a')"],
 adversarial:["INSERT INTO orders (id,payment_mode) VALUES ('order_b','stripe_eur')",
  "INSERT INTO cash_collections VALUES ('bad_cash','order_b')"]},
 {id:'KBA-005',bad:'bad_activate',tables:[
  "CREATE TEMP TABLE product_market_price_draft_events (id text,action text,actor_id text)"],
 nominal:["INSERT INTO product_market_price_draft_events VALUES ('good_activate','ACTIVATE','actor_a')"],
 adversarial:["INSERT INTO product_market_price_draft_events VALUES ('bad_activate','ACTIVATE',NULL)"]},
 {id:'KBA-006',bad:'bad_settlement',tables:[
  "CREATE TEMP TABLE market_operating_assignments (id text,status text)",
  "CREATE TEMP TABLE market_settlements (id text,status text,assignment_id text)"],
 nominal:["INSERT INTO market_operating_assignments VALUES ('a1','ACTIVE')",
  "INSERT INTO market_settlements VALUES ('good_settlement','READY','a1')"],
 adversarial:["INSERT INTO market_operating_assignments VALUES ('a2','DRAFT')",
  "INSERT INTO market_settlements VALUES ('bad_settlement','READY','a2')"]},
 {id:'KBA-007',bad:'bad_scan',tables:[order,
  "CREATE TEMP TABLE scans (id text,order_id text,step text,pickup_relais_id text)"],
 nominal:["INSERT INTO orders (id,relais_id) VALUES ('order_a','relay_a')",
  "INSERT INTO scans VALUES ('good_scan','order_a','collected','relay_a')"],
 adversarial:["INSERT INTO orders (id,relais_id) VALUES ('order_b','relay_a')",
  "INSERT INTO scans VALUES ('bad_scan','order_b','collected','relay_b')"]},
]);
module.exports={CASES};
