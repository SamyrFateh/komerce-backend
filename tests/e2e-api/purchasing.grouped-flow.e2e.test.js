'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * E2E-P0-PURCHASING — achats regroupés (drapeau KOMERCE_GROUPED_PURCHASING allumé), PR 7/8
 *
 * Feature propriétaire : purchasing — traversées : orders (machine d'états), logistics (réception Hub)
 *
 * Scénario : 3 commandes (KM, CM, CG), 2 fournisseurs. Lignes ouvertes → 2 PO regroupées (une multi-marché)
 * → soumission → confirmation partielle (reliquat ouvert) → réceptions → PO `hub_received`, commande `preparation`
 * uniquement quand chaque item est couvert ET reçu ; une ligne soldée sans reliquat laisse la commande bloquée.
 *
 * FRONTIÈRES CONTRÔLÉES (mockées) : préflight fournisseur (réseau), notification, SCAN 3 (SMS). La réception Hub
 * physique (identité d'unité) est couverte par tests/integration/hub-physical-*.test.js : ici elle est simulée
 * par ses écritures canoniques (allocation + placement RECEIVE) puis la complétude réelle est appelée avec les
 * allocations, exactement comme hub-operations le fait après COMMIT.
 */

jest.mock('../../services/notification-service', () => ({ notifyText: jest.fn().mockResolvedValue(true) }));
jest.mock('../../services/suppliers/canonical-unit-purchasing-gate', () => ({
  evaluateCanonicalProcurementReadiness: jest.fn(async ({ soldIdentity }) => ({
    ready: true,
    status: 'FULFILLMENT_READY',
    canonical_unit_id: 'e2e-a0-canonical-unit',
    canonical_unit: { current_state: { is_active: true, stock_available: 50, purchase_price: 10, currency: 'USD' } },
    supplier_unit_ref: soldIdentity?.payload?.supplier_unit_ref || 'E2E-A0-UNIT',
    identity: soldIdentity,
    money: { unit_price: 10, currency: 'USD' },
    preflight: { ready: true, evidence: { manual_procurement_ready: true } },
  })),
}));
const mockScan3 = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/scan-operations', () => ({ ...jest.requireActual('../../services/scan-operations'), triggerScan3: (...a) => mockScan3(...a) }));

const { describeE2E, createCleanup, RUN_TAG, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(90000);

describeE2E('E2E-P0-PURCHASING — achats regroupés : flux complet', ({ db }) => {
  const grouped = require('../../services/purchasing-grouped-service');
  const engagement = require('../../services/purchasing-engagement-service');
  const { evaluateOrderProcurementCompletion, completeOrdersAfterHubReceipt } = require('../../services/purchasing-completion-service');

  const clientId = uuid();
  const relaisByMarket = { KM: uuid(), CM: uuid(), CG: uuid() };
  const supplier1 = uuid();
  const supplier2 = uuid();
  const supplier3 = uuid();
  const IDENTITY = JSON.stringify({ provider: 'noon', version: 1, payload: { supplier_sku: 'U1' } });
  let cleanup;
  let hubRef;

  const q = (sql, params) => db.query(sql, params);
  const one = async (sql, params) => (await q(sql, params)).rows[0];
  const orderStatus = async (orderId) => (await one('SELECT status FROM orders WHERE id = $1', [orderId])).status;
  const poStatus = async (poId) => (await one('SELECT status FROM purchase_orders WHERE id = $1', [poId])).status;

  async function seedNeed(label, { market, quantity, supplier }) {
    const productId = uuid(); const skuId = uuid(); const orderId = uuid(); const itemId = uuid();
    await q('INSERT INTO products (id, name, price_kmf, stock, price_aed) VALUES ($1, $2, 25000, 0, 200)', [productId, `E2E Grouped ${tag(label)}`]);
    await q(`INSERT INTO product_skus (id, product_id, supplier_sku, supplier_unit_ref, supplier_order_identity, source)
             VALUES ($1, $2, $3, $4, $5::jsonb, 'SUPPLIER')`, [skuId, productId, `SKU-${tag(label)}`, `UNIT-${tag(label)}`, IDENTITY]);
    await q(
      `INSERT INTO orders (id, user_id, relais_id, market_id, reference, status, payment_status, payment_mode, total_kmf, total_eur)
       VALUES ($1, $2, $3, (SELECT id FROM markets WHERE code = $4), $5, 'ordered', 'paid', 'cash_relais', 25000, 50)`,
      [orderId, clientId, relaisByMarket[market], market, `E2EGR-${tag(label)}`.toUpperCase()]
    );
    await q('INSERT INTO order_items (id, order_id, product_id, quantity, price_kmf) VALUES ($1, $2, $3, $4, 25000)', [itemId, orderId, productId, quantity]);
    const line = await one(`
      INSERT INTO purchase_lines (order_item_id, supplier_id, product_sku_id, supplier_sku, supplier_unit_ref,
                                  supplier_order_identity, quantity, supplier_unit_price, supplier_currency, procurement_hub_ref)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 10, 'USD', 'DXB') RETURNING id`,
      [itemId, supplier, skuId, `SKU-${tag(label)}`, `UNIT-${tag(label)}`, IDENTITY, quantity]);
    return { productId, skuId, orderId, itemId, lineId: line.id };
  }

  async function seedTriggeredExactNeed(label, { market = 'KM', quantity = 1 } = {}) {
    const productId = uuid();
    const skuId = uuid();
    const orderId = uuid();
    const itemId = uuid();
    const productSupplierId = uuid();
    const supplierUnitRef = `UNIT-${tag(label)}`;
    const identity = {
      provider: 'noon',
      version: 1,
      payload: { supplier_unit_ref: supplierUnitRef },
    };

    await q(
      'INSERT INTO products (id, name, price_kmf, stock, price_aed, inventory_model) VALUES ($1, $2, 25000, 0, 200, $3)',
      [productId, `E2E Grouped ${tag(label)}`, 'SKU']
    );
    await q(
      `INSERT INTO product_skus
         (id, product_id, sku, stock, is_active, source, supplier_sku, supplier_unit_ref, supplier_order_identity)
       VALUES ($1,$2,$3,50,true,'SUPPLIER',$4,$5,$6::jsonb)`,
      [skuId, productId, `K-${tag(label)}`, `SKU-${tag(label)}`, supplierUnitRef, JSON.stringify(identity)]
    );
    await q(
      `INSERT INTO product_suppliers
         (id, product_id, supplier_id, supplier_sku, supplier_price_aed, min_order_qty, priority, is_active)
       VALUES ($1,$2,$3,$4,77,1,1,true)`,
      [productSupplierId, productId, supplier3, `GENERIC-${tag(label)}`]
    );
    await q(
      `INSERT INTO orders (id, user_id, relais_id, market_id, reference, status, payment_status, payment_mode, total_kmf, total_eur)
       VALUES ($1,$2,$3,(SELECT id FROM markets WHERE code = $4),$5,'ordered','paid','cash_relais',25000,50)`,
      [orderId, clientId, relaisByMarket[market], market, `E2EA0-${tag(label)}`.toUpperCase()]
    );
    await q(
      `INSERT INTO order_items
         (id, order_id, product_id, quantity, price_kmf, sku_id, fulfillment_source)
       VALUES ($1,$2,$3,$4,25000,$5,'IMPORT')`,
      [itemId, orderId, productId, quantity, skuId]
    );

    return { productId, skuId, orderId, itemId, productSupplierId, supplierUnitRef, identity };
  }

  /** Réception Hub : écritures canoniques d'une allocation par ligne + placement RECEIVE (hub-operations ensuite). */
  async function hubReceive(lineId, quantity) {
    const line = await one(`SELECT pl.purchase_order_id, pl.order_item_id, pl.product_sku_id, pl.supplier_id, pl.supplier_unit_ref,
                                   pl.supplier_order_identity, oi.order_id, o.market_id
                              FROM purchase_lines pl JOIN order_items oi ON oi.id = pl.order_item_id JOIN orders o ON o.id = oi.order_id
                             WHERE pl.id = $1`, [lineId]);
    const unit = await one(`INSERT INTO hub_physical_units (reference, unit_type, state) VALUES ($1, 'SUPPLIER_PACKAGE', 'RECEIVED') RETURNING id`, [`E2EGR-UNIT-${tag(lineId.slice(0, 8))}`]);
    const alloc = await one(
      `INSERT INTO hub_purchase_allocations (purchase_order_id, order_id, order_item_id, product_sku_id, supplier_id, supplier_unit_ref,
                                             supplier_order_identity, quantity, market_id, destination_ref, purchase_line_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'E2E-DEST', $10) RETURNING id`,
      [line.purchase_order_id, line.order_id, line.order_item_id, line.product_sku_id, line.supplier_id, line.supplier_unit_ref,
        line.supplier_order_identity, quantity, line.market_id, lineId]
    );
    await q('INSERT INTO hub_physical_unit_placements (physical_unit_id, allocation_id, operation_type, quantity) VALUES ($1, $2, $3, $4)', [unit.id, alloc.id, 'RECEIVE', quantity]);
    return [{ allocation: { order_id: line.order_id, purchase_line_id: lineId }, quantity }];
  }

  beforeAll(async () => {
    process.env.KOMERCE_GROUPED_PURCHASING = '1';
    cleanup = createCleanup(db);
    hubRef = 'DXB';
    // Tables Hub / lignes d'achat : append-only (triggers d'immutabilité). Nettoyage de test uniquement, en une
    // seule requête multi-instructions (une connexion) sous session_replication_role = replica, comme
    // tests/e2e-api/settlement.state-machine.e2e.test.js. Ids littéraux : uuid() locaux, aucune entrée externe.
    const ordersOfRun = `SELECT id FROM orders WHERE user_id = '${clientId}'`;
    const itemsOfRun = `SELECT id FROM order_items WHERE order_id IN (${ordersOfRun})`;
    const suppliers = `'${supplier1}', '${supplier2}', '${supplier3}'`;
    const relaisIds = Object.values(relaisByMarket).map((r) => `'${r}'`).join(', ');
    cleanup.trackSql(`
      SET session_replication_role = replica;
      DELETE FROM signals WHERE entity_id IN (SELECT id::text FROM orders WHERE user_id = '${clientId}');
      DELETE FROM hub_physical_unit_placements WHERE allocation_id IN (SELECT id FROM hub_purchase_allocations WHERE order_item_id IN (${itemsOfRun}));
      DELETE FROM hub_purchase_allocations WHERE order_item_id IN (${itemsOfRun});
      DELETE FROM hub_physical_units WHERE reference LIKE 'E2EGR-UNIT-${RUN_TAG}%';
      DELETE FROM purchase_lines WHERE order_item_id IN (${itemsOfRun});
      DELETE FROM purchase_orders WHERE supplier_id IN (${suppliers});
      DELETE FROM order_status_history WHERE order_id IN (${ordersOfRun});
      DELETE FROM order_items WHERE order_id IN (${ordersOfRun});
      DELETE FROM orders WHERE user_id = '${clientId}';
      DELETE FROM product_skus WHERE supplier_sku LIKE 'SKU-${RUN_TAG}%';
      DELETE FROM products WHERE name LIKE 'E2E Grouped ${RUN_TAG}%';
      DELETE FROM relais WHERE id IN (${relaisIds});
      DELETE FROM suppliers WHERE id IN (${suppliers});
      DELETE FROM users WHERE id = '${clientId}';
      SET session_replication_role = origin;
    `);

    await q(`INSERT INTO users (id, full_name, email, phone, role) VALUES ($1, 'E2E Grouped Client', $2, $3, 'client')`,
      [clientId, `${tag('grclient')}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`]);
    for (const [code, id] of Object.entries(relaisByMarket)) {
      await q(`INSERT INTO relais (id, name, agent_name, phone, address, market_id)
               VALUES ($1, $2, 'E2E Agent', '+269000222', 'Test', (SELECT id FROM markets WHERE code = $3))`, [id, `E2E Relais Grouped ${code}`, code]);
    }
    for (const [id, n] of [[supplier1, 'S1'], [supplier2, 'S2']]) {
      await q(`INSERT INTO suppliers (id, name, platform, contact_phone, auto_order, is_active)
               VALUES ($1, $2, 'whatsapp', '+971500000001', false, true)`, [id, `E2E Fournisseur ${n} ${tag(n)}`]);
    }
    await q(`INSERT INTO suppliers (id, name, platform, contact_phone, auto_order, is_active)
             VALUES ($1, $2, 'noon', '+971500000003', false, true)`,
      [supplier3, `E2E Fournisseur A0 ${tag('S3')}`]);
  });

  afterAll(async () => {
    delete process.env.KOMERCE_GROUPED_PURCHASING;
    if (cleanup) await cleanup.run();
  });

  it('A0 — paid order → exact SKU/SOI → purchase_line → PO draft → même scope KM, sans double achat', async () => {
    const { triggerPurchasing } = require('../../services/purchasing-trigger-service');
    const seeded = await seedTriggeredExactNeed('a0', { market: 'KM', quantity: 1 });

    const first = await triggerPurchasing(seeded.orderId);
    expect(first.purchase_orders).toHaveLength(1);
    expect(first.purchase_orders[0]).toMatchObject({
      status: 'line_opened',
      purchase_order_id: null,
    });
    const lineId = first.purchase_orders[0].purchase_line_id;
    expect(lineId).toBeTruthy();

    const line = await one(
      `SELECT pl.id, pl.purchase_order_id, pl.order_item_id, pl.product_sku_id,
              pl.supplier_sku, pl.supplier_unit_ref, pl.supplier_order_identity,
              pl.quantity, pl.supplier_unit_price, pl.supplier_currency,
              vm.order_id, vm.market_id, mk.code AS market_code
         FROM purchase_lines pl
         JOIN v_purchase_line_market vm ON vm.line_id = pl.id
         JOIN markets mk ON mk.id = vm.market_id
        WHERE pl.id = $1`,
      [lineId]
    );

    expect(line.purchase_order_id).toBeNull();
    expect(line.order_id).toBe(seeded.orderId);
    expect(line.order_item_id).toBe(seeded.itemId);
    expect(line.product_sku_id).toBe(seeded.skuId);
    expect(line.supplier_sku).toBe(`SKU-${tag('a0')}`);
    expect(line.supplier_unit_ref).toBe(seeded.supplierUnitRef);
    expect(line.supplier_order_identity).toEqual(seeded.identity);
    expect(Number(line.quantity)).toBe(1);
    expect(Number(line.supplier_unit_price)).toBe(10);
    expect(line.supplier_currency).toBe('USD');
    expect(line.market_code).toBe('KM');

    const prepared = await grouped.preparePurchaseOrder({
      supplier_id: supplier3,
      procurement_hub_ref: hubRef,
      line_ids: [lineId],
    });
    expect(prepared.purchase_order).toMatchObject({
      supplier_id: supplier3,
      status: 'draft',
      order_id: null,
      procurement_hub_ref: hubRef,
    });
    expect(prepared.lines).toHaveLength(1);
    expect(prepared.lines[0]).toMatchObject({
      line_id: lineId,
      order_id: seeded.orderId,
      order_item_id: seeded.itemId,
      product_sku_id: seeded.skuId,
      market_code: 'KM',
      supplier_unit_ref: seeded.supplierUnitRef,
    });

    const second = await triggerPurchasing(seeded.orderId);
    expect(second.purchase_orders).toHaveLength(1);
    expect(second.purchase_orders[0]).toMatchObject({
      status: 'already_exists',
      purchase_order_id: prepared.purchase_order.id,
    });

    const { rows: [counts] } = await q(
      `SELECT
         (SELECT count(*)::int FROM purchase_lines WHERE order_item_id = $1 AND cancelled_at IS NULL) AS lines,
         (SELECT count(*)::int FROM purchase_orders WHERE id = $2 AND status <> 'cancelled') AS pos`,
      [seeded.itemId, prepared.purchase_order.id]
    );
    expect(counts).toEqual({ lines: 1, pos: 1 });
  });

  it('3 commandes / 2 fournisseurs : préparation, soumission, confirmation partielle, réceptions, complétude', async () => {
    const a = await seedNeed('a', { market: 'KM', quantity: 2, supplier: supplier1 });
    const b = await seedNeed('b', { market: 'CM', quantity: 3, supplier: supplier1 });
    const c = await seedNeed('c', { market: 'CG', quantity: 1, supplier: supplier2 });

    // Lignes ouvertes : visibles, une PO regroupée par (fournisseur, Hub), marché porté par la ligne.
    const open = await grouped.listOpenLines();
    const ids = open.groups.flatMap((g) => g.lines.map((l) => l.line_id || l.id));
    expect(ids).toEqual(expect.arrayContaining([a.lineId, b.lineId, c.lineId]));

    const po1 = (await grouped.preparePurchaseOrder({ supplier_id: supplier1, procurement_hub_ref: hubRef, line_ids: [a.lineId, b.lineId] })).purchase_order;
    const po2 = (await grouped.preparePurchaseOrder({ supplier_id: supplier2, procurement_hub_ref: hubRef, line_ids: [c.lineId] })).purchase_order;
    expect(po1.order_id).toBeNull();
    expect(await poStatus(po1.id)).toBe('draft');

    await engagement.submitPurchaseOrder(po1.id);
    await engagement.submitPurchaseOrder(po2.id);
    expect(await poStatus(po1.id)).toBe('notified');

    // Confirmation partielle de PO1 : A 2/2, B 2/3 → reliquat ouvert de 1 sur B (même marché).
    await engagement.confirmGroupedPurchaseOrder(po1.id, {
      supplier_order_id: `SUP-${tag('po1')}`,
      lines: [{ purchase_line_id: a.lineId, confirmed_quantity: 2 }, { purchase_line_id: b.lineId, confirmed_quantity: 2 }],
    });
    const remnant = await one('SELECT id, quantity, purchase_order_id FROM purchase_lines WHERE parent_line_id = $1', [b.lineId]);
    expect(remnant).toMatchObject({ quantity: 1, purchase_order_id: null });

    // Réception Hub de PO1 (A:2, B:2) puis complétude après « commit ».
    const allocs = [...(await hubReceive(a.lineId, 2)), ...(await hubReceive(b.lineId, 2))];
    await completeOrdersAfterHubReceipt(allocs);

    expect(await poStatus(po1.id)).toBe('hub_received');
    expect(await orderStatus(a.orderId)).toBe('preparation');
    expect(await orderStatus(b.orderId)).toBe('ordered'); // reliquat ouvert : item sous-couvert reçu
    expect(mockScan3).toHaveBeenCalledTimes(1);

    // Idempotence : second appel sans effet (pas de second SCAN 3).
    await completeOrdersAfterHubReceipt(allocs);
    expect(mockScan3).toHaveBeenCalledTimes(1);

    // Reliquat de B repris dans une nouvelle PO, soumis, confirmé, reçu → B passe en préparation.
    const po3 = (await grouped.preparePurchaseOrder({ supplier_id: supplier1, procurement_hub_ref: hubRef, line_ids: [remnant.id] })).purchase_order;
    await engagement.submitPurchaseOrder(po3.id);
    await engagement.confirmGroupedPurchaseOrder(po3.id, { supplier_order_id: `SUP-${tag('po3')}`, lines: [{ purchase_line_id: remnant.id, confirmed_quantity: 1 }] });
    await completeOrdersAfterHubReceipt(await hubReceive(remnant.id, 1));
    expect(await poStatus(po3.id)).toBe('hub_received');
    expect(await orderStatus(b.orderId)).toBe('preparation');

    // PO2 : confirmée puis ligne soldée à 0 sans reliquat → PO close, mais la commande reste bloquée (fail-closed).
    await engagement.confirmGroupedPurchaseOrder(po2.id, { supplier_order_id: `SUP-${tag('po2')}`, lines: [{ purchase_line_id: c.lineId, confirmed_quantity: 1 }] });
    await engagement.settleLine(c.lineId, { settled_quantity: 0, reason: 'rupture fournisseur', reopen_remainder: false });
    const verdict = await evaluateOrderProcurementCompletion(c.orderId);
    expect(verdict).toMatchObject({ complete: false, transition: 'skipped' });
    expect(await orderStatus(c.orderId)).toBe('ordered');
  });

  it('signal « commande sans achat couvert » : lu sur les lignes (couverte, non couverte, soldée sans reliquat)', async () => {
    const { GENERATORS } = require('../../services/signal-service');
    const open = await seedNeed('s1', { market: 'KM', quantity: 2, supplier: supplier1 });
    const solded = await seedNeed('s2', { market: 'CM', quantity: 2, supplier: supplier1 });
    await q(`UPDATE orders SET ordered_at = NOW() - INTERVAL '2 hours' WHERE id IN ($1, $2)`, [open.orderId, solded.orderId]);

    const signalOf = async (orderId) => (await q(
      `SELECT signal_type FROM signals WHERE entity_id = $1::text AND signal_type = 'ordered_without_purchase_order' AND status = 'open'`, [orderId])).rows.length;

    // Ligne ouverte = besoin couvert (effectif 2 ≥ 2) : aucun signal.
    let out = await GENERATORS.ordered_without_purchase_order();
    expect(out.error).toBeUndefined();
    expect(await signalOf(open.orderId)).toBe(0);

    // Ligne annulée : l'item n'est plus couvert → signal ouvert.
    await q(`UPDATE purchase_lines SET cancelled_at = NOW(), cancel_reason = 'e2e' WHERE id = $1`, [open.lineId]);
    out = await GENERATORS.ordered_without_purchase_order();
    expect(out.error).toBeUndefined();
    expect(await signalOf(open.orderId)).toBe(1);

    // Ligne soldée sans reliquat (fail-closed) : item non couvert → signal.
    const po = (await grouped.preparePurchaseOrder({ supplier_id: supplier1, procurement_hub_ref: hubRef, line_ids: [solded.lineId] })).purchase_order;
    await engagement.submitPurchaseOrder(po.id);
    await engagement.confirmGroupedPurchaseOrder(po.id, { supplier_order_id: `SUP-${tag('sg')}`, lines: [{ purchase_line_id: solded.lineId, confirmed_quantity: 2 }] });
    await hubReceive(solded.lineId, 1); // le Hub a reçu 1 sur 2 : la clôture ne peut pas aller en dessous
    await engagement.settleLine(solded.lineId, { settled_quantity: 1, reason: 'écart constaté', reopen_remainder: false });
    out = await GENERATORS.ordered_without_purchase_order();
    expect(await signalOf(solded.orderId)).toBe(1);

    // Aucun reliquat rouvert : le besoin reste non couvert (la commande reste bloquée avant préparation).
    const stuck = await GENERATORS.purchase_order_receipt_stuck();
    expect(stuck.error).toBeUndefined();
  });
});
