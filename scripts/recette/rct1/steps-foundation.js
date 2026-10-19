/**
 * @komerce-arch-lite
 * @role          rct1-steps-foundation
 * @domain        economic-engine
 * @layer         script
 * @owner         backend-core
 * @purpose       Etapes RCT1 de socle (admin, relais, comptes, catalogue) via services canoniques.
 * @impact-areas  staging-only, economic-engine, recette
 */
'use strict';
const crypto = require('crypto');
const { ACTORS, RELAYS, PRODUCTS } = require('./data');

// Les services sont resolus a l'usage : le module reste chargeable (tests) sans connexion DB.
const svc = {
  relais: () => require('../../../services/relais-mutation-service'),
  users: () => require('../../../services/user-mutation-service'),
  operators: () => require('../../../services/market-operator-provisioning'),
  productAdmin: () => require('../../../services/product-admin-service'),
  sourcing: () => require('../../../services/catalog-product-mutation-service'),
  localStock: () => require('../../../services/local-stock-service'),
  bcrypt: () => require('bcryptjs'),
};

const q1 = async (c, sql, params = []) => (await c.query(sql, params)).rows[0] || null;
const marketId = async (c, code) => (await q1(c, 'SELECT id FROM markets WHERE code=$1 AND is_active', [code]) || {}).id;

const adminStep = {
  id: 'admin.resolve', deps: [],
  // Reutilise l'admin staging existant ; aucune creation, jamais un second administrateur.
  inspect: async ({ db, shared }) => {
    const a = await q1(db, "SELECT id, full_name FROM users WHERE role::text='admin' AND full_name='Admin Komerce' ORDER BY created_at LIMIT 1");
    if (a) shared.adminId = a.id;
    return { done: !!a, detail: a ? { admin: a.full_name } : 'admin_existant_introuvable' };
  },
  apply: async () => { throw new Error('RCT1_ADMIN_NOT_CREATED_BY_ENGINE: utiliser un admin staging existant'); },
};

const relayStep = (r) => ({
  id: `relay.${r.name}`, deps: ['admin.resolve'],
  inspect: async ({ db }) => {
    const row = await q1(db, 'SELECT id, is_active, market_id, island_code FROM relais WHERE name=$1', [r.name]);
    return { done: !!row && row.is_active && row.island_code === r.island_code, detail: row ? { id: row.id, island_code: row.island_code } : null };
  },
  apply: async ({ db }) => {
    const mid = await marketId(db, r.market);
    if (!mid) throw new Error('RCT1_MARKET_MISSING: ' + r.market);
    const existing = await q1(db, 'SELECT id FROM relais WHERE name=$1', [r.name]);
    if (existing) {
      // Code ile conforme aux destinations du checkout (ANJOUAN, MORONI, MOHELI, MAYOTTE).
      await svc.relais().updateRelais(db, { marketId: mid, relaisId: existing.id, patch: { islandCode: r.island_code, island: r.island } });
      return { writes: 1 };
    }
    await svc.relais().createRelais(db, {
      marketId: mid, name: r.name, phone: r.phone, address: r.address, island: r.island, islandCode: r.island_code,
      agentName: null, zone: 'RCT1', hours: null, latitude: null, longitude: null, photoUrl: null,
    });
    return { writes: 1 };
  },
});

const actorStep = (a) => ({
  id: `actor.${a.key}`, deps: ['admin.resolve', ...(a.relay ? [`relay.${a.relay}`] : [])],
  inspect: async ({ db }) => {
    const u = await q1(db, 'SELECT id, role::text AS role, relais_id FROM users WHERE email=$1', [a.email]);
    if (!u) return { done: false, detail: null };
    let ok = u.role === a.role;
    if (ok && a.relay) {
      const r = await q1(db, 'SELECT id FROM relais WHERE name=$1', [a.relay]);
      ok = !!r && u.relais_id === r.id;
    }
    if (ok && a.role === 'market_operator') {
      const s = await q1(db, `SELECT 1 AS ok FROM operator_market_scopes s JOIN markets m ON m.id=s.market_id
                               WHERE s.user_id=$1 AND m.code=$2 AND s.revoked_at IS NULL AND s.role=$3`, [u.id, a.market, a.scope_role]);
      ok = !!s;
    }
    return { done: ok, detail: { id: u.id, role: u.role } };
  },
  apply: async ({ db, shared }) => {
    let user = await q1(db, 'SELECT id FROM users WHERE email=$1', [a.email]);
    let writes = 0;
    if (!user) {
      // Mot de passe aleatoire jamais affiche ni conserve : acces par reinitialisation admin hors conversation.
      const hash = await svc.bcrypt().hash(crypto.randomBytes(24).toString('hex'), 10);
      const { rows: [created] } = await svc.users().createAdminUser(db, {
        fullName: a.full_name, email: a.email, phone: a.phone, role: a.role, currencyPref: a.market === 'KM' ? 'KMF' : 'XAF', passwordHash: hash,
      });
      user = created; writes++;
    }
    if (a.role === 'market_operator') {
      const g = await svc.operators().grantOperatorScope(db, { userId: user.id, marketCode: a.market, scopeRole: a.scope_role, grantedBy: shared.adminId });
      if (!['granted', 'replaced', 'unchanged'].includes(g.status)) throw new Error('RCT1_SCOPE_REFUSED: ' + g.status);
      if (g.status !== 'unchanged') writes++;
    }
    if (a.relay) {
      const r = await q1(db, 'SELECT id FROM relais WHERE name=$1', [a.relay]);
      const res = await svc.users().assignAgentRelais(db, { userId: user.id, relaisId: r.id });
      if (!['assigned', 'already'].includes(res.status)) throw new Error('RCT1_AGENT_RELAIS_REFUSED: ' + res.status);
      if (res.status === 'assigned') writes++;
    }
    return { writes };
  },
});

