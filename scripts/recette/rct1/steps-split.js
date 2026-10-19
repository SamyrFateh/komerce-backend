/**
 * @komerce-arch-lite
 * @role          rct1-steps-split
 * @domain        logistics
 * @layer         script
 * @owner         backend-core
 * @purpose       Etapes RCT1 I3 (envoi scinde) : un colis scinde en deux via les services colis proprietaires, une expedition par colis, scans colis canoniques.
 * @impact-areas  staging-only, logistics, economic-engine, recette
 */
'use strict';
const { ORDERS, PRODUCTS, SPLIT, ACTORS } = require('./data');

const q1 = async (c, sql, params = []) => (await c.query(sql, params)).rows[0] || null;
const actor = async (db, key) => {
  const a = ACTORS.find(x => x.key === key);
  const u = await q1(db, 'SELECT id, full_name FROM users WHERE email=$1', [a.email]);
  return { id: u.id, role: a.role, full_name: u.full_name };
};
const parcelOfLine = (db, product) => q1(db, `SELECT p.id, p.reference, p.status::text AS status FROM parcels p
    JOIN parcel_items pi ON pi.parcel_id=p.id JOIN order_items oi ON oi.id=pi.order_item_id
    JOIN orders o ON o.id=oi.order_id JOIN products pr ON pr.id=oi.product_id
   WHERE o.reference=$1 AND pr.product_ref=$2 AND p.status<>'cancelled' LIMIT 1`, [SPLIT.order, PRODUCTS[product].ref]);

const splitParcelStep = {
  id: 'split.parcels', deps: [`ops.cash-confirm.${SPLIT.order}`],
  inspect: async ({ db }) => {
    const { rows } = await db.query(`SELECT p.id, COUNT(pi.*)::int AS items FROM parcels p JOIN orders o ON o.id=p.order_id
        LEFT JOIN parcel_items pi ON pi.parcel_id=p.id WHERE o.reference=$1 AND p.status<>'cancelled' GROUP BY p.id`, [SPLIT.order]);
    return { done: rows.length === 2 && rows.every(r => r.items === 1), detail: rows };
  },
  apply: async ({ db, shared }) => {
    const items = require('../../../services/parcel-item-mutation-service');
    const { createHubParcel } = require('../../../services/parcel-mutation-service');
    const { generateParcelRef } = require('../../../utils/reference');
    const order = await q1(db, 'SELECT id FROM orders WHERE reference=$1', [SPLIT.order]);
    const from = await q1(db, `SELECT p.id FROM parcels p WHERE p.order_id=$1 AND p.status<>'cancelled' ORDER BY p.created_at LIMIT 1`, [order.id]);
    const moved = await q1(db, `SELECT oi.id FROM order_items oi JOIN products pr ON pr.id=oi.product_id WHERE oi.order_id=$1 AND pr.product_ref=$2`, [order.id, PRODUCTS.P2.ref]);
    const to = await createHubParcel(db, { reference: await generateParcelRef(db), orderId: order.id, type: 'partial', notes: 'RCT1 I3 : envoi scinde (fait simule)' });
    await items.reassignParcelItem(db, { fromParcelId: from.id, toParcelId: to.id, orderItemId: moved.id, actorId: shared.adminId, reason: 'RCT1 I3 : scission du colis (recette)' });
    return { writes: 2 };
  },
};

const shipScan = (sh) => ({
  id: `split.scan.shipped.${sh.product}`, deps: ['split.parcels'],
  inspect: async ({ db }) => {
    const p = await parcelOfLine(db, sh.product);
    return { done: !!p && ['shipped', 'in_transit', 'available', 'collected'].includes(p.status), detail: p };
  },
  apply: async ({ db }) => {
    // Sequence physique complete (preparation -> emballe -> expedie) : aucune etape rattrapee, donc aucun incident de rattrapage.
    const p = await parcelOfLine(db, sh.product);
    const hub = await actor(db, 'agent-hub');
    const engine = require('../../../services/scan-engine');
    const events = [...(p.status === 'draft' ? ['preparation_started'] : []), 'packed', 'shipped'];
    for (const event_type of events) {
      const res = await engine.processScan({
        parcel_id: p.id, event_type, scanned_by: hub.id, actor_name: hub.full_name, actor_role: 'hub_agent',
        location: 'KM', notes: `RCT1 I3 ${event_type} (fait simule)`, metadata: { source: 'rct1-engine' },
      });
      if (!res.success || (res.incidents || []).length) throw new Error(`RCT1_SCAN_REFUSED:${event_type}:` + JSON.stringify(res.incidents || res.error || {}).slice(0, 200));
    }
    return { writes: events.length };
  },
});

const shipmentStep = (sh) => ({
  id: `split.shipment.${sh.ref}`, deps: [`split.scan.shipped.${sh.product}`],
  inspect: async ({ db }) => {
    const row = await q1(db, `SELECT s.status, s.freight_kmf, (SELECT COUNT(*)::int FROM customs_shipment_parcels sp WHERE sp.shipment_id=s.id) AS parcels
      FROM customs_shipments s WHERE s.reference=$1`, [sh.ref]);
    return { done: !!row && row.parcels === 1 && Number(row.freight_kmf) === sh.freight_kmf && ['declared', 'confirmed'].includes(row.status), detail: row };
  },
  apply: async ({ db, shared }) => {
    const p = await parcelOfLine(db, sh.product);
    const market = await q1(db, "SELECT id FROM markets WHERE code='KM'");
    await require('../../../services/customs-shipment-service').createShipment(require('../../../db'), {
      reference: sh.ref, shipment_date: new Date().toISOString().slice(0, 10), transitaire_name: 'RCT1 Transitaire (fictif)',
      transport_mode: 'sea', cif_value_kmf: sh.cif_value_kmf, freight_kmf: sh.freight_kmf, customs_paid_kmf: 0,
      nb_parcels: 1, parcel_ids: [p.id], notes: 'RCT1 fait simule (recette) : envoi scinde',
    }, shared.adminId, { marketId: market.id });
    return { writes: 1 };
  },
});

const transitScan = (sh) => ({
  id: `split.scan.transit.${sh.product}`, deps: [`split.shipment.${sh.ref}`],
  inspect: async ({ db }) => {
    const p = await parcelOfLine(db, sh.product);
    return { done: !!p && ['in_transit', 'available', 'collected'].includes(p.status), detail: p };
  },
  apply: async ({ db }) => {
    const p = await parcelOfLine(db, sh.product);
    const hub = await actor(db, 'agent-hub');
    const res = await require('../../../services/scan-engine').processScan({
      parcel_id: p.id, event_type: 'transit_confirmed', scanned_by: hub.id, actor_name: hub.full_name, actor_role: 'hub_agent',
      location: 'KM', notes: 'RCT1 I3 transit (fait simule)', metadata: { source: 'rct1-engine' },
    });
    if (!res.success) throw new Error('RCT1_TRANSIT_SCAN_REFUSED: ' + JSON.stringify(res.error || {}).slice(0, 200));
    return { writes: 1 };
  },
});

const steps = [splitParcelStep, ...SPLIT.shipments.flatMap(sh => [shipScan(sh), shipmentStep(sh), transitScan(sh)])];
void ORDERS;
module.exports = { steps };
