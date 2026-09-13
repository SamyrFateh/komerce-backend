'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * PREUVE MODEL_SIMULATION_READY — raccord vente → achat exact.
 *
 * Ce test utilise une vraie Postgres et le vrai trigger Purchasing. Il crée un
 * produit avec DEUX SKU fournisseur, vend explicitement le SKU B, laisse un
 * product_suppliers.supplier_sku volontairement générique, puis exige que la
 * Purchase Order snapshotte le SKU B et sa Supplier Order Identity exacte.
 *
 * Rouge avant le raccord canonique : le vieux trigger reprend le supplier_sku
 * product-level et perd l'identité de variante vendue.
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('Purchasing exact SKU PO (REAL_DB) — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const db = require('../../db');
  const { triggerPurchasing } = require('../../services/purchasing-trigger-service');

  const TAG = `itest-exact-po-${Date.now()}`;
  const created = { orderIds: [], productIds: [], supplierIds: [], relaisIds: [] };

  async function seedFixture() {
    const { rows: [relais] } = await db.query(
      `INSERT INTO relais (name, agent_name, phone, address, island, is_active)
       VALUES ($1,$2,$3,$4,$5,true) RETURNING id`,
      [`${TAG} relais`, `${TAG} agent`, '+2693999999', 'ITest Moroni', 'Ngazidja']
    );
    created.relaisIds.push(relais.id);

    const { rows: [product] } = await db.query(
      `INSERT INTO products (name, price_kmf, stock, is_active, inventory_model)
       VALUES ($1,10000,0,true,'SKU') RETURNING id`,
      [`${TAG} produit`]
    );
    created.productIds.push(product.id);

    const { rows: [supplier] } = await db.query(
      `INSERT INTO suppliers (name, platform, auto_order, is_active)
       VALUES ($1,'aliexpress',false,true) RETURNING id`,
      [`${TAG} AliExpress`]
    );
    created.supplierIds.push(supplier.id);

    await db.query(
      `INSERT INTO product_suppliers
         (product_id, supplier_id, supplier_sku, supplier_price_aed,
          supplier_url, priority, is_active)
       VALUES ($1,$2,'GENERIC-PRODUCT-SKU',30,'https://example.invalid/product',1,true)`,
      [product.id, supplier.id]
    );

    const identityA = {
      provider: 'aliexpress', version: 1,
      payload: { sku_attr: '14:Red;5:L' },
    };
    const identityB = {
      provider: 'aliexpress', version: 1,
      payload: { sku_attr: '14:Black;5:M' },
    };

    await db.query(
      `INSERT INTO product_skus
         (product_id, sku, variant_combo, stock, is_active, source,
          supplier_sku, supplier_unit_ref, supplier_order_identity)
       VALUES ($1,'K-RED-L',$2::jsonb,20,true,'SUPPLIER',
               'AE-RED-L','14:Red;5:L',$3::jsonb)`,
      [product.id, JSON.stringify({ color: 'Red', size: 'L' }), JSON.stringify(identityA)]
    );

    const { rows: [skuB] } = await db.query(
      `INSERT INTO product_skus
         (product_id, sku, variant_combo, stock, is_active, source,
          supplier_sku, supplier_unit_ref, supplier_order_identity)
       VALUES ($1,'K-BLACK-M',$2::jsonb,20,true,'SUPPLIER',
               'AE-BLACK-M','14:Black;5:M',$3::jsonb)
       RETURNING id`,
      [product.id, JSON.stringify({ color: 'Black', size: 'M' }), JSON.stringify(identityB)]
    );

    const ref = `ITEST-EXACT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const { rows: [order] } = await db.query(
      `INSERT INTO orders
         (reference, relais_id, total_kmf, payment_mode, payment_status, status)
       VALUES ($1,$2,10000,'cash_relais','paid','ordered') RETURNING id, reference`,
      [ref, relais.id]
    );
    created.orderIds.push(order.id);

    const { rows: [orderItem] } = await db.query(
      `INSERT INTO order_items
         (order_id, product_id, quantity, price_kmf, sku_id,
          variant_combo, fulfillment_source)
       VALUES ($1,$2,1,10000,$3,$4::jsonb,'IMPORT')
       RETURNING id`,
      [order.id, product.id, skuB.id, JSON.stringify({ color: 'Black', size: 'M' })]
    );

    return { order, orderItem, skuB, identityB };
  }

  async function cleanup() {
    for (const id of created.orderIds) {
      await db.query('DELETE FROM purchase_orders WHERE order_id = $1', [id]).catch(() => {});
      await db.query('DELETE FROM order_items WHERE order_id = $1', [id]).catch(() => {});
      await db.query('DELETE FROM orders WHERE id = $1', [id]).catch(() => {});
    }
    for (const id of created.productIds) {
      await db.query('DELETE FROM product_suppliers WHERE product_id = $1', [id]).catch(() => {});
      await db.query('DELETE FROM product_skus WHERE product_id = $1', [id]).catch(() => {});
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

  describe('Purchasing — exact sold SKU → exact supplier PO (REAL_DB)', () => {
    afterEach(cleanup);
    afterAll(async () => { await db.pool?.end?.(); });

    it('rachète exactement le SKU vendu et snapshotte sa Supplier Order Identity', async () => {
      const { order, orderItem, skuB, identityB } = await seedFixture();

      const result = await triggerPurchasing(order.id);
      expect(result.purchase_orders).toHaveLength(1);
      expect(result.purchase_orders[0].purchase_order_id).toBeTruthy();

      const { rows: [po] } = await db.query(
        `SELECT order_item_id, product_sku_id, supplier_sku,
                supplier_unit_ref, supplier_order_identity, qty
           FROM purchase_orders
          WHERE id = $1`,
        [result.purchase_orders[0].purchase_order_id]
      );

      expect(po.order_item_id).toBe(orderItem.id);
      expect(po.product_sku_id).toBe(skuB.id);
      expect(po.supplier_sku).toBe('AE-BLACK-M');
      expect(po.supplier_sku).not.toBe('GENERIC-PRODUCT-SKU');
      expect(po.supplier_unit_ref).toBe('14:Black;5:M');
      expect(po.supplier_order_identity).toEqual(identityB);
      expect(po.qty).toBe(1);
    });
  });
}
