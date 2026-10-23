'use strict';

/**
 * @test-kind e2e-api
 * @test-runner jest
 * @test-requires postgres
 * @feature dashboard
 * @brief L8 — « Prochaine action réelle » sur PostgreSQL réel : Commandes classe les commandes payées
 * en À commander / En attente de réception Hub (n/N, sans action) / Préparer le colis selon la couverture
 * physique lue par lot (réception partielle incluse).
 */

const { describeE2E, createCleanup, RUN_TAG, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(90000);

describeE2E('L8 — files de prochaine action des commandes', ({ db }) => {
  const { getWorkQueues } = require('../../services/dashboard-orders');
  const { receiveSupplierPackageCommand } = require('../../services/hub-operations');
  const q = (sql, params) => db.query(sql, params);

  const REF = `L8N-${RUN_TAG}`.toUpperCase();
  const userId = uuid(); const relaisId = uuid(); const productId = uuid(); const supplierId = uuid(); const skuId = uuid();
  const orders = { confirmed: uuid(), none: uuid(), partial: uuid(), local: uuid(), cancelled: uuid() };
  const items = { none: uuid(), partial: uuid() };
  const pos = { none: uuid(), partial: uuid() };
  let cleanup; let market;

  async function seedOrder(key, status, source) {
    await q(`INSERT INTO orders (id, user_id, relais_id, market_id, reference, status, payment_status, payment_mode, total_kmf, total_eur)
             VALUES ($1,$2,$3,$4,$5,$6,'paid','cash_relais',50000,100)`, [orders[key], userId, relaisId, market.id, `${REF}-${key}`, status]);
    await q(`INSERT INTO order_items (id, order_id, product_id, quantity, price_kmf, fulfillment_source) VALUES ($1,$2,$3,$4,25000,$5)`,
      [items[key] || uuid(), orders[key], productId, key === 'partial' ? 3 : 2, source]);
  }
  async function seedPo(key) {
    const soi = { provider: 'manual', version: 1, payload: { supplier_sku: `${REF}-${key}` } };
    await q(`INSERT INTO purchase_orders (id, order_id, order_item_id, product_sku_id, supplier_id, supplier_sku, supplier_unit_ref, supplier_order_identity, qty, status)
             VALUES ($1,$2,$3,$4,$5,$6,$6,$7::jsonb,$8,'confirmed')`,
      [pos[key], orders[key], items[key], skuId, supplierId, `${REF}-${key}`, JSON.stringify(soi), key === 'partial' ? 3 : 2]);
  }
  const pick = (queue) => (queue || []).filter(o => String(o.reference).startsWith(REF)).map(o => o.reference.replace(`${REF}-`, ''));

  beforeAll(async () => {
    cleanup = createCleanup(db);
    market = (await q(`SELECT id, code FROM markets WHERE code = 'KM' LIMIT 1`)).rows[0];
    cleanup.trackSql(`
      SET session_replication_role = replica;
      DELETE FROM hub_custody_events WHERE physical_unit_id IN (SELECT id FROM hub_physical_units WHERE reference LIKE '${REF}%');
      DELETE FROM hub_physical_unit_placements WHERE allocation_id IN (SELECT id FROM hub_purchase_allocations WHERE order_id = ANY('{${Object.values(orders).join(',')}}'::uuid[]));
      DELETE FROM hub_purchase_allocations WHERE order_id = ANY('{${Object.values(orders).join(',')}}'::uuid[]);
      DELETE FROM hub_physical_units WHERE reference LIKE '${REF}%';
      DELETE FROM scans WHERE order_id = ANY('{${Object.values(orders).join(',')}}'::uuid[]);
      DELETE FROM order_status_history WHERE order_id = ANY('{${Object.values(orders).join(',')}}'::uuid[]);
      DELETE FROM purchase_orders WHERE id = ANY('{${Object.values(pos).join(',')}}'::uuid[]);
      DELETE FROM order_items WHERE order_id = ANY('{${Object.values(orders).join(',')}}'::uuid[]);
      DELETE FROM orders WHERE id = ANY('{${Object.values(orders).join(',')}}'::uuid[]);
      DELETE FROM product_skus WHERE id = '${skuId}';
      DELETE FROM suppliers WHERE id = '${supplierId}';
      DELETE FROM products WHERE id = '${productId}';
      DELETE FROM relais WHERE id = '${relaisId}';
      DELETE FROM users WHERE id = '${userId}';
      SET session_replication_role = origin;
    `);
    const soi = { provider: 'manual', version: 1, payload: { supplier_sku: REF } };
    await q(`INSERT INTO users (id, full_name, email, phone, role) VALUES ($1,'E2E L8 Client',$2,$3,'client')`,
      [userId, `${tag('l8')}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`]);
    await q(`INSERT INTO relais (id, name, agent_name, phone, address, market_id) VALUES ($1,$2,'E2E Agent','+269000556','E2E L8',$3)`,
      [relaisId, `E2E L8 Relais ${tag('relay')}`, market.id]);
    await q(`INSERT INTO products (id, name, price_kmf, stock, price_aed, inventory_model) VALUES ($1,$2,25000,0,200,'SKU')`,
      [productId, `E2E L8 Product ${tag('product')}`]);
    await q(`INSERT INTO suppliers (id, name, platform) VALUES ($1,$2,'cj')`, [supplierId, `E2E L8 Supplier ${tag('supplier')}`]);
    await q(`INSERT INTO product_skus (id, product_id, sku, stock, is_active, source, supplier_sku, supplier_unit_ref, supplier_order_identity)
             VALUES ($1,$2,$3,0,true,'SUPPLIER',$4,$4,$5::jsonb)`, [skuId, productId, `K-${tag('sku')}`, REF, JSON.stringify(soi)]);
    await seedOrder('confirmed', 'confirmed', 'IMPORT');
    await seedOrder('none', 'ordered', 'IMPORT'); await seedPo('none');
    await seedOrder('partial', 'ordered', 'IMPORT'); await seedPo('partial');
    await seedOrder('local', 'ordered', 'LOCAL_STOCK');
    await seedOrder('cancelled', 'cancelled', 'IMPORT');
  });

  afterAll(async () => { if (cleanup) await cleanup.run(); });

  test('confirmed payée → À commander ; ordered sans réception → attente 0/N sans action ; stock local → Préparer le colis ; annulée exclue', async () => {
    const queues = await getWorkQueues(market);
    expect(pick(queues.to_order)).toEqual(['confirmed']);
    expect(queues.to_order.find(o => o.reference.endsWith('-confirmed')).next_action).toMatchObject({ label: 'À commander', actionable: true });
    expect(pick(queues.awaiting_hub_reception)).toEqual(['none', 'partial']);
    const none = queues.awaiting_hub_reception.find(o => o.reference.endsWith('-none'));
    expect(none.next_action).toMatchObject({ label: 'En attente de réception Hub (0/2)', actionable: false });
    expect(pick(queues.ready_for_parcel)).toEqual(['local']);
    [queues.to_order, queues.awaiting_hub_reception, queues.ready_for_parcel].forEach(l => expect(pick(l)).not.toContain('cancelled'));
  });

  test('réception partielle (1/3) : toujours en attente, n/N exact, aucune action', async () => {
    const r = await receiveSupplierPackageCommand({ reference: `${REF}-A`, contents: [{ purchase_order_id: pos.partial, quantity: 1 }] }, null);
    expect(r.status).toBe(201);
    const queues = await getWorkQueues(market);
    const partial = queues.awaiting_hub_reception.find(o => o.reference.endsWith('-partial'));
    expect(partial.next_action).toMatchObject({ label: 'En attente de réception Hub (1/3)', actionable: false, received_units: 1, needed_units: 3 });
    expect(pick(queues.ready_for_parcel)).toEqual(['local']);
  });

  test('réception complète : la commande quitte les files d’attente (passage en préparation par le gate existant)', async () => {
    const r = await receiveSupplierPackageCommand({ reference: `${REF}-B`, contents: [{ purchase_order_id: pos.partial, quantity: 2 }] }, null);
    expect(r.status).toBe(201);
    const queues = await getWorkQueues(market);
    expect(pick(queues.awaiting_hub_reception)).toEqual(['none']);
    expect(pick(queues.ready_for_parcel)).toEqual(['local']);
  });
});
