/**
 * @komerce-arch-lite
 * @role          rct1-steps-costs
 * @domain        economic-engine
 * @layer         script
 * @owner         backend-core
 * @purpose       Etapes RCT1 de couts reels : achat catalogue, saisies manuelles L1 (FICTIF), commission relais, ventilation colis.
 * @impact-areas  staging-only, economic-engine, recette
 */
'use strict';
const { MANUAL_COSTS, ACTORS, RELAY_COMMISSION_KMF } = require('./data');

const q1 = async (c, sql, params = []) => (await c.query(sql, params)).rows[0] || null;
const PROVENANCE = 'FICTIF recette RCT1';
const PURCHASE_REFS = ['RCT1-E1', 'RCT1-F', 'RCT1-G', 'RCT1-C'];
const PARCEL_REFS = ['RCT1-F', 'RCT1-E1', 'RCT1-G']; // F d'abord : la commission relais n'existe pas encore (scenario F)

const purchaseStep = (ref) => ({
  id: `cost.purchase.${ref}`, deps: [`ops.cash-confirm.${ref}`],
  inspect: async ({ db }) => {
    const r = await q1(db, `SELECT COALESCE(SUM(a.amount_kmf),0) AS total, COUNT(*)::int AS n FROM order_item_real_cost_allocations a
      JOIN orders o ON o.id=a.order_id WHERE o.reference=$1 AND a.cost_type='product_purchase'`, [ref]);
    return { done: r.n > 0, detail: { total_kmf: Number(r.total) } };
  },
  apply: async ({ db }) => {
    const o = await q1(db, 'SELECT id FROM orders WHERE reference=$1', [ref]);
    await require('../../../services/cost-allocation').allocateProductPurchaseCosts(o.id, db);
    return { writes: 1 };
  },
});

// L1 : saisie manuelle tracee, cle d'idempotence stable ; l'acteur est l'admin existant.
const manualStep = (ref, type, amount) => ({
  id: `cost.manual.${ref}.${type}`, deps: [`order.${ref}`],
  inspect: async ({ db }) => {
    const r = await q1(db, `SELECT COALESCE(SUM(a.amount_kmf),0) AS total, COUNT(*)::int AS n FROM order_item_real_cost_allocations a
      JOIN orders o ON o.id=a.order_id WHERE o.reference=$1 AND a.cost_type=$2 AND a.source='manual_entry'`, [ref, type]);
    return { done: r.n > 0 && Number(r.total) === amount, detail: { total_kmf: Number(r.total), expected_kmf: amount } };
  },
  apply: async ({ db, shared }) => {
    const o = await q1(db, 'SELECT id FROM orders WHERE reference=$1', [ref]);
    await require('../../../services/cost-allocation/manual-cost-entry-service').recordManualCost(db, {
      orderId: o.id, costType: type, amountKmf: amount, provenance: PROVENANCE,
      reason: `Scenario RCT1 ${ref} : fait simule (recette)`, idempotencyKey: `RCT1-${ref}-${type}-v1`, actorId: shared.adminId,
    });
    return { writes: 1 };
  },
});

// Ventilation colis (relais + distribution) : service proprietaire ; rejouable (supprime puis reinsere ses propres lignes).
const parcelAllocStep = (ref) => ({
  id: `cost.parcel-alloc.${ref}`, deps: [`ops.scan.${ref}.relais_received`, ...(ref === 'RCT1-F' ? [] : ['cost.relay-commission'])],
  inspect: async ({ db }) => {
    const r = await q1(db, `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE a.is_actual)::int AS actual FROM order_item_real_cost_allocations a
      JOIN orders o ON o.id=a.order_id WHERE o.reference=$1 AND a.cost_type='relay'`, [ref]);
    return { done: r.n > 0, detail: r };
  },
  apply: async ({ db }) => {
    const p = await q1(db, 'SELECT p.id FROM parcels p JOIN orders o ON o.id=p.order_id WHERE o.reference=$1 ORDER BY p.created_at LIMIT 1', [ref]);
    await require('../../../services/cost-allocation').allocateParcelRealCosts(p.id, db);
    return { writes: 1 };
  },
});

// Commission relais : composant canonique, saisie par l'admin existant avec provenance FICTIF (apres le scenario F).
const relayCommissionStep = {
  id: 'cost.relay-commission', deps: ['cost.parcel-alloc.RCT1-F'],
  inspect: async ({ db }) => {
    const r = await q1(db, "SELECT default_value, provenance, updated_by FROM cost_components WHERE key='commission_relais_kmf' AND is_active");
    return { done: !!r && Number(r.default_value) === RELAY_COMMISSION_KMF && r.provenance === PROVENANCE && !!r.updated_by, detail: r };
  },
  apply: async ({ db, shared }) => {
    await require('../../../services/cost-component-admin-service').updateComponent(
      { key: 'commission_relais_kmf' }, { default_value: RELAY_COMMISSION_KMF, provenance: PROVENANCE }, shared.adminId, db);
    return { writes: 1 };
  },
};

const steps = [
  ...PURCHASE_REFS.map(purchaseStep),
  ...Object.entries(MANUAL_COSTS).flatMap(([ref, costs]) => Object.entries(costs).map(([t, a]) => manualStep(ref, t, a))),
  relayCommissionStep,
  ...PARCEL_REFS.map(parcelAllocStep),
];
void ACTORS;
module.exports = { steps, purchaseStep, manualStep, parcelAllocStep, relayCommissionStep, PROVENANCE };
