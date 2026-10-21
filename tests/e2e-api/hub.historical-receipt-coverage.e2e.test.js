'use strict';

/**
 * @test-kind e2e-api
 * @test-runner jest
 * @test-requires postgres
 * @feature logistics
 * @brief C2 — preuve de bout en bout sur PostgreSQL réel : une PO HISTORIQUE n'avance la commande que par la
 * réception physique canonique (couverture quantitative), jamais par un compteur déclaratif ni par un saut de rang.
 */

const { describeE2E, createCleanup, RUN_TAG, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(90000);

describeE2E('C2 — réception physique d\'une PO historique → préparation', ({ db }) => {
  const { transitionOrderStatus } = require('../../services/order-status-machine');
  const { receiveSupplierPackageCommand } = require('../../services/hub-operations');

  const userId = uuid(); const relaisId = uuid(); const productId = uuid(); const supplierId = uuid();
  const skuId = uuid(); const orderId = uuid(); const itemId = uuid(); const poId = uuid();
  const REF = `C2R-${RUN_TAG}`.toUpperCase();
  const ADMIN = { id: null, role: 'admin' };
  const q = (sql, params) => db.query(sql, params);
  let cleanup; let marketId;
  const status = async () => (await q('SELECT status::text AS s FROM orders WHERE id=$1', [orderId])).rows[0].s;
  const receive = (qty, suffix) => receiveSupplierPackageCommand({
    reference: `${REF}-${suffix}`, contents: [{ purchase_order_id: poId, quantity: qty }],
  }, null);

  beforeAll(async () => {
    cleanup = createCleanup(db);
    marketId = (await q(`SELECT id FROM markets WHERE code = 'KM' LIMIT 1`)).rows[0].id;
    cleanup.trackSql(`
      SET session_replication_role = replica;
      DELETE FROM hub_custody_events WHERE physical_unit_id IN (SELECT id FROM hub_physical_units WHERE reference LIKE '${REF}%');
      DELETE FROM hub_physical_unit_placements WHERE allocation_id IN (SELECT id FROM hub_purchase_allocations WHERE order_id = '${orderId}');
      DELETE FROM hub_purchase_allocations WHERE order_id = '${orderId}';
      DELETE FROM hub_physical_units WHERE reference LIKE '${REF}%';
      DELETE FROM scans WHERE order_id = '${orderId}';
      DELETE FROM order_status_history WHERE order_id = '${orderId}';
      DELETE FROM purchase_orders WHERE id = '${poId}';
      DELETE FROM order_items WHERE order_id = '${orderId}';
      DELETE FROM orders WHERE id = '${orderId}';
      DELETE FROM product_skus WHERE id = '${skuId}';
      DELETE FROM suppliers WHERE id = '${supplierId}';
      DELETE FROM products WHERE id = '${productId}';
      DELETE FROM relais WHERE id = '${relaisId}';
      DELETE FROM users WHERE id = '${userId}';
      SET session_replication_role = origin;
    `);
    const soi = { provider: 'manual', version: 1, payload: { supplier_sku: REF } };
    await q(`INSERT INTO users (id, full_name, email, phone, role) VALUES ($1,'E2E C2 Client',$2,$3,'client')`,
      [userId, `${tag('c2')}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`]);
    await q(`INSERT INTO relais (id, name, agent_name, phone, address, market_id) VALUES ($1,$2,'E2E Agent','+269000555','E2E C2',$3)`,
      [relaisId, `E2E C2 Relais ${tag('relay')}`, marketId]);
    await q(`INSERT INTO products (id, name, price_kmf, stock, price_aed, inventory_model) VALUES ($1,$2,25000,0,200,'SKU')`,
      [productId, `E2E C2 Product ${tag('product')}`]);
    await q(`INSERT INTO suppliers (id, name, platform) VALUES ($1,$2,'cj')`, [supplierId, `E2E C2 Supplier ${tag('supplier')}`]);
    await q(`INSERT INTO product_skus (id, product_id, sku, stock, is_active, source, supplier_sku, supplier_unit_ref, supplier_order_identity)
             VALUES ($1,$2,$3,0,true,'SUPPLIER',$4,$4,$5::jsonb)`, [skuId, productId, `K-${tag('sku')}`, REF, JSON.stringify(soi)]);
    await q(`INSERT INTO orders (id, user_id, relais_id, market_id, reference, status, payment_status, payment_mode, total_kmf, total_eur)
             VALUES ($1,$2,$3,$4,$5,'ordered','paid','cash_relais',50000,100)`, [orderId, userId, relaisId, marketId, REF]);
    await q(`INSERT INTO order_items (id, order_id, product_id, quantity, price_kmf, fulfillment_source) VALUES ($1,$2,$3,2,25000,'IMPORT')`,
      [itemId, orderId, productId]);
    await q(`INSERT INTO purchase_orders (id, order_id, order_item_id, product_sku_id, supplier_id, supplier_sku, supplier_unit_ref, supplier_order_identity, qty, status)
             VALUES ($1,$2,$3,$4,$5,$6,$6,$7::jsonb,2,'confirmed')`, [poId, orderId, itemId, skuId, supplierId, REF, JSON.stringify(soi)]);
  });

  afterAll(async () => { if (cleanup) await cleanup.run(); });

  test('compteur déclaratif ≠ preuve ; saut de rang scan refusé ; préparation refusée sans matière', async () => {
    await q(`UPDATE purchase_orders SET received_qty = 2 WHERE id = $1`, [poId]);
    const direct = await transitionOrderStatus({ orderId, newStatus: 'preparation', actor: ADMIN, source: 'patch' });
    expect(direct).toMatchObject({ success: false, code: 'PHYSICAL_RECEPTION_INCOMPLETE' });
    expect(direct.coverage[0]).toMatchObject({ needed: 2, usable: 0, missing: 2 });
    const jump = await transitionOrderStatus({ orderId, newStatus: 'shipped', actor: ADMIN, source: 'scan_engine_sync' });
    expect(jump).toMatchObject({ success: false, code: 'PHYSICAL_RECEPTION_INCOMPLETE' });
    expect(await status()).toBe('ordered');
  });

  test('annulation jamais bloquée par le gate (commande jetable)', async () => {
    const other = uuid();
    await q(`INSERT INTO orders (id, user_id, relais_id, market_id, reference, status, payment_status, payment_mode, total_kmf, total_eur)
             VALUES ($1,$2,$3,$4,$5,'ordered','paid','cash_relais',1000,2)`, [other, userId, relaisId, marketId, `${REF}-X`]);
    await q(`INSERT INTO order_items (id, order_id, product_id, sku_id, quantity, price_kmf, fulfillment_source) VALUES ($1,$2,$3,$4,1,1000,'IMPORT')`, [uuid(), other, productId, skuId]);
    cleanup.trackSql(`SET session_replication_role = replica; DELETE FROM order_status_history WHERE order_id='${other}'; DELETE FROM order_items WHERE order_id='${other}'; DELETE FROM orders WHERE id='${other}'; SET session_replication_role = origin;`);
    const r = await transitionOrderStatus({ orderId: other, newStatus: 'cancelled', actor: ADMIN, source: 'patch', cancelReason: 'c2-test' });
    expect(r.success).toBe(true);
  });

  test('réception physique partielle : couverture manquante exacte, commande toujours ordered', async () => {
    const r1 = await receive(1, 'A');
    expect(r1.status).toBe(201);
    expect(await status()).toBe('ordered');
    const gate = await transitionOrderStatus({ orderId, newStatus: 'preparation', actor: ADMIN, source: 'patch' });
    expect(gate.coverage[0]).toMatchObject({ needed: 2, usable: 1, missing: 1 });
    expect((await q('SELECT status FROM purchase_orders WHERE id=$1', [poId])).rows[0].status).toBe('confirmed');
  });

  test('rejouer la même référence est idempotent (aucune matière doublée)', async () => {
    const replay = await receive(1, 'A');
    expect([200, 201]).toContain(replay.status);
    const gate = await transitionOrderStatus({ orderId, newStatus: 'preparation', actor: ADMIN, source: 'patch' });
    expect(gate.coverage[0]).toMatchObject({ usable: 1, missing: 1 });
  });

  test('complément reçu : la complétude Purchasing fait passer la commande en preparation et ferme la PO', async () => {
    const r2 = await receive(1, 'B');
    expect(r2.status).toBe(201);
    expect(await status()).toBe('preparation');
    const po = (await q('SELECT status, hub_received_at FROM purchase_orders WHERE id=$1', [poId])).rows[0];
    expect(po.status).toBe('hub_received');
    expect(po.hub_received_at).not.toBeNull();
  });
});