// Le stock est consomme par les commandes RCT1 : une fois commande, il n'est plus compare ni reecrit.
const consumedSql = `SELECT EXISTS(SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.product_id=$1 AND o.simulation_scope='RCT1') AS c`;
const productStep = (key, p) => ({
  id: `product.${key}`, deps: ['admin.resolve'],
  inspect: async ({ db }) => {
    const row = await q1(db, 'SELECT id, is_active, is_available, price_kmf, cost_kmf, weight_kg, stock FROM products WHERE product_ref=$1', [p.ref]);
    const consumed = row ? (await q1(db, consumedSql, [row.id])).c : false;
    const ok = !!row && row.is_active && row.is_available && Number(row.price_kmf) === p.price_kmf && Number(row.weight_kg) === p.weight_kg && Number(row.cost_kmf) === p.cost_kmf && (consumed ? Number(row.stock) <= p.stock : Number(row.stock) === p.stock);
    if (!ok) return { done: false, detail: row ? { id: row.id, price_kmf: Number(row.price_kmf) } : null };
    if (p.origin === 'LOCAL_STOCK' && !consumed) {
      const mid = await marketId(db, p.stock_market);
      const s = await q1(db, 'SELECT qty_physical, commercial_exposure FROM local_stock WHERE product_id=$1 AND market_id=$2', [row.id, mid]);
      if (!s || Number(s.qty_physical) !== p.local_stock_qty || s.commercial_exposure !== 'ENABLED') return { done: false, detail: { id: row.id, local_stock: s } };
    }
    return { done: true, detail: { id: row.id } };
  },
  apply: async ({ db, shared }) => {
    let writes = 0;
    let row = await q1(db, 'SELECT id, cost_kmf, stock FROM products WHERE product_ref=$1', [p.ref]);
    if (!row) {
      const res = await svc.productAdmin().createProduct(require('../../../db'), {
        product_ref: p.ref, name: p.name, category: p.category, subcategory: p.subcategory, description: p.description,
        price_kmf: p.price_kmf, weight_kg: p.weight_kg, stock: p.stock,
        is_active: true, is_available: true,
      }, { id: shared.adminId });
      if (res.status >= 400) throw new Error('RCT1_PRODUCT_CREATE_REFUSED: ' + JSON.stringify(res.body).slice(0, 300));
      row = { id: res.body.id, cost_kmf: null, stock: p.stock }; writes++;
    }
    const consumed = (await q1(db, consumedSql, [row.id])).c;
    if (!consumed && Number(row.stock) !== p.stock) {
      // Stock catalogue (controle legacy du checkout) : mise a jour par le service proprietaire.
      const up = await svc.productAdmin().updateProduct(require('../../../db'), row.id, { stock: p.stock }, { id: shared.adminId });
      if (up.status >= 400) throw new Error('RCT1_PRODUCT_STOCK_REFUSED: ' + JSON.stringify(up.body).slice(0, 200));
      writes++;
    }
    if (Number(row.cost_kmf) !== p.cost_kmf) {
      // Cout d'achat catalogue : source du collecteur d'achat (lock-purchase), donnee de test T.
      await svc.sourcing().updateSourcingFields(db, row.id, { cost_price_kmf: p.cost_kmf });
      writes++;
    }
    if (p.origin === 'LOCAL_STOCK' && !consumed) {
      const mid = await marketId(db, p.stock_market);
      await svc.localStock().setLocalStock({ productId: row.id, marketId: mid, qtyPhysical: p.local_stock_qty, actorUserId: shared.adminId });
      await svc.localStock().setLocalStockExposure(row.id, mid, 'ENABLED');
      writes += 2;
    }
    return { writes };
  },
});

const steps = [
  adminStep,
  ...RELAYS.map(relayStep),
  ...ACTORS.map(actorStep),
  ...Object.entries(PRODUCTS).map(([k, p]) => productStep(k, p)),
];
module.exports = { steps, adminStep, relayStep, actorStep, productStep };
