/**
 * @komerce-arch-lite
 * @role          rct1-steps-orders
 * @domain        orders
 * @layer         script
 * @owner         backend-core
 * @purpose       Etapes RCT1 de creation de commandes par le checkout canonique (service proprietaire).
 * @impact-areas  staging-only, orders, recette
 */
'use strict';
const { ORDERS, PRODUCTS, ACTORS } = require('./data');

const q1 = async (c, sql, params = []) => (await c.query(sql, params)).rows[0] || null;

// Attendu independant du transport commercial : poids x tarif business_rules (lignes IMPORT seulement).
async function expectedTransportKmf(db, lines) {
  const rule = await q1(db, "SELECT (value->>'value')::numeric AS v FROM business_rules WHERE key='SEA_KMF_PER_KG_COMMERCIAL'");
  let t = 0;
  for (const l of lines) {
    const p = PRODUCTS[l.product];
    if (p.origin === 'IMPORT') t += Math.round(p.weight_kg * l.qty * Number(rule.v));
  }
  return t;
}

const orderStep = (o) => ({
  id: `order.${o.ref}`, deps: [`actor.${o.client}`, `relay.${o.relay}`, ...o.lines.map(l => `price.KM.${l.product}`)],
  inspect: async ({ db }) => {
    const row = await q1(db, 'SELECT id, total_kmf, simulation_scope, payment_mode::text AS pm, status::text AS status FROM orders WHERE reference=$1', [o.ref]);
    const expected = o.expected_product_total_kmf + await expectedTransportKmf(db, o.lines);
    if (!row) return { done: false, detail: { expected_total_kmf: expected } };
    const lines = (await db.query('SELECT COUNT(*)::int AS n, COALESCE(SUM(quantity),0)::int AS q FROM order_items WHERE order_id=$1', [row.id])).rows[0];
    const done = row.simulation_scope === 'RCT1' && Number(row.total_kmf) === expected && row.pm === 'cash_relais' && lines.n === o.lines.length;
    return { done, detail: { id: row.id, status: row.status, observed_total_kmf: Number(row.total_kmf), expected_total_kmf: expected, scope: row.simulation_scope } };
  },
  apply: async ({ db, shared }) => {
    const actor = ACTORS.find(a => a.key === o.client);
    const user = await q1(db, 'SELECT id, full_name, phone FROM users WHERE email=$1', [actor.email]);
    const relay = await q1(db, 'SELECT id FROM relais WHERE name=$1', [o.relay]);
    const products = {};
    for (const l of o.lines) products[l.product] = await q1(db, 'SELECT id FROM products WHERE product_ref=$1', [PRODUCTS[l.product].ref]);
    // Le checkout possede sa transaction ; la reference est reservee et le perimetre RCT1 pose avant COMMIT.
    const { runOrderCheckout } = require('../../../services/order-checkout-service');
    const result = await runOrderCheckout({
      user, body: { items: o.lines.map(l => ({ product_id: products[l.product].id, quantity: l.qty })), relais_id: relay.id, payment_mode: 'cash_relais', use_wallet: false },
      internalSimulation: { scope: 'RCT1', reference: o.ref, actorId: shared.adminId, reason: `RCT1 ${o.ref} recette staging controlee` },
    });
    if (!result.ok) {
      if (result.body && result.body.code === 'RCT1_ORDER_ALREADY_EXISTS') return { writes: 0 };
      throw new Error('RCT1_CHECKOUT_REFUSED: ' + JSON.stringify(result.body).slice(0, 400));
    }
    return { writes: 1 };
  },
});

const steps = ORDERS.map(orderStep);
module.exports = { steps, orderStep, expectedTransportKmf };
