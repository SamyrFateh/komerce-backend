/**
 * @komerce-arch-lite
 * @role          rct1-steps-markets
 * @domain        economic-engine
 * @layer         script
 * @owner         backend-core
 * @purpose       Etapes RCT1 CM/CG : provisioning canonique des marches, commande CM, controles J (MARKET_MISMATCH) et K (isolation operateur, XAF).
 * @impact-areas  staging-only, economic-engine, recette, market-control-plane
 */
'use strict';
const crypto = require('crypto');
const { actorStep } = require('./steps-foundation');
const { ACTORS, MARKET_PROVISIONING, MARKET_PROVISIONING_PARAMS, MARKET_ORDERS, PRODUCTS } = require('./data');

const q1 = async (c, sql, params = []) => (await c.query(sql, params)).rows[0] || null;
const check = (id, deps, verify) => ({ id, deps, inspect: async () => ({ done: true }), apply: async () => ({ writes: 0 }), verify });

// Le responsable d'exploitation existe AVANT le provisioning : le service canonique l'ajoute alors directement
// comme membre (aucune invitation WhatsApp/email envoyee). Compte RCT1 fictif, mot de passe aleatoire jamais conserve.
const leadStep = (m) => {
  const a = ACTORS.find(x => x.key === m.lead);
  return {
    id: `lead.${m.code}`, deps: ['admin.resolve'],
    inspect: async ({ db }) => {
      const u = await q1(db, 'SELECT id, role::text AS role FROM users WHERE email=$1', [a.email]);
      return { done: !!u && u.role === a.role, detail: u };
    },
    apply: async ({ db }) => {
      const bcrypt = require('bcryptjs');
      const hash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
      await require('../../../services/user-mutation-service').createAdminUser(db, {
        fullName: a.full_name, email: a.email, phone: a.phone, role: a.role, currencyPref: 'XAF', passwordHash: hash,
      });
      return { writes: 1 };
    },
  };
};

const marketStep = (m) => ({
  id: `market.${m.code}`, deps: ['admin.resolve', `lead.${m.code}`],
  inspect: async ({ db }) => {
    const row = await q1(db, 'SELECT code, currency, is_active, lifecycle_status FROM markets WHERE code=$1', [m.code]);
    return { done: !!row && row.is_active && row.lifecycle_status === 'ACTIVE' && row.currency === m.currency, detail: row };
  },
  apply: async ({ db, shared }) => {
    const prov = require('../../../services/market-provisioning-service');
    const lead = ACTORS.find(x => x.key === m.lead);
    const P = MARKET_PROVISIONING_PARAMS;
    const existing = await q1(db, 'SELECT lifecycle_status FROM markets WHERE code=$1', [m.code]);
    let writes = 0;
    if (!existing) {
      await prov.provisionMarket(db, {
        actorUserId: shared.adminId, code: m.code, name: m.name, currency: m.currency, minorUnit: m.minor_unit,
        centralReferentUserId: shared.adminId, financialLimits: { ...P.financial_limits },
        lead: { email: lead.email, channel: 'EMAIL' },
        paymentProvider: { ...P.payment_provider, currency: m.currency }, cashPolicy: { ...P.cash_policy },
        initialRelais: { name: m.relay.name, agent_name: null, phone: m.relay.phone, address: m.relay.address, zone: m.relay.zone,
          hours: null, island: null, island_code: null, latitude: m.relay.latitude, longitude: m.relay.longitude, photo_url: null },
        correlationId: `rct1-provision-${m.code}`,
      });
      writes++;
    }
    // Activation : la readiness plate-forme et exploitation doit etre verte (garde canonique), sinon refus.
    await prov.setMarketLifecycle(db, { actorUserId: shared.adminId, marketCode: m.code, targetStatus: 'ACTIVE', correlationId: `rct1-activate-${m.code}` });
    return { writes: writes + 1 };
  },
});

// Commande CM via checkout canonique (relais CM = ancre serveur du marche, prix pays LOCAL_ACTIVE uniquement).
const marketOrderStep = (o) => {
  const m = MARKET_PROVISIONING[o.market];
  return {
    id: `order.${o.ref}`, deps: [`market.${o.market}`, `actor.${o.client}`, ...o.lines.map(l => `price.${o.market}.${l.product}`)],
    inspect: async ({ db }) => {
      const row = await q1(db, 'SELECT id, total_kmf, simulation_scope, display_total_amount, display_currency, market_id FROM orders WHERE reference=$1', [o.ref]);
      if (!row) return { done: false, detail: null };
      return { done: row.simulation_scope === 'RCT1' && row.display_currency === o.expected_product_display.currency, detail: { id: row.id, total_kmf: Number(row.total_kmf), display: [row.display_total_amount, row.display_currency] } };
    },
    apply: async ({ db, shared }) => {
      const actor = ACTORS.find(a => a.key === o.client);
      const user = await q1(db, 'SELECT id, full_name, phone FROM users WHERE email=$1', [actor.email]);
      const relay = await q1(db, 'SELECT r.id FROM relais r JOIN markets mk ON mk.id=r.market_id WHERE mk.code=$1 AND r.name=$2', [o.market, m.relay.name]);
      const product = await q1(db, 'SELECT id FROM products WHERE product_ref=$1', [PRODUCTS[o.lines[0].product].ref]);
      const { runOrderCheckout } = require('../../../services/order-checkout-service');
      const result = await runOrderCheckout({
        user, body: { items: o.lines.map(l => ({ product_id: product.id, quantity: l.qty })), relais_id: relay.id, payment_mode: 'cash_relais', use_wallet: false },
        internalSimulation: { scope: 'RCT1', reference: o.ref, actorId: shared.adminId, reason: `RCT1 ${o.ref} recette staging controlee` },
      });
      if (!result.ok) {
        if (result.body && result.body.code === 'RCT1_ORDER_ALREADY_EXISTS') return { writes: 0 };
        throw new Error('RCT1_CHECKOUT_REFUSED: ' + JSON.stringify(result.body).slice(0, 400));
      }
      return { writes: 1 };
    },
  };
};

