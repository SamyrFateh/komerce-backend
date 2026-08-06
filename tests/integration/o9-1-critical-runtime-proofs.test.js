'use strict';


/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * O9.1 — Critical Runtime Proofs (REAL_DB_INTEGRATION)
 *
 * Complète les preuves P0 manquantes après ALERTS_CONTRACT_RECOVERY :
 *   P0-B — PayPal stockBlocked : erreur SQL réelle dans alerts, savepoint protège le COMMIT.
 *   P0-D — Cash cross-relais : alerte hors transaction, survit au ROLLBACK métier.
 *   P0-E — Purchasing : erreur PO + erreur SQL réelle dans alerts, transaction continue et commit.
 *   P0-F — Cancel order / PO engagée : erreur SQL réelle dans alerts, transaction parent reste saine.
 *
 * Les erreurs sont provoquées par PostgreSQL lui-même via des triggers de test.
 * Les triggers ne ciblent que les fixtures dont la référence commence par ITEST-O9P0-
 * et la suite tient un advisory lock dédié pendant toute son exécution.
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('O9.1 critical runtime proofs (REAL_DB) — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const db = require('../../db');
  const paymentPaypal = require('../../services/payment-paypal');
  const { collectCash } = require('../../services/cash-operations');
  const { triggerPurchasing } = require('../../services/purchasing-trigger-service');
  const { syncPurchaseOrdersOnOrderCancel } = require('../../services/cancel-order-purchase-orders');
  const { createUser } = require('./test-harness/seed-helpers');

  jest.setTimeout(45000);

  const TAG = `O9P0-${Date.now()}`;
  const ADVISORY_LOCK_KEY = 9010001;
  let fixtureLockClient;

  const created = {
    orderIds: [],
    productIds: [],
    supplierIds: [],
    relaisIds: [],
    userIds: [],
  };

  async function installFailureTriggers() {
    fixtureLockClient = await db.getClient();
    await fixtureLockClient.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);

    await fixtureLockClient.query('DROP TRIGGER IF EXISTS o9_fail_selected_alerts_trigger ON alerts');
    await fixtureLockClient.query('DROP FUNCTION IF EXISTS o9_fail_selected_alerts()');
    await fixtureLockClient.query(`
      CREATE FUNCTION o9_fail_selected_alerts() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.type IN (
          'paid_but_stock_blocked',
          'purchasing_po_creation_failed',
          'order_cancel_purchasing_blocked'
        )
        AND NEW.entity_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM orders
          WHERE id = NEW.entity_id
            AND reference LIKE 'ITEST-O9P0-%'
        ) THEN
          RAISE EXCEPTION 'O9 forced alerts failure for %', NEW.type;
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await fixtureLockClient.query(`
      CREATE TRIGGER o9_fail_selected_alerts_trigger
      BEFORE INSERT ON alerts
      FOR EACH ROW EXECUTE FUNCTION o9_fail_selected_alerts()
    `);

    await fixtureLockClient.query('DROP TRIGGER IF EXISTS o9_fail_selected_po_trigger ON purchase_orders');
    await fixtureLockClient.query('DROP FUNCTION IF EXISTS o9_fail_selected_po()');
    await fixtureLockClient.query(`
      CREATE FUNCTION o9_fail_selected_po() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.supplier_sku LIKE 'O9-FAIL-O9P0-%' THEN
          RAISE EXCEPTION 'O9 forced purchase_order failure for %', NEW.supplier_sku;
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await fixtureLockClient.query(`
      CREATE TRIGGER o9_fail_selected_po_trigger
      BEFORE INSERT ON purchase_orders
      FOR EACH ROW EXECUTE FUNCTION o9_fail_selected_po()
    `);
  }

  async function removeFailureTriggers() {
    if (!fixtureLockClient) return;
    await fixtureLockClient.query('DROP TRIGGER IF EXISTS o9_fail_selected_alerts_trigger ON alerts').catch(() => {});
    await fixtureLockClient.query('DROP FUNCTION IF EXISTS o9_fail_selected_alerts()').catch(() => {});
    await fixtureLockClient.query('DROP TRIGGER IF EXISTS o9_fail_selected_po_trigger ON purchase_orders').catch(() => {});
    await fixtureLockClient.query('DROP FUNCTION IF EXISTS o9_fail_selected_po()').catch(() => {});
    await fixtureLockClient.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => {});
    fixtureLockClient.release();
    fixtureLockClient = null;
  }

  async function seedRelais(suffix) {
    const { rows: [row] } = await db.query(
      `INSERT INTO relais (name, agent_name, phone, address, island, is_active)
       VALUES ($1,$2,$3,$4,$5,true) RETURNING *`,
      [
        `${TAG}-${suffix}-relais`,
        `${TAG}-${suffix}-agent`,
        `+2693${Math.floor(1000000 + Math.random() * 8999999)}`,
        'O9.1 integration test',
        'Ngazidja',
      ]
    );
    created.relaisIds.push(row.id);
    return row;
  }

  async function seedProduct(suffix, { stock = 10, priceKmf = 10000, priceEur = 20 } = {}) {
    const { rows: [row] } = await db.query(
      `INSERT INTO products (name, price_kmf, price_eur, stock, inventory_model, is_active)
       VALUES ($1,$2,$3,$4,'LEGACY_VARIANTS',true) RETURNING *`,
      [`${TAG}-${suffix}-product`, priceKmf, priceEur, stock]
    );
    created.productIds.push(row.id);
    return row;
  }

  async function seedOrder(suffix, {
    relaisId,
    paymentMode = 'paypal_eur',
    paymentStatus = 'pending',
    status = 'pending',
    totalKmf = 10000,
    totalEur = 20,
    paypalOrderId = null,
  } = {}) {
    const reference = `ITEST-${TAG}-${suffix}-${Math.random().toString(36).slice(2, 7)}`;
    const { rows: [row] } = await db.query(
      `INSERT INTO orders
         (reference, relais_id, total_kmf, total_eur, payment_mode, payment_status, status, paypal_order_id)
       VALUES ($1,$2,$3,$4,$5::payment_mode,$6,$7,$8) RETURNING *`,
      [reference, relaisId, totalKmf, totalEur, paymentMode, paymentStatus, status, paypalOrderId]
    );
    created.orderIds.push(row.id);
    return row;
  }

  async function seedOrderItem(orderId, productId, quantity = 1, priceKmf = 10000) {
    await db.query(
      `INSERT INTO order_items (order_id, product_id, quantity, price_kmf)
       VALUES ($1,$2,$3,$4)`,
      [orderId, productId, quantity, priceKmf]
    );
  }

  async function seedSupplierForProduct(suffix, productId, { supplierSku, platform = 'whatsapp' } = {}) {
    const { rows: [supplier] } = await db.query(
      `INSERT INTO suppliers (name, platform, contact_phone, auto_order, is_active)
       VALUES ($1,$2,$3,false,true) RETURNING *`,
      [`${TAG}-${suffix}-supplier`, platform, '971500000000']
    );
    created.supplierIds.push(supplier.id);

    const { rows: [ps] } = await db.query(
      `INSERT INTO product_suppliers
         (product_id, supplier_id, supplier_sku, supplier_price_aed, priority, is_active)
       VALUES ($1,$2,$3,30,1,true) RETURNING *`,
      [productId, supplier.id, supplierSku || `${TAG}-${suffix}-SKU`]
    );
    return { supplier, ps };
  }

  function fakePaypal({ amountEur, captureId, paypalOrderId }) {
    return {
      captureOrder: jest.fn().mockResolvedValue({ id: captureId, status: 'COMPLETED' }),
      extractCaptureInfo: jest.fn().mockReturnValue({
        status: 'COMPLETED',
        amount_value: amountEur,
        paypal_capture_id: captureId,
        paypal_order_id: paypalOrderId,
        payer_email: 'o9.1@paypal.test',
        payer_id: 'O9-PAYER',
        payer_name: 'O9 Payer',
        pay_in_4: false,
      }),
      verifyWebhookSignature: jest.fn().mockResolvedValue(true),
    };
  }

  async function cleanup() {
    if (created.orderIds.length) {
      await db.query('DELETE FROM alerts WHERE entity_id = ANY($1::uuid[])', [created.orderIds]).catch(() => {});
    }

    for (const id of created.orderIds) {
      await db.query('DELETE FROM purchase_orders WHERE order_id = $1', [id]).catch(() => {});
      await db.query('DELETE FROM cash_collections WHERE order_id = $1', [id]).catch(() => {});
      await db.query('DELETE FROM order_items WHERE order_id = $1', [id]).catch(() => {});
      await db.query('DELETE FROM orders WHERE id = $1', [id]).catch(() => {});
    }
    for (const id of created.productIds) {
      await db.query('DELETE FROM product_suppliers WHERE product_id = $1', [id]).catch(() => {});
      await db.query('DELETE FROM products WHERE id = $1', [id]).catch(() => {});
    }
    for (const id of created.supplierIds) {
      await db.query('DELETE FROM suppliers WHERE id = $1', [id]).catch(() => {});
    }
    for (const id of created.userIds) {
      await db.query('DELETE FROM users WHERE id = $1', [id]).catch(() => {});
    }
    for (const id of created.relaisIds) {
      await db.query('DELETE FROM relais WHERE id = $1', [id]).catch(() => {});
    }

    created.orderIds = [];
    created.productIds = [];
    created.supplierIds = [];
    created.relaisIds = [];
    created.userIds = [];
  }

  beforeAll(installFailureTriggers);
  afterEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await removeFailureTriggers();
  });

  describe('O9.1 — missing critical runtime proofs (REAL_DB)', () => {
    it('P0-B — PayPal stockBlocked: a real alerts SQL failure is contained by SAVEPOINT and business transaction COMMITs', async () => {
      const relais = await seedRelais('paypal');
      const product = await seedProduct('paypal', { stock: 1, priceKmf: 10000, priceEur: 20 });
      const order = await seedOrder('paypal', {
        relaisId: relais.id,
        paymentMode: 'paypal_eur',
        totalKmf: 10000,
        totalEur: 20,
        paypalOrderId: `${TAG}-PAYPAL-ORDER`,
      });
      await seedOrderItem(order.id, product.id, 2, 10000);

      const result = await paymentPaypal.capturePaypalOrder(
        order.paypal_order_id,
        order,
        fakePaypal({
          amountEur: 20,
          captureId: `${TAG}-CAPTURE`,
          paypalOrderId: order.paypal_order_id,
        }),
        db
      );

      expect(result.success).toBe(true);
      expect(result.stock_blocked).toBe(true);

      const { rows: [after] } = await db.query(
        `SELECT payment_status, paypal_capture_id, notes, pickup_secret_hash
         FROM orders WHERE id = $1`,
        [order.id]
      );
      expect(after.payment_status).toBe('paid');
      expect(after.paypal_capture_id).toBe(`${TAG}-CAPTURE`);
      expect(after.notes).toContain('paid_but_stock_blocked');
      expect(after.pickup_secret_hash).not.toBeNull();

      const { rows: [afterProduct] } = await db.query('SELECT stock FROM products WHERE id = $1', [product.id]);
      expect(afterProduct.stock).toBe(1);

      const { rows: failedAlertRows } = await db.query(
        "SELECT id FROM alerts WHERE type = 'paid_but_stock_blocked' AND entity_id = $1",
        [order.id]
      );
      expect(failedAlertRows).toHaveLength(0);
    });

    it('P0-D — Cash cross-relais: security alert uses pool, survives caller ROLLBACK, and caller client remains healthy', async () => {
      const orderRelais = await seedRelais('cash-order');
      const agentRelais = await seedRelais('cash-agent');
      const order = await seedOrder('cash', {
        relaisId: orderRelais.id,
        paymentMode: 'cash_relais',
        totalKmf: 15000,
        totalEur: 30,
      });
      const agent = await createUser({ role: 'agent_relais', relais_id: agentRelais.id });
      created.userIds.push(agent.id);

      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        const result = await collectCash({
          orderId: order.id,
          agentUser: { id: agent.id, role: 'agent_relais', relais_id: agentRelais.id },
          dbClient: client,
        });

        expect(result.cross_relais_blocked).toBe(true);
        await expect(client.query('SELECT 1')).resolves.toBeTruthy();
        await client.query('ROLLBACK');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }

      const { rows: alerts } = await db.query(
        "SELECT type, entity_id FROM alerts WHERE type = 'cash_collect_cross_relais_blocked' AND entity_id = $1",
        [order.id]
      );
      expect(alerts).toHaveLength(1);
      expect(alerts[0].entity_id).toBe(order.id);

      const { rows: [after] } = await db.query('SELECT payment_status, status FROM orders WHERE id = $1', [order.id]);
      expect(after.payment_status).toBe('pending');
      expect(after.status).toBe('pending');
    });

    it('P0-E — Purchasing savepoints: one PO fails, its alert also fails at SQL level, but other POs still COMMIT', async () => {
      const relais = await seedRelais('purchasing');
      const order = await seedOrder('purchasing', {
        relaisId: relais.id,
        paymentMode: 'cash_relais',
        paymentStatus: 'paid',
        status: 'ordered',
        totalKmf: 30000,
        totalEur: 60,
      });

      const p1 = await seedProduct('p1');
      const p2 = await seedProduct('p2');
      const p3 = await seedProduct('p3');
      await seedOrderItem(order.id, p1.id, 1);
      await seedOrderItem(order.id, p2.id, 1);
      await seedOrderItem(order.id, p3.id, 1);

      await seedSupplierForProduct('p1', p1.id, { supplierSku: `${TAG}-OK-1` });
      await seedSupplierForProduct('p2', p2.id, { supplierSku: `O9-FAIL-${TAG}` });
      await seedSupplierForProduct('p3', p3.id, { supplierSku: `${TAG}-OK-3` });

      const result = await triggerPurchasing(order.id);

      expect(result.purchase_orders).toHaveLength(3);
      expect(result.purchase_orders.filter(r => r.status === 'error')).toHaveLength(1);
      expect(result.purchase_orders.filter(r => r.purchase_order_id)).toHaveLength(2);

      const { rows: pos } = await db.query(
        'SELECT supplier_sku, status FROM purchase_orders WHERE order_id = $1 ORDER BY supplier_sku',
        [order.id]
      );
      expect(pos).toHaveLength(2);
      expect(pos.map(po => po.supplier_sku)).toEqual(expect.arrayContaining([`${TAG}-OK-1`, `${TAG}-OK-3`]));
      expect(pos.some(po => po.supplier_sku.startsWith('O9-FAIL-'))).toBe(false);

      const { rows: failedAlertRows } = await db.query(
        "SELECT id FROM alerts WHERE type = 'purchasing_po_creation_failed' AND entity_id = $1",
        [order.id]
      );
      expect(failedAlertRows).toHaveLength(0);
    });

    it('P0-F — Cancel order with engaged PO: real alerts SQL failure cannot abort the parent transaction', async () => {
      const relais = await seedRelais('cancel');
      const order = await seedOrder('cancel', {
        relaisId: relais.id,
        paymentMode: 'cash_relais',
        paymentStatus: 'paid',
        status: 'ordered',
      });

      const pendingProduct = await seedProduct('cancel-pending');
      const confirmedProduct = await seedProduct('cancel-confirmed');
      const { ps: pendingPs } = await seedSupplierForProduct('cancel-pending', pendingProduct.id, { supplierSku: `${TAG}-CANCEL-PENDING` });
      const { ps: confirmedPs } = await seedSupplierForProduct('cancel-confirmed', confirmedProduct.id, { supplierSku: `${TAG}-CANCEL-CONFIRMED` });

      const { rows: [pendingPo] } = await db.query(
        `INSERT INTO purchase_orders
           (order_id, supplier_id, product_supplier_id, supplier_sku, qty, unit_price_aed, status, trigger_mode)
         VALUES ($1,$2,$3,$4,1,30,'pending','manual') RETURNING id`,
        [order.id, pendingPs.supplier_id, pendingPs.id, pendingPs.supplier_sku]
      );
      const { rows: [confirmedPo] } = await db.query(
        `INSERT INTO purchase_orders
           (order_id, supplier_id, product_supplier_id, supplier_sku, qty, unit_price_aed, status, trigger_mode)
         VALUES ($1,$2,$3,$4,1,30,'confirmed','manual') RETURNING id`,
        [order.id, confirmedPs.supplier_id, confirmedPs.id, confirmedPs.supplier_sku]
      );

      const client = await db.getClient();
      let result;
      try {
        await client.query('BEGIN');
        result = await syncPurchaseOrdersOnOrderCancel(client, {
          orderId: order.id,
          orderReference: order.reference,
          actor: { id: null, role: 'system' },
          reason: `${TAG} forced cancellation`,
        });

        await client.query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [order.id]);
        await expect(client.query('SELECT 1')).resolves.toBeTruthy();
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }

      expect(result.auto_cancelled).toBe(1);
      expect(result.blocking).toBe(1);

      const { rows: [afterOrder] } = await db.query('SELECT status FROM orders WHERE id = $1', [order.id]);
      expect(afterOrder.status).toBe('cancelled');

      const { rows: pos } = await db.query(
        'SELECT id, status FROM purchase_orders WHERE id = ANY($1::uuid[]) ORDER BY id',
        [[pendingPo.id, confirmedPo.id]]
      );
      const byId = new Map(pos.map(po => [po.id, po.status]));
      expect(byId.get(pendingPo.id)).toBe('cancelled');
      expect(byId.get(confirmedPo.id)).toBe('confirmed');

      const { rows: failedAlertRows } = await db.query(
        "SELECT id FROM alerts WHERE type = 'order_cancel_purchasing_blocked' AND entity_id = $1",
        [order.id]
      );
      expect(failedAlertRows).toHaveLength(0);
    });
  });
}
