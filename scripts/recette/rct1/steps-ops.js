/**
 * @komerce-arch-lite
 * @role          rct1-steps-ops
 * @domain        orders
 * @layer         script
 * @owner         backend-core
 * @purpose       Etapes RCT1 d'operations (encaissement, expeditions, douane, scans, remise, couts) via les services proprietaires.
 * @impact-areas  staging-only, orders, logistics, economic-engine, recette
 */
'use strict';
const { ORDERS, SHIPMENTS, MANUAL_COSTS, ACTORS, RELAY_COMMISSION_KMF } = require('./data');

const q1 = async (c, sql, params = []) => (await c.query(sql, params)).rows[0] || null;
const actorId = async (db, key) => (await q1(db, 'SELECT id FROM users WHERE email=$1', [ACTORS.find(a => a.key === key).email])).id;
const PROVENANCE = 'FICTIF recette RCT1';
const IMPORT_ORDERS = ORDERS.filter(o => o.lines.some(l => l.product === 'P1')).map(o => o.ref);

// Un acteur canonique par transition : admin existant pour l'encaissement et les expeditions, agent hub / relais pour les scans.
const confirmCashStep = (o) => ({
  id: `ops.cash-confirm.${o.ref}`, deps: [`order.${o.ref}`],
  inspect: async ({ db }) => {
    const row = await q1(db, `SELECT o.id, o.status::text AS status, o.payment_status::text AS payment_status,
        (SELECT COUNT(*)::int FROM parcels p WHERE p.order_id=o.id) AS parcels
      FROM orders o WHERE o.reference=$1`, [o.ref]);
    if (!row) return { done: false, detail: 'order_missing' };
    return { done: row.payment_status === 'paid' && row.parcels > 0, detail: row };
  },
  apply: async ({ shared }) => {
    const { confirmCashAndCreateParcel } = require('../../../services/parcel-auto-create-service');
    const res = await confirmCashAndCreateParcel(o.ref, { id: shared.adminId, role: 'admin', full_name: 'Admin Komerce' });
    if (res.state === 'pending_second_approval') throw new Error('RCT1_CASH_SECOND_APPROVAL_REQUIRED');
    if (res.parcelResult && res.parcelResult.success === false) throw new Error('RCT1_PARCEL_CREATION_FAILED: ' + res.parcelResult.reason);
    return { writes: 1 };
  },
});

// Expedition groupee (customs_shipments) : fret, colis rattaches ; douane declaree seulement si le montant est connu (0 confirme inclus).
const shipmentStep = (sh) => ({
  id: `ops.shipment.${sh.ref}`, deps: sh.orders.map(r => `ops.scan.${r}.shipped`),
  inspect: async ({ db }) => {
    const row = await q1(db, `SELECT s.id, s.status, s.customs_paid_kmf, s.freight_kmf, s.is_active,
        (SELECT COUNT(*)::int FROM customs_shipment_parcels sp WHERE sp.shipment_id=s.id) AS parcels
      FROM customs_shipments s WHERE s.reference=$1`, [sh.ref]);
    // Declaree puis confirmee a l'arrivee relais (statut aval) : les deux etats prouvent la declaration.
    const statusOk = sh.customs_paid_kmf === null ? row && row.status === 'pending' : row && ['declared', 'confirmed'].includes(row.status);
    const done = !!row && row.parcels === sh.orders.length && !!statusOk && Number(row.freight_kmf) === sh.freight_kmf;
    return { done, detail: row };
  },
  apply: async ({ db, shared }) => {
    const svc = require('../../../services/customs-shipment-service');
    const parcelIds = [];
    for (const r of sh.orders) parcelIds.push((await q1(db, 'SELECT p.id FROM parcels p JOIN orders o ON o.id=p.order_id WHERE o.reference=$1 ORDER BY p.created_at LIMIT 1', [r])).id);
    const pool = require('../../../db');
    const market = await q1(db, "SELECT id FROM markets WHERE code='KM'");
    await svc.createShipment(pool, {
      reference: sh.ref, shipment_date: new Date().toISOString().slice(0, 10), transitaire_name: 'RCT1 Transitaire (fictif)',
      transport_mode: 'sea', cif_value_kmf: sh.cif_value_kmf, freight_kmf: sh.freight_kmf,
      ...(sh.customs_paid_kmf === null ? {} : { customs_paid_kmf: sh.customs_paid_kmf }),
      nb_parcels: parcelIds.length, parcel_ids: parcelIds, notes: 'RCT1 fait simule (recette)',
    }, shared.adminId, { marketId: market.id });
    return { writes: 1 };
  },
});