// J : ajouter une ligne CM dans un colis KM => 409 MARKET_MISMATCH. Preuve sous SAVEPOINT : rien n'est conserve.
const jCheck = check('check.J.market-mismatch', ['market.CM', 'ops.cash-confirm.RCT1-E1'], async ({ db, shared }) => {
  const items = require('../../../services/parcel-item-mutation-service');
  const { createHubParcel } = require('../../../services/parcel-mutation-service');
  const { generateParcelRef } = require('../../../utils/reference');
  const km = await q1(db, "SELECT id FROM orders WHERE reference='RCT1-E1'");
  const line = await q1(db, "SELECT oi.id FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.reference='RCT1-CM1' LIMIT 1");
  if (!km) return { ok: false, error: 'commande KM introuvable' };
  if (!line) return { ok: null, open_decision: true, note: 'Aucune commande CM possible : le routage canonique (services/routing.js) ne supporte que les iles ANJOUAN/MORONI/MOHELI/MAYOTTE (ISLAND_CODE_MISSING pour un relais CM). J necessite une decision produit (destinations CM/CG) ; aucune ile fictive n\'est attribuee.' };
  const before = (await q1(db, "SELECT COUNT(*)::int AS n FROM parcel_items WHERE order_item_id=$1", [line.id])).n;
  await db.query('SAVEPOINT rct1_j');
  let observed = null;
  try {
    const parcel = await createHubParcel(db, { reference: await generateParcelRef(db), orderId: km.id, type: 'partial', notes: 'RCT1 J (preuve sous savepoint)' });
    try {
      await items.addParcelItemTraced(db, { parcelId: parcel.id, orderItemId: line.id, quantity: 1, actorId: shared.adminId });
      observed = { accepted: true };
    } catch (e) { observed = { code: e.code, status: e.status }; }
  } finally { await db.query('ROLLBACK TO SAVEPOINT rct1_j'); await db.query('RELEASE SAVEPOINT rct1_j'); }
  const after = (await q1(db, "SELECT COUNT(*)::int AS n FROM parcel_items WHERE order_item_id=$1", [line.id])).n;
  return { ok: observed.code === 'MARKET_MISMATCH' && observed.status === 409 && before === after, observed, parcel_items_before: before, parcel_items_after: after, expected: '409 MARKET_MISMATCH, rien conserve' };
});

// K : l'operateur KM ne voit ni CM ni CG (scope canonique + 403 du middleware) ; la commande CM est affichee en XAF.
const kCheck = check('check.K.isolation', ['market.CM', 'actor.operator-km', 'market.CG'], async ({ db }) => {
  const scope = require('../../../middleware/require-market-scope');
  const op = ACTORS.find(a => a.key === 'operator-km');
  const user = await q1(db, 'SELECT id FROM users WHERE email=$1', [op.email]);
  const authorized = await scope.resolveAuthorizedMarkets(user.id);
  const markets = (await db.query("SELECT id, code FROM markets WHERE code IN ('KM','CM','CG')")).rows;
  const byCode = Object.fromEntries(markets.map(r => [r.code, r.id]));
  const visible = markets.filter(r => authorized.has(r.id)).map(r => r.code);
  const denied = {};
  for (const code of ['CM', 'CG']) {
    let status = null;
    const req = { user: { id: user.id }, authorizedMarkets: authorized };
    const res = { status(s) { status = s; return this; }, json() { return this; } };
    await scope.requireMarketScope(() => byCode[code])(req, res, () => { status = 200; });
    denied[code] = status;
  }
  const scopedOrders = (await db.query("SELECT reference FROM orders WHERE simulation_scope='RCT1' AND market_id = ANY($1::uuid[]) AND reference='RCT1-CM1'", [[...authorized]])).rows.length;
  const cm = await q1(db, "SELECT display_total_amount, display_currency, total_kmf, market_id FROM orders WHERE reference='RCT1-CM1'");
  const xaf = !cm || (cm.display_currency === 'XAF' && cm.market_id === byCode.CM);
  const ok = visible.join() === 'KM' && denied.CM === 403 && denied.CG === 403 && scopedOrders === 0 && xaf;
  return { ok, operator_km_markets: visible, http_status_cm: denied.CM, http_status_cg: denied.CG, cm_order_visible_to_km: scopedOrders, cm_order_exists: !!cm, xaf_display_proof: cm ? 'prouve' : 'non prouve : pas de commande CM (routage)',
    cm_order_display: cm && [cm.display_total_amount, cm.display_currency], cm_total_kmf: cm && Number(cm.total_kmf) };
});

const steps = [
  ...ACTORS.filter(a => a.lead_of).map(actorStep),
  ...Object.values(MARKET_PROVISIONING).flatMap(m => [leadStep(m), marketStep(m)]),
  jCheck, kCheck,
];
module.exports = { steps, leadStep, marketStep, marketOrderStep };
