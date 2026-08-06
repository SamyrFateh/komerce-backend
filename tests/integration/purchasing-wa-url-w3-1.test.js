'use strict';


/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * LOT R3 — DEBT-03 / FSF-03 — preuve W3-1 (REAL_DB_INTEGRATION)
 *
 * Bug : notifySupplierWhatsApp() écrivait le `wa_url` via `db.query()` (pool,
 * connexion séparée) sur une ligne `purchase_orders` insérée dans la
 * transaction encore ouverte (client transactionnel de triggerPurchasing).
 * Sous READ COMMITTED, le pool ne voit pas la ligne non commitée → l'UPDATE
 * touche 0 ligne, silencieusement (UPDATE ne throw jamais sur 0 ligne
 * affectée) → le `wa_url` est perdu après COMMIT.
 *
 * Ce test tourne contre une VRAIE Postgres (aucun mock de `db`/`client`) car
 * c'est précisément l'isolation transactionnelle réelle qui révèle le bug —
 * un mock (cf. tests/unit/purchasing-trigger-service.test.js) ne la modélise
 * pas et ne peut donc jamais l'attraper.
 *
 * Rouge avant fix (notifySupplierWhatsApp utilise `db.query` — pool) :
 *   purchase_orders.notes reste NULL après COMMIT → assertion échoue.
 * Vert après fix (notifySupplierWhatsApp reçoit et utilise le `client`
 *   transactionnel) : purchase_orders.notes contient bien `wa_url:...`.
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  // Skip bruyant, explicite — jamais silencieux (doctrine §2).
  describe.skip('LOT R3 — wa_url purchasing WhatsApp (REAL_DB) — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const db = require('../../db');
  const { triggerPurchasing } = require('../../services/purchasing-trigger-service');

  const ITEST_TAG = 'itest-r3-wa-url';
  const created = { orderIds: [], productIds: [], supplierIds: [], relaisIds: [] };

  async function seedFixture() {
    const { rows: [relais] } = await db.query(
      `INSERT INTO relais (name, agent_name, phone, address, island, is_active)
       VALUES ($1,$2,$3,$4,$5,true) RETURNING id`,
      [
        `${ITEST_TAG} relais`,
        `${ITEST_TAG} agent`,
        `+2693${Math.floor(1000000 + Math.random() * 8999999)}`,
        'ITest address, Moroni',
        'Ngazidja',
      ]
    );
    created.relaisIds.push(relais.id);

    const { rows: [product] } = await db.query(
      `INSERT INTO products (name, price_kmf, stock, is_active)
       VALUES ($1,$2,$3,true) RETURNING id`,
      [`${ITEST_TAG} produit`, 10000, 50]
    );
    created.productIds.push(product.id);

    const { rows: [supplier] } = await db.query(
      `INSERT INTO suppliers (name, platform, contact_phone, auto_order, is_active)
       VALUES ($1,'whatsapp',$2,false,true) RETURNING id`,
      [`${ITEST_TAG} fournisseur`, '971500000000']
    );
    created.supplierIds.push(supplier.id);

    await db.query(
      `INSERT INTO product_suppliers
         (product_id, supplier_id, supplier_sku, supplier_price_aed, priority, is_active)
       VALUES ($1,$2,$3,$4,1,true)`,
      [product.id, supplier.id, `${ITEST_TAG}-sku`, 30]
    );

    const ref = `ITEST-R3-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const { rows: [order] } = await db.query(
      `INSERT INTO orders
         (reference, relais_id, total_kmf, payment_mode, payment_status, status)
       VALUES ($1,$2,$3,'cash_relais','paid','ordered') RETURNING id, reference`,
      [ref, relais.id, 10000]
    );
    created.orderIds.push(order.id);

    await db.query(
      `INSERT INTO order_items (order_id, product_id, quantity, price_kmf)
       VALUES ($1,$2,1,10000)`,
      [order.id, product.id]
    );

    return { order, product, supplier };
  }

  async function cleanup() {
    for (const id of created.orderIds) {
      await db.query('DELETE FROM purchase_orders WHERE order_id = $1', [id]).catch(() => {});
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
    for (const id of created.relaisIds) {
      await db.query('DELETE FROM relais WHERE id = $1', [id]).catch(() => {});
    }
    created.orderIds = [];
    created.productIds = [];
    created.supplierIds = [];
    created.relaisIds = [];
  }

  describe('LOT R3 — DEBT-03/FSF-03 — wa_url persisté après COMMIT (REAL_DB)', () => {
    afterEach(cleanup);
    afterAll(async () => { await db.pool?.end?.(); });

    it('W3-1 : notifySupplierWhatsApp écrit le wa_url dans purchase_orders.notes, visible après COMMIT', async () => {
      const { order } = await seedFixture();

      const result = await triggerPurchasing(order.id);

      expect(result.purchase_orders).toHaveLength(1);
      expect(result.purchase_orders[0].status).toBe('whatsapp_sent');
      const poId = result.purchase_orders[0].purchase_order_id;
      expect(poId).toBeTruthy();

      // Lecture APRÈS le retour de triggerPurchasing (donc après COMMIT) —
      // c'est exactement le scénario qui révélait le bug : une connexion
      // séparée (ici db.query, le pool) doit voir la ligne mise à jour.
      const { rows: [po] } = await db.query(
        'SELECT notes, status FROM purchase_orders WHERE id = $1', [poId]
      );

      expect(po.status).toBe('notified');
      expect(po.notes).toEqual(expect.stringContaining('wa_url:'));
      expect(po.notes).toEqual(expect.stringContaining('https://wa.me/971500000000'));
    });
  });
}
