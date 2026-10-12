'use strict';

/**
 * @test-kind helper
 * @test-runner jest
 * @test-requires postgres
 *
 * Shared Golden journey seam.
 * Business truth stays in canonical tables/reconcilers; this helper only
 * resolves the Golden order and exposes the same projection as the cockpit.
 */

const { projectGoldenEvidence } = require('../../services/golden-e2e-cockpit');
const { assertTestDatabase, uuid } = require('./e2eDbKit');
const { createShipment, declareCustomsPayment } = require('../../services/customs-shipment-service');

const PROGRESSIVE_BOUNDARIES = Object.freeze([
  'HUB_INBOUND',
  'CUSTOMS',
  'RELAY_AVAILABLE',
  'CUSTOMER_HANDOFF',
  'FINANCIAL_CLOSE',
]);

function assertGoldenReference(reference) {
  if (!/^K-GOLDEN-/i.test(String(reference || ''))) {
    throw new Error('Golden journey requires a K-GOLDEN-* reference');
  }
}

async function resolveGoldenOrder(db, reference) {
  assertGoldenReference(reference);
  const result = await db.query(
    'SELECT * FROM orders WHERE UPPER(reference) = UPPER($1) LIMIT 1',
    [reference]
  );
  const order = result.rows[0] || null;
  if (!order) throw new Error('Golden order not found: ' + reference);
  return order;
}

async function projectGoldenJourney(db, reference) {
  const order = await resolveGoldenOrder(db, reference);
  return projectGoldenEvidence(db, order);
}

function nextGoldenBoundary(projection) {
  const steps = Array.isArray(projection && projection.steps) ? projection.steps : [];
  for (const key of PROGRESSIVE_BOUNDARIES) {
    const step = steps.find(candidate => candidate.key === key);
    if (step && !step.passed) return step;
  }
  return null;
}

async function inspectGoldenJourney(db, reference) {
  const projection = await projectGoldenJourney(db, reference);
  return {
    projection,
    next: nextGoldenBoundary(projection),
    complete: !nextGoldenBoundary(projection),
  };
}

async function advanceGoldenHubInbound(db, reference) {
  assertTestDatabase();
  const inspection = await inspectGoldenJourney(db, reference);
  if (!inspection.next || inspection.next.key !== 'HUB_INBOUND') {
    throw new Error('Golden HUB_INBOUND is not the current boundary');
  }

  const order = await resolveGoldenOrder(db, reference);
  const facts = (await db.query(
    `SELECT pl.purchase_order_id, pl.id AS purchase_line_id, pl.order_item_id,
            pl.product_sku_id, pl.supplier_id, pl.supplier_unit_ref,
            pl.supplier_order_identity, f.tracking_number
       FROM purchase_lines pl
       JOIN order_items oi ON oi.id=pl.order_item_id
       JOIN supplier_execution_orders seo ON seo.purchase_order_id=pl.purchase_order_id
       JOIN supplier_execution_fulfillments f ON f.supplier_execution_order_id=seo.id
      WHERE oi.order_id=$1 AND f.reconciliation_status='matched'
      ORDER BY f.created_at DESC LIMIT 1`,
    [order.id]
  )).rows[0];

  if (!facts || !facts.tracking_number) {
    throw new Error('Golden HUB_INBOUND requires matched supplier fulfillment with tracking');
  }

  const allocationId = uuid();
  const unitId = uuid();
  const run = order.reference.replace(/^K-GOLDEN-/i, '');

  await db.query('BEGIN');
  try {
    await db.query(
      `INSERT INTO hub_purchase_allocations
         (id,purchase_order_id,order_id,order_item_id,product_sku_id,supplier_id,
          supplier_unit_ref,supplier_order_identity,quantity,market_id,destination_ref,purchase_line_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,1,$9,$10,$11)`,
      [allocationId, facts.purchase_order_id, order.id, facts.order_item_id,
       facts.product_sku_id, facts.supplier_id, facts.supplier_unit_ref,
       JSON.stringify(facts.supplier_order_identity), order.market_id,
       'relais:' + order.relais_id, facts.purchase_line_id]
    );
    await db.query(
      `INSERT INTO hub_physical_units
         (id,reference,unit_type,state,external_ref,current_location_ref)
       VALUES ($1,$2,'SUPPLIER_PACKAGE','RECEIVED',$3,'DXB-HUB')`,
      [unitId, 'KOM-RCV-GOLDEN-' + run, facts.tracking_number]
    );
    await db.query(
      `INSERT INTO hub_physical_unit_placements
         (physical_unit_id,allocation_id,quantity,operation_type)
       VALUES ($1,$2,1,'RECEIVE')`,
      [unitId, allocationId]
    );
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }

  return inspectGoldenJourney(db, reference);
}


