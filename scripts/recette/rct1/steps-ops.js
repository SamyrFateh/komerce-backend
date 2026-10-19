/**
 * @komerce-arch-lite
 * @role          rct1-steps-ops
 * @domain        orders
 * @layer         script
 * @owner         backend-core
 * @purpose       Etapes RCT1 d'operations (encaissement cash, colis, achats) via les services proprietaires.
 * @impact-areas  staging-only, orders, logistics, recette
 */
'use strict';
const { ORDERS } = require('./data');

const q1 = async (c, sql, params = []) => (await c.query(sql, params)).rows[0] || null;

// Un acteur canonique par transition : l'admin staging existant (role admin) pour l'encaissement
// et la creation de colis, comme l'ecran Control Tower.
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

const steps = ORDERS.map(confirmCashStep);
module.exports = { steps, confirmCashStep };
