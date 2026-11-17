'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * triggerPurchasing : aucune attente lente dans la transaction, erreur de connexion non fatale, savepoint propre,
 * notification no_supplier apres COMMIT, rejeu idempotent. PostgreSQL reel.
 * Incident source : staging 16/11 12:02:22Z, uncaughtException « idle-in-transaction timeout » 20 s apres une confirmation cash.
 */

const hasEnv = Boolean(process.env.DATABASE_URL);
if (!hasEnv) {
  describe.skip('triggerPurchasing idle-in-transaction (REAL_DB) — SKIPPED: no DATABASE_URL', () => { it('requires DATABASE_URL', () => {}); });
} else {
  jest.mock('../../services/purchase-line-snapshot', () => {
    const actual = jest.requireActual('../../services/purchase-line-snapshot');
    return { ...actual, loadExactSoldSku: jest.fn(actual.loadExactSoldSku), resolveExactSkuProcurementReadiness: jest.fn(actual.resolveExactSkuProcurementReadiness) };
  });
  jest.mock('../../services/notification-service', () => ({ ...jest.requireActual('../../services/notification-service'), notifyText: jest.fn(async () => ({})) }));
  const db = require('../../db');
  const snap = require('../../services/purchase-line-snapshot');
  const { notifyText } = require('../../services/notification-service');
  const { triggerPurchasing } = require('../../services/purchasing-trigger-service');
  const { confirmCashByReference } = require('../../services/payment-cash-confirm');

  const TAG = `itest-ptx-${Date.now()}`;
  const made = { orders: [], products: [], suppliers: [], relais: [], users: [] };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = async (sql, p) => (await db.query(sql, p)).rows;
  let seq = 0; const uref = () => `PX${String(Date.now()).slice(-7)}${++seq}`;
  const uncaught = [];
  const onUncaught = (e) => uncaught.push(String(e && e.message));

  let market; let relais;
  async function product({ mapped = true, n = 1 } = {}) {
    const [p] = await q(`INSERT INTO products (name, price_kmf, stock, is_active, inventory_model) VALUES ($1,10000,0,true,'SKU') RETURNING id`, [`${TAG} produit ${n}`]);
    made.products.push(p.id);
    if (mapped) {
      const [s] = await q(`INSERT INTO suppliers (name, platform, auto_order, is_active) VALUES ($1,'aliexpress',false,true) RETURNING id`, [`${TAG} fournisseur ${n}`]);
      made.suppliers.push(s.id);
      await q(`INSERT INTO product_suppliers (product_id, supplier_id, supplier_sku, supplier_price_aed, supplier_url, priority, is_active) VALUES ($1,$2,$3,12.5,'https://example.invalid/p',1,true)`, [p.id, s.id, `${TAG}-sku-${n}`]);
    }
    return p.id;
  }
  async function order(productIds, { cashRef = null, status = 'ordered', pay = 'paid', source = 'IMPORT' } = {}) {
    const [o] = await q(`INSERT INTO orders (reference, relais_id, market_id, total_kmf, payment_mode, payment_status, status, cash_ref_code)
                         VALUES ($1,$2,$3,10000,'cash_relais',$4,$5,$6) RETURNING id, reference`,
      [uref(), relais.id, market.id, pay, status, cashRef]);
    made.orders.push(o.id);
    for (const pid of productIds) await q(`INSERT INTO order_items (order_id, product_id, quantity, price_kmf, fulfillment_source) VALUES ($1,$2,1,10000,$3)`, [o.id, pid, source]);
    return o;
  }
  const lines = (orderId) => q(`SELECT pl.id FROM purchase_lines pl JOIN order_items oi ON oi.id = pl.order_item_id WHERE oi.order_id = $1 AND pl.cancelled_at IS NULL`, [orderId]);
  const idleInTx = async () => (await q(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction' AND pid <> pg_backend_pid()`))[0].n;

  beforeAll(async () => {
    process.on('uncaughtException', onUncaught);
    [market] = await q(`SELECT id FROM markets WHERE code = 'KM' LIMIT 1`);
    if (!market) { [market] = await q(`INSERT INTO markets (code, name, currency, minor_unit, is_active, lifecycle_status) VALUES ('KM','Comores','KMF',0,true,'ACTIVE') RETURNING id`); }
    [relais] = await q(`INSERT INTO relais (name, agent_name, phone, address, island, market_id, is_active) VALUES ($1,$2,'+2693999999','ITest','Ngazidja',$3,true) RETURNING id`, [`${TAG} relais`, `${TAG} agent`, market.id]);
    made.relais.push(relais.id);
  });
  afterEach(() => { snap.loadExactSoldSku.mockClear(); snap.resolveExactSkuProcurementReadiness.mockReset(); notifyText.mockClear(); });
  afterAll(async () => {
    process.removeListener('uncaughtException', onUncaught);
    await q(`ALTER DATABASE ${'"' + (await q('SELECT current_database() AS d'))[0].d + '"'} RESET idle_in_transaction_session_timeout`).catch(() => {});
    for (const id of made.orders) {
      await q('DELETE FROM alerts WHERE entity_id = $1::text OR entity_id::text = $1::text', [id]).catch(() => {});
      await q('DELETE FROM purchase_lines WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = $1)', [id]).catch(() => {});
      await q('DELETE FROM cash_collections WHERE order_id = $1', [id]).catch(() => {});
      await q('DELETE FROM order_items WHERE order_id = $1', [id]).catch(() => {});
      await q('DELETE FROM orders WHERE id = $1', [id]).catch(() => {});
    }
    for (const id of made.products) { await q('DELETE FROM product_suppliers WHERE product_id = $1', [id]).catch(() => {}); await q('DELETE FROM products WHERE id = $1', [id]).catch(() => {}); }
    for (const id of made.suppliers) await q('DELETE FROM suppliers WHERE id = $1', [id]).catch(() => {});
    for (const id of made.relais) await q('DELETE FROM relais WHERE id = $1', [id]).catch(() => {});
    for (const id of made.users) await q('DELETE FROM users WHERE id = $1', [id]).catch(() => {});
    await db.pool.end();
  });

  test('commande import : une ligne ouverte par article, rejeu idempotent (already_exists)', async () => {
    const o = await order([await product({ n: 1 }), await product({ n: 2 })]);
    const r1 = await triggerPurchasing(o.id);
    expect(r1.purchase_orders.map((x) => x.status)).toEqual(['line_opened', 'line_opened']);
    expect((await lines(o.id)).length).toBe(2);
    const r2 = await triggerPurchasing(o.id);
    expect(r2.purchase_orders.map((x) => x.status)).toEqual(['already_exists', 'already_exists']);
    expect((await lines(o.id)).length).toBe(2);
  });

  test('LOCAL_STOCK : local_stock_no_purchase, aucune ligne', async () => {
    const p = await product({ n: 3 });
    const o = await order([p], { source: 'LOCAL_STOCK' });
    const r = await triggerPurchasing(o.id);
    expect(r.purchase_orders[0].status).toBe('local_stock_no_purchase');
    expect((await lines(o.id)).length).toBe(0);
  });

  test('no_supplier : notification envoyee APRES le COMMIT, aucune ligne', async () => {
    process.env.ADMIN_PHONE = '+2693000000';
    const o = await order([await product({ mapped: false, n: 4 })]);
    let committedWhenNotified = null;
    notifyText.mockImplementationOnce(async () => { committedWhenNotified = (await idleInTx()) === 0; return {}; });
    const r = await triggerPurchasing(o.id);
    expect(r.purchase_orders[0].status).toBe('no_supplier');
    await sleep(300);
    expect(notifyText).toHaveBeenCalledTimes(1);
    expect(committedWhenNotified).toBe(true);
    expect((await lines(o.id)).length).toBe(0);
    delete process.env.ADMIN_PHONE;
  });

  test('un article en erreur au milieu de trois : les deux autres sont ouverts, alerte creee', async () => {
    const ps = [await product({ n: 5 }), await product({ n: 6 }), await product({ n: 7 })];
    const o = await order(ps);
    const items = await q('SELECT id, product_id FROM order_items WHERE order_id = $1 ORDER BY created_at, id', [o.id]);
    const middle = items.find((i) => i.product_id === ps[1]);
    // sku_id fictif : loadExactSoldSku (mock) renvoie un SKU exact, readiness en echec pour cet article seulement
    snap.loadExactSoldSku.mockImplementation(async (c, item) => (item.id === middle.id ? { id: '00000000-0000-0000-0000-000000000001', manualCatalogSku: false, supplier_order_identity: null } : null));
    snap.resolveExactSkuProcurementReadiness.mockImplementation(async () => { throw new Error('READINESS_BLOCKED_ITEM'); });
    const r = await triggerPurchasing(o.id);
    const by = Object.fromEntries(r.purchase_orders.map((x, i) => [items[i] ? i : i, x.status]));
    expect(r.purchase_orders.map((x) => x.status).sort()).toEqual(['error', 'line_opened', 'line_opened']);
    expect((await lines(o.id)).length).toBe(2);
    const alerts = await q(`SELECT 1 FROM alerts WHERE type = 'purchasing_po_creation_failed' AND entity_id::text = $1::text`, [o.id]);
    expect(alerts.length).toBe(1);
    snap.loadExactSoldSku.mockReset(); snap.loadExactSoldSku.mockImplementation(jest.requireActual('../../services/purchase-line-snapshot').loadExactSoldSku);
  });

  test('readiness lente > idle_in_transaction_session_timeout : aucune exception non rattrapee, aucune transaction tenue pendant l attente', async () => {
    const dbName = (await q('SELECT current_database() AS d'))[0].d;
    await q(`ALTER DATABASE "${dbName}" SET idle_in_transaction_session_timeout = '1000ms'`);
    jest.resetModules();
    const fresh = require('../../db');
    const s = require('../../services/purchase-line-snapshot');
    const svc = require('../../services/purchasing-trigger-service');
    const p = (await fresh.query(`INSERT INTO products (name, price_kmf, stock, is_active, inventory_model) VALUES ($1,10000,0,true,'SKU') RETURNING id`, [`${TAG} lent`])).rows[0].id; made.products.push(p);
    expect(p).toBeTruthy();
    // fournisseur mappe
    const sup = (await fresh.query(`INSERT INTO suppliers (name, platform, auto_order, is_active) VALUES ($1,'aliexpress',false,true) RETURNING id`, [`${TAG} f-lent`])).rows[0].id; made.suppliers.push(sup);
    await fresh.query(`INSERT INTO product_suppliers (product_id, supplier_id, supplier_sku, supplier_price_aed, supplier_url, priority, is_active) VALUES ($1,$2,'x',1,'https://example.invalid',1,true)`, [p, sup]);
    const ord = (await fresh.query(`INSERT INTO orders (reference, relais_id, market_id, total_kmf, payment_mode, payment_status, status) VALUES ($1,$2,$3,10000,'cash_relais','paid','ordered') RETURNING id`, [uref(), relais.id, market.id])).rows[0].id;
    made.orders.push(ord);
    await fresh.query(`INSERT INTO order_items (order_id, product_id, quantity, price_kmf, fulfillment_source) VALUES ($1,$2,1,10000,'IMPORT')`, [ord, p]);
    s.loadExactSoldSku.mockImplementation(async () => ({ id: '00000000-0000-0000-0000-000000000002', manualCatalogSku: false, supplier_order_identity: null }));
    let heldDuringWait = null;
    s.resolveExactSkuProcurementReadiness.mockImplementation(async () => {
      await sleep(1800); // > 1000 ms
      heldDuringWait = (await fresh.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction'`)).rows[0].n;
      throw new Error('READINESS_SLOW_THEN_FAIL');
    });
    const r = await svc.triggerPurchasing(ord);
    expect(r.purchase_orders[0].status).toBe('error');
    expect(heldDuringWait).toBe(0);
    await sleep(300);
    expect(uncaught).toEqual([]);
    await fresh.pool.end().catch(() => {});
  }, 30000);

  test('confirmation cash d une commande import (writer reel) : lignes ouvertes, sans exception', async () => {
    jest.resetModules();
    const fresh = require('../../db');
    const trig = require('../../services/purchasing-trigger-service');
    const { confirmCashByReference: confirm } = require('../../services/payment-cash-confirm');
    let [admin] = (await fresh.query(`SELECT id, role::text AS role FROM users WHERE role = 'admin' LIMIT 1`)).rows;
    if (!admin) { admin = (await fresh.query(`INSERT INTO users (full_name, email, password_hash, role) VALUES ($1,$2,'x','admin') RETURNING id, role::text AS role`, [`${TAG} admin`, `${TAG}@example.invalid`])).rows[0]; made.users.push(admin.id); }
    const p1 = (await fresh.query(`INSERT INTO products (name, price_kmf, stock, is_active, inventory_model) VALUES ($1,10000,5,true,'LEGACY_VARIANTS') RETURNING id`, [`${TAG} cash`])).rows[0].id; made.products.push(p1);
    const sup = (await fresh.query(`INSERT INTO suppliers (name, platform, auto_order, is_active) VALUES ($1,'aliexpress',false,true) RETURNING id`, [`${TAG} f-cash`])).rows[0].id; made.suppliers.push(sup);
    await fresh.query(`INSERT INTO product_suppliers (product_id, supplier_id, supplier_sku, supplier_price_aed, supplier_url, priority, is_active) VALUES ($1,$2,'y',1,'https://example.invalid',1,true)`, [p1, sup]);
    const ref = `C${String(Date.now()).slice(-7)}`;
    const ord = (await fresh.query(`INSERT INTO orders (reference, relais_id, market_id, total_kmf, payment_mode, payment_status, status, cash_ref_code) VALUES ($1,$2,$3,10000,'cash_relais','pending','pending',$4) RETURNING id`, [uref(), relais.id, market.id, ref])).rows[0].id;
    made.orders.push(ord);
    await fresh.query(`INSERT INTO order_items (order_id, product_id, quantity, price_kmf, fulfillment_source) VALUES ($1,$2,1,10000,'IMPORT')`, [ord, p1]);
    const res = await confirm({ cashRefCode: ref, actor: { id: admin.id, role: 'admin' }, triggerPurchasing: trig.triggerPurchasing, db: fresh });
    expect([200, 202]).toContain(res.status);
    let n = 0;
    for (let i = 0; i < 40 && !n; i++) { n = (await fresh.query(`SELECT count(*)::int AS n FROM purchase_lines pl JOIN order_items oi ON oi.id = pl.order_item_id WHERE oi.order_id = $1`, [ord])).rows[0].n; if (!n) await sleep(250); }
    expect(n).toBe(1);
    expect(uncaught).toEqual([]);
    await fresh.pool.end().catch(() => {});
  }, 30000);
}
