'use strict';
const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'ci-test-secret-not-for-prod';
const PFX = 'itest+';
let db;
const getDb = () => (db = db || require('../../../db'));

// Hash bcrypt coût 4 de 'ci-placeholder-no-login' — invalide pour tout vrai login
const CI_PLACEHOLDER_HASH = '$2a$04$AYmAyvzy6sAbPHhY01nPau5qvXBxnD/DFrgbpUzd5QXDR3VgjkISm';

async function createUser(opts = {}) {
  const role = opts.role || 'client';
  const phone = opts.phone || `+2693${Math.floor(1000000 + Math.random()*8999999)}`;
  const email = `${PFX}${role}.${Date.now()}.${Math.random().toString(36).slice(2,8)}@test.local`;
  const { rows } = await getDb().query(
    `INSERT INTO users (email, full_name, phone, role, relais_id, password_hash)
     VALUES ($1,$2,$3,$4::public.user_role,$5,$6)
     RETURNING id, email, phone, role`,
    [email, `ITest ${role}`, phone, role, opts.relais_id || null, CI_PLACEHOLDER_HASH]
  );
  const u = rows[0];
  const jti = opts.jti || `itest-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  return { ...u, jti, token: tokenFor(u.id, { jti }) };
}
function tokenFor(id, { jti, method = 'integration-test' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({
    id,
    jti: jti || `itest-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    auth_time: now,
    amr: [String(method)],
    token_use: 'session',
  }, SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}
async function revoke(jti) {
  await getDb().query(`INSERT INTO revoked_tokens (jti, expires_at) VALUES ($1, now()+interval '1 hour') ON CONFLICT DO NOTHING`, [jti]);
}
async function cleanup() {
  try { await getDb().query(`DELETE FROM users WHERE email LIKE $1`, [`${PFX}%`]); } catch(_){}
}

// ─────────────────────────────────────────────────────────────────────────────
// POST-O8 business fixtures (real-DB seam tests). Everything created here is
// tagged with the ITEST_TAG so cleanupBusinessFixtures() is deterministic and
// never touches data it did not create.
// ─────────────────────────────────────────────────────────────────────────────
const ITEST_TAG = 'itest-post-o8';

async function resolveTestMarketId(opts = {}) {
  if (opts.market_id) return opts.market_id;
  const marketCode = String(opts.market_code || 'KM').trim().toUpperCase();
  const { rows } = await getDb().query(
    `SELECT id FROM markets WHERE code = $1 AND is_active = TRUE LIMIT 1`,
    [marketCode]
  );
  if (!rows[0]) {
    throw new Error(`ITest reference market ${marketCode} is missing; run scripts/ci-db-bootstrap.js`);
  }
  return rows[0].id;
}

async function createTestRelais(opts = {}) {
  const marketId = await resolveTestMarketId(opts);
  const { rows } = await getDb().query(
    `INSERT INTO relais (name, agent_name, phone, address, island, market_id, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING *`,
    [
      opts.name || `${ITEST_TAG} relais`,
      opts.agent_name || `${ITEST_TAG} agent`,
      opts.phone || `+2693${Math.floor(1000000 + Math.random()*8999999)}`,
      opts.address || 'ITest address, Moroni',
      opts.island || 'Ngazidja',
      marketId,
    ]
  );
  return rows[0];
}

async function resolveOrderMarketId(opts = {}) {
  if (!opts.relais_id) {
    throw new Error('ITest order requires relais_id so market authority can be resolved');
  }
  const { rows } = await getDb().query(
    `SELECT market_id FROM relais WHERE id = $1 LIMIT 1`,
    [opts.relais_id]
  );
  if (!rows[0]?.market_id) {
    throw new Error(`ITest relais ${opts.relais_id} has no market authority`);
  }
  const relayMarketId = rows[0].market_id;
  if (opts.market_id && String(opts.market_id) !== String(relayMarketId)) {
    throw new Error(`ITest order market ${opts.market_id} does not match relais market ${relayMarketId}`);
  }
  return relayMarketId;
}