async function advanceGoldenCustoms(db, reference) {
  assertTestDatabase();
  const inspection = await inspectGoldenJourney(db, reference);
  if (!inspection.next || inspection.next.key !== 'CUSTOMS') {
    throw new Error('Golden CUSTOMS is not the current boundary');
  }

  const order = await resolveGoldenOrder(db, reference);
  const item = (await db.query(
    'SELECT id, product_id FROM order_items WHERE order_id=$1 ORDER BY created_at LIMIT 1',
    [order.id]
  )).rows[0];
  if (!item) throw new Error('Golden CUSTOMS requires an order item');

  let parcel = (await db.query(
    'SELECT * FROM parcels WHERE order_id=$1 ORDER BY created_at LIMIT 1',
    [order.id]
  )).rows[0];

  const run = order.reference.replace(/^K-GOLDEN-/i, '');
  if (!parcel) {
    const parcelId = uuid();
    await db.query('BEGIN');
    try {
      await db.query(
        `INSERT INTO parcels
           (id,order_id,reference,status,type,relais_id,shipped_at,in_transit_at,arrived_at)
         VALUES ($1,$2,$3,'arrived','standard',$4,
                 NOW()-INTERVAL '3 hours',NOW()-INTERVAL '2 hours',NOW()-INTERVAL '1 hour')`,
        [parcelId, order.id, 'KOM-BOX-GOLDEN-' + run, order.relais_id]
      );
      await db.query(
        'INSERT INTO parcel_items(parcel_id,order_item_id,product_id,quantity) VALUES($1,$2,$3,1)',
        [parcelId, item.id, item.product_id]
      );
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
    parcel = (await db.query('SELECT * FROM parcels WHERE id=$1', [parcelId])).rows[0];
  }

  const existing = (await db.query(
    `SELECT cs.id, cs.status
       FROM customs_shipments cs
       JOIN customs_shipment_parcels csp ON csp.shipment_id=cs.id
      WHERE csp.parcel_id=$1
      ORDER BY cs.created_at DESC LIMIT 1`,
    [parcel.id]
  )).rows[0];

  let shipmentId = existing && existing.id;
  if (!shipmentId) {
    const created = await createShipment(db, {
      reference: 'CUS-GOLDEN-' + run,
      shipment_date: new Date().toISOString().slice(0, 10),
      transitaire_name: 'Golden Forwarder',
      transport_mode: 'sea',
      cif_value_kmf: 25000,
      allocation_method: 'by_cif_value',
      parcel_ids: [parcel.id],
    }, order.user_id, { marketId: order.market_id });
    shipmentId = created.shipment.id;
  }

  await declareCustomsPayment(db, shipmentId, {
    customs_paid_kmf: 2500,
    freight_kmf: 1500,
    notes: 'Golden customs declaration',
  }, order.user_id);

  return inspectGoldenJourney(db, reference);
}

module.exports = {
  PROGRESSIVE_BOUNDARIES,
  assertGoldenReference,
  resolveGoldenOrder,
  projectGoldenJourney,
  nextGoldenBoundary,
  inspectGoldenJourney,
  advanceGoldenHubInbound,
  advanceGoldenCustoms,
};