// Frais transitaire/port (append-only, idempotent par cle) : fait simule S avec piece fictive.
const forwarderFeeStep = (sh) => ({
  id: `ops.fee.${sh.ref}`, deps: [`ops.shipment.${sh.ref}`],
  inspect: async ({ db }) => {
    const row = await q1(db, `SELECT f.amount_kmf FROM customs_shipment_fees f JOIN customs_shipments s ON s.id=f.shipment_id
      WHERE s.reference=$1 AND f.idempotency_key=$2`, [sh.ref, `RCT1-${sh.ref}-forwarder-v1`]);
    return { done: !!row && Number(row.amount_kmf) === sh.forwarder_fee_kmf, detail: row };
  },
  apply: async ({ db, shared }) => {
    const s = await q1(db, 'SELECT id FROM customs_shipments WHERE reference=$1', [sh.ref]);
    await require('../../../services/customs-shipment-fee-service').recordFee(require('../../../db'), s.id, {
      fee_type: 'forwarder', kind: 'charge', currency: 'KMF', amount_kmf: sh.forwarder_fee_kmf,
      proof_ref: `FICTIF RCT1 ${sh.ref} piece transitaire`, idempotency_key: `RCT1-${sh.ref}-forwarder-v1`,
    }, shared.adminId);
    return { writes: 1 };
  },
});

// Scans logistiques canoniques (recordScan) : le statut commande en decoule via parcelSync / machine d'etats.
const scanStep = ({ ref, step, actor, deps }) => ({
  id: `ops.scan.${ref}.${step}`, deps,
  inspect: async ({ db }) => {
    const row = await q1(db, 'SELECT COUNT(*)::int AS n FROM scans s JOIN orders o ON o.id=s.order_id WHERE o.reference=$1 AND s.step=$2', [ref, step]);
    return { done: row.n > 0, detail: row };
  },
  apply: async ({ db }) => {
    const { recordScan } = require('../../../services/scan-operations');
    const id = await actorId(db, actor);
    const role = ACTORS.find(a => a.key === actor).role;
    const res = await recordScan({ scan_code: ref, step, location: 'RCT1 recette', notes: 'RCT1 scan canonique' }, { id, role }, 'rct1-engine');
    if (res.status >= 400) throw new Error('RCT1_SCAN_REFUSED: ' + JSON.stringify(res.body).slice(0, 300));
    return { writes: 1 };
  },
});

// Remise : code retrait reemis par l'admin (service proprietaire, motif trace) puis remise par l'agent relais ; le code n'est jamais journalise.
const collectStep = (ref) => ({
  id: `ops.collect.${ref}`, deps: [`ops.scan.${ref}.relais_received`],
  inspect: async ({ db }) => {
    const row = await q1(db, "SELECT status::text AS status FROM orders WHERE reference=$1", [ref]);
    return { done: !!row && row.status === 'collected', detail: row };
  },
  apply: async ({ db, shared }) => {
    const order = await q1(db, 'SELECT id FROM orders WHERE reference=$1', [ref]);
    const agent = { id: await actorId(db, 'agent-relais-km'), role: 'agent_relais' };
    const secret = require('../../../services/pickup-secret-service');
    const regen = await secret.regenerateCode({ orderId: order.id, adminId: shared.adminId, reason: 'RCT1 recette : remise simulee au relais' });
    const code = regen && (regen.code || (regen.body && regen.body.code));
    if (!code) throw new Error('RCT1_PICKUP_CODE_UNAVAILABLE');
    const res = await require('../../../services/pickup-collection-service').collectByPickupCode({ code, user: agent, collectedByName: 'RCT1 Client KM' });
    if (res.status >= 400) throw new Error('RCT1_COLLECT_REFUSED: ' + JSON.stringify(res.body).slice(0, 300));
    return { writes: 1 };
  },
});

// Groupage possible seulement pour des colis expedies : shipped -> expedition -> in_transit.
const importScans = (ref) => [
  { ref, step: 'shipped', actor: 'agent-hub', deps: [`ops.cash-confirm.${ref}`] },
  { ref, step: 'in_transit', actor: 'agent-hub', deps: [`ops.shipment.${SHIPMENTS.find(s => s.orders.includes(ref)).ref}`] },
];

const steps = [
  ...ORDERS.map(confirmCashStep),
  ...SHIPMENTS.map(shipmentStep),
  ...SHIPMENTS.filter(s => s.forwarder_fee_kmf).map(forwarderFeeStep),
  ...IMPORT_ORDERS.flatMap(importScans).map(scanStep),
  // Arrivee relais : import declare (SH2) apres transit ; local (G) directement apres preparation.
  ...['RCT1-E1', 'RCT1-F'].map(ref => scanStep({ ref, step: 'relais_received', actor: 'agent-relais-km', deps: [`ops.scan.${ref}.in_transit`, `ops.fee.RCT1-SH2`] })),
  scanStep({ ref: 'RCT1-G', step: 'relais_received', actor: 'agent-relais-km', deps: ['ops.cash-confirm.RCT1-G'] }),
  ...['RCT1-E1', 'RCT1-F', 'RCT1-G'].map(collectStep),
];
module.exports = { steps, confirmCashStep, shipmentStep, forwarderFeeStep, scanStep, collectStep, PROVENANCE, MANUAL_COSTS, RELAY_COMMISSION_KMF };