async function createLegacyProduct(opts = {}) {
  const { rows } = await getDb().query(
    `INSERT INTO products (name, price_kmf, price_eur, stock, inventory_model, is_active)
     VALUES ($1,$2,$3,$4,'LEGACY_VARIANTS',true) RETURNING *`,
    [
      opts.name || `${ITEST_TAG} product`,
      opts.price_kmf != null ? opts.price_kmf : 10000,
      opts.price_eur != null ? opts.price_eur : 20,
      opts.stock != null ? opts.stock : 50,
    ]
  );
  return rows[0];
}

async function createSkuProduct(opts = {}) {
  const { rows: [product] } = await getDb().query(
    `INSERT INTO products (name, price_kmf, price_eur, stock, inventory_model, has_variants, is_active)
     VALUES ($1,$2,$3,0,'SKU',true,true) RETURNING *`,
    [ opts.name || `${ITEST_TAG} sku product`, opts.price_kmf || 10000, opts.price_eur || 20 ]
  );
  const { rows: [sku] } = await getDb().query(
    `INSERT INTO product_skus (product_id, sku, variant_combo, stock, is_active)
     VALUES ($1,$2,$3,$4,true) RETURNING *`,
    [ product.id, `${ITEST_TAG}-sku`, opts.variant_combo || null, opts.sku_stock != null ? opts.sku_stock : 50 ]
  );
  return { product, sku };
}

async function createPendingOrder(opts = {}) {
  const ref = opts.reference || `ITEST-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  const marketId = await resolveOrderMarketId(opts);
  const { rows } = await getDb().query(
    `INSERT INTO orders
       (reference, user_id, relais_id, market_id, total_kmf, total_eur,
        payment_mode, payment_status, status, paypal_order_id, cash_ref_code, stripe_payment_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7::payment_mode,'pending','pending',$8,$9,$10)
     RETURNING *`,
    [
      ref,
      opts.user_id || null,
      opts.relais_id,
      marketId,
      opts.total_kmf != null ? opts.total_kmf : 10000,
      opts.total_eur != null ? opts.total_eur : 20,
      opts.payment_mode || 'paypal_eur',
      opts.paypal_order_id || null,
      opts.cash_ref_code || null,
      opts.stripe_payment_id || null,
    ]
  );
  return rows[0];
}

async function createOrderItem(opts = {}) {
  const { rows } = await getDb().query(
    `INSERT INTO order_items (order_id, product_id, quantity, price_kmf, sku_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [ opts.order_id, opts.product_id, opts.quantity || 1, opts.price_kmf != null ? opts.price_kmf : 10000, opts.sku_id || null ]
  );
  return rows[0];
}

async function cleanupBusinessFixtures() {
  const d = getDb();
  // Order matters (FK). Only touch rows we tagged.
  try {
    await d.query(
      `DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE reference LIKE 'ITEST-%')`
    );
    await d.query(`DELETE FROM stripe_events_processed WHERE stripe_event_id LIKE 'EVT-itest%' OR payload_summary::text LIKE '%ITEST-%'`).catch(()=>{});
    await d.query(`DELETE FROM paypal_events_processed WHERE event_id LIKE 'EVT-itest%' OR payload_summary::text LIKE '%ITEST-%'`).catch(()=>{});
    await d.query(`DELETE FROM orders WHERE reference LIKE 'ITEST-%'`);
    await d.query(`DELETE FROM product_skus WHERE sku LIKE '${ITEST_TAG}%'`).catch(()=>{});
    await d.query(`DELETE FROM products WHERE name LIKE '${ITEST_TAG}%'`);
    await d.query(`DELETE FROM relais WHERE name LIKE '${ITEST_TAG}%' OR agent_name LIKE '${ITEST_TAG}%'`);
  } catch (e) { /* best-effort */ }
}

module.exports = {
  createUser, tokenFor, revoke, cleanup,
  // POST-O8 business fixtures
  ITEST_TAG,
  resolveTestMarketId, resolveOrderMarketId, createTestRelais, createLegacyProduct, createSkuProduct,
  createPendingOrder, createOrderItem, cleanupBusinessFixtures,
};
