'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration supplier-source-resolution-postgres.test.js
 * @brief Source unique du fournisseur d'achat (product_suppliers + priorité) — preuve PostgreSQL réelle : plusieurs fournisseurs par plateforme, priorité, lignes figées, garde catalogue, désactivation, eBay, script d'audit.
 */

if (!process.env.DATABASE_URL) {
  describe.skip('supplier-source-resolution (REAL_DB) — SKIPPED: no DATABASE_URL', () => { it('requires DATABASE_URL', () => {}); });
} else {
  const db = require('../../db');
  const { triggerPurchasing } = require('../../services/purchasing-trigger-service');
  const { sellableCatalogUnitSql } = require('../../services/catalog-public-view');
  const { resolveSupplierSource, SOURCE_STATUS, assertSourceRemovable } = require('../../services/supplier-source-resolution');
  const { deleteSupplier } = require('../../services/purchasing-admin-service');
  const { runAudit } = require('../../scripts/recette/audit-sku-supplier-link');

  jest.setTimeout(30000);
  const TAG = `itest-ssr-${Date.now()}`;
  const made = { products: [], suppliers: [], orders: [], relais: [] };
  let market; let relais;

  const identity = (provider) => ({ provider, version: 1, payload: { sku_attr: 'x' } });

  async function supplier(platform, label, extra = {}) {
    const { rows: [s] } = await db.query(
      `INSERT INTO suppliers (name, platform, auto_order, is_active, owner_scope) VALUES ($1,$2,false,$3,$4) RETURNING id`,
      [`${TAG} ${label}`, platform, extra.active !== false, extra.ownerScope || null]);
    made.suppliers.push(s.id);
    return s.id;
  }
  async function product(label = 'p') {
    const { rows: [p] } = await db.query(
      `INSERT INTO products (name, price_kmf, stock, is_active, inventory_model) VALUES ($1,10000,0,true,'SKU') RETURNING id`,
      [`${TAG} ${label}`]);
    made.products.push(p.id);
    return p.id;
  }
  async function assoc(productId, supplierId, priority, price = 10) {
    const { rows: [a] } = await db.query(
      `INSERT INTO product_suppliers (product_id, supplier_id, supplier_sku, supplier_price_aed, priority, is_active)
       VALUES ($1,$2,'GEN',$3,$4,true) RETURNING id`, [productId, supplierId, price, priority]);
    return a.id;
  }
  async function sku(productId, provider = 'aliexpress', code = 'S1') {
    const { rows: [k] } = await db.query(
      `INSERT INTO product_skus (product_id, sku, variant_combo, stock, is_active, source, supplier_sku, supplier_unit_ref, supplier_order_identity)
       VALUES ($1,$2,'{}'::jsonb,5,true,'SUPPLIER',$2,'ref-1',$3::jsonb) RETURNING id`,
      [productId, `${TAG}-${code}`, JSON.stringify(identity(provider))]);
    return k.id;
  }
  const sellable = async (productId) => {
    const { rows } = await db.query(`SELECT 1 FROM products p WHERE p.id = $1 AND ${sellableCatalogUnitSql('p')}`, [productId]);
    return rows.length === 1;
  };
  async function importOrder(productId) {
    const { rows: [o] } = await db.query(
      `INSERT INTO orders (reference, relais_id, market_id, total_kmf, payment_mode, payment_status, status)
       VALUES ($1,$2,$3,10000,'cash_relais','paid','ordered') RETURNING id, reference`,
      [`${TAG}-${made.orders.length}`, relais, market]);
    made.orders.push(o.id);
    const { rows: [it] } = await db.query(
      `INSERT INTO order_items (order_id, product_id, quantity, price_kmf, fulfillment_source)
       VALUES ($1,$2,1,10000,'IMPORT') RETURNING id`, [o.id, productId]);
    return { orderId: o.id, itemId: it.id };
  }

  beforeAll(async () => {
    let { rows: [m] } = await db.query(`SELECT id FROM markets WHERE code = 'KM' LIMIT 1`);
    if (!m) ({ rows: [m] } = await db.query(
      `INSERT INTO markets (code, name, currency, minor_unit, is_active) VALUES ('KM','Comores','KMF',0,true) RETURNING id`));
    market = m.id;
    const { rows: [r] } = await db.query(
      `INSERT INTO relais (name, agent_name, phone, address, island, market_id, is_active)
       VALUES ($1,'a','+2693999999','x','Ngazidja',$2,true) RETURNING id`, [`${TAG} relais`, market]);
    relais = r.id; made.relais.push(r.id);
  });

  afterAll(async () => {
    const ids = made.products;
    await db.query(`DELETE FROM purchase_lines WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = ANY($1::uuid[]))`, [made.orders]).catch(() => {});
    await db.query(`DELETE FROM order_items WHERE order_id = ANY($1::uuid[])`, [made.orders]).catch(() => {});
    await db.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [made.orders]).catch(() => {});
    await db.query(`DELETE FROM product_skus WHERE product_id = ANY($1::uuid[])`, [ids]).catch(() => {});
    await db.query(`DELETE FROM product_suppliers WHERE product_id = ANY($1::uuid[])`, [ids]).catch(() => {});
    await db.query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [ids]).catch(() => {});
    await db.query(`DELETE FROM suppliers WHERE id = ANY($1::uuid[])`, [made.suppliers]).catch(() => {});
    await db.query(`DELETE FROM relais WHERE id = ANY($1::uuid[])`, [made.relais]).catch(() => {});
  });

  test('plusieurs fournisseurs sur une même plateforme : la plus haute priorité est retenue', async () => {
    const p = await product();
    const s1 = await supplier('aliexpress', 'ae-1');
    const s2 = await supplier('aliexpress', 'ae-2');
    await assoc(p, s2, 2);
    await assoc(p, s1, 1);
    const res = await resolveSupplierSource(db, { productId: p, provider: 'aliexpress' });
    expect(res.status).toBe(SOURCE_STATUS.RESOLVED);
    expect(res.mapping.supplier_id).toBe(s1);
    expect(res.candidates).toHaveLength(2);
  });

  test('la plateforme du fournisseur doit égaler le provider du SKU ; owner_scope hub et fournisseur inactif sont inadmissibles', async () => {
    const p = await product();
    await assoc(p, await supplier('cj', 'cj'), 1);
    await assoc(p, await supplier('local', 'hub', { ownerScope: 'hub' }), 2);
    await assoc(p, await supplier('aliexpress', 'ae-off', { active: false }), 3);
    expect((await resolveSupplierSource(db, { productId: p, provider: 'aliexpress' })).status).toBe(SOURCE_STATUS.UNRESOLVED);
    expect((await resolveSupplierSource(db, { productId: p, provider: 'local' })).status).toBe(SOURCE_STATUS.UNRESOLVED);
    expect((await resolveSupplierSource(db, { productId: p, provider: 'cj' })).status).toBe(SOURCE_STATUS.RESOLVED);
  });

  test('ambiguïté impossible en base : priorité unique parmi les associations actives (23505), réutilisable après soft delete', async () => {
    const p = await product();
    const a = await assoc(p, await supplier('aliexpress', 'a'), 1);
    await expect(assoc(p, await supplier('aliexpress', 'b'), 1)).rejects.toMatchObject({ code: '23505', constraint: 'ux_product_suppliers_active_priority' });
    await db.query(`UPDATE product_suppliers SET deleted_at = NOW() WHERE id = $1`, [a]);
    await expect(assoc(p, await supplier('aliexpress', 'c'), 1)).resolves.toBeTruthy();
  });

  test('eBay refusé dans la résolution, même avec une association ebay-like sur la plateforme', async () => {
    const p = await product();
    await assoc(p, await supplier('aliexpress', 'ae'), 1);
    expect((await resolveSupplierSource(db, { productId: p, provider: 'ebay' })).status).toBe(SOURCE_STATUS.FORBIDDEN_PROVIDER);
  });

  test('garde catalogue : SKU vendable seulement avec une source admissible ; perte de la source → non vendable', async () => {
    const p = await product();
    await sku(p, 'aliexpress');
    expect(await sellable(p)).toBe(false);
    const s = await supplier('aliexpress', 'ae');
    const a = await assoc(p, s, 1);
    expect(await sellable(p)).toBe(true);
    await db.query(`UPDATE suppliers SET is_active = FALSE WHERE id = $1`, [s]);
    expect(await sellable(p)).toBe(false);
    await db.query(`UPDATE suppliers SET is_active = TRUE WHERE id = $1`, [s]);
    await db.query(`UPDATE product_suppliers SET is_active = FALSE WHERE id = $1`, [a]);
    expect(await sellable(p)).toBe(false);
  });

  test('SKU eBay existant : jamais vendable ; le script d\'audit le recense et la lecture seule est respectée', async () => {
    const p = await product('ebay');
    const s = await supplier('aliexpress', 'ae');
    await assoc(p, s, 1);
    const k = await sku(p, 'ebay', 'EB');
    expect(await sellable(p)).toBe(false);
    const report = await runAudit(db);
    expect(report.ebay_identities.map((r) => r.sku_id)).toContain(k);
    expect(report.published_without_eligible_source.map((r) => r.sku_id)).toContain(k);
    const p2 = await product('audit-ok');
    await assoc(p2, s, 1);
    const k2 = await sku(p2, 'aliexpress', 'OK');
    const after = await runAudit(db);
    expect(after.published_without_eligible_source.map((r) => r.sku_id)).not.toContain(k2);
    expect(after.counts).toEqual(expect.objectContaining({ ebay_identities: expect.any(Number) }));
  });

  test('création automatique de ligne d\'achat : fournisseur prioritaire figé ; un changement de priorité ultérieur ne modifie pas les lignes existantes', async () => {
    const p = await product();
    const s1 = await supplier('aliexpress', 'ae-1');
    const s2 = await supplier('aliexpress', 'ae-2');
    const a1 = await assoc(p, s1, 1);
    const a2 = await assoc(p, s2, 2);
    const first = await importOrder(p);
    const r1 = await triggerPurchasing(first.orderId);
    expect(r1.purchase_orders[0].status).toBe('line_opened');
    const { rows: [l1] } = await db.query(`SELECT supplier_id, product_supplier_id FROM purchase_lines WHERE order_item_id = $1`, [first.itemId]);
    expect(l1).toEqual({ supplier_id: s1, product_supplier_id: a1 });

    // inversion des priorités (passage par une valeur libre : l'index unique interdit l'égalité transitoire)
    await db.query(`UPDATE product_suppliers SET priority = 9 WHERE id = $1`, [a1]);
    await db.query(`UPDATE product_suppliers SET priority = 1 WHERE id = $1`, [a2]);
    await db.query(`UPDATE product_suppliers SET priority = 2 WHERE id = $1`, [a1]);
    const { rows: [still] } = await db.query(`SELECT supplier_id, product_supplier_id FROM purchase_lines WHERE order_item_id = $1`, [first.itemId]);
    expect(still).toEqual({ supplier_id: s1, product_supplier_id: a1 });

    const second = await importOrder(p);
    await triggerPurchasing(second.orderId);
    const { rows: [l2] } = await db.query(`SELECT supplier_id FROM purchase_lines WHERE order_item_id = $1`, [second.itemId]);
    expect(l2.supplier_id).toBe(s2);
  });

  test('sourcing non résolu : aucune ligne, résultat no_supplier (« Sourcing requis »)', async () => {
    const p = await product();
    const o = await importOrder(p);
    const r = await triggerPurchasing(o.orderId);
    expect(r.purchase_orders[0].status).toBe('no_supplier');
    const { rows } = await db.query(`SELECT 1 FROM purchase_lines WHERE order_item_id = $1`, [o.itemId]);
    expect(rows).toHaveLength(0);
    const report = await runAudit(db);
    const row = report.paid_import_without_purchase_line.find((r2) => r2.order_item_id === o.itemId);
    expect(row).toMatchObject({ eligible_source_present: false });
  });

  describe('désactivation fournisseur', () => {
    test('refusée (409) s\'il est la dernière source de produits vendables, la liste des produits est fournie', async () => {
      const p = await product('sole');
      const s = await supplier('aliexpress', 'sole');
      await assoc(p, s, 1);
      await sku(p, 'aliexpress');
      await expect(deleteSupplier(s)).rejects.toMatchObject({
        status: 409, code: 'SUPPLIER_SOLE_SOURCE_OF_SELLABLE_PRODUCTS',
        details: { products: [expect.objectContaining({ id: p })] },
      });
      const { rows: [row] } = await db.query(`SELECT deleted_at FROM suppliers WHERE id = $1`, [s]);
      expect(row.deleted_at).toBeNull();
    });

    test('autorisée si une autre source admissible prend le relais (historique conservé : soft delete)', async () => {
      const p = await product('relay');
      const s1 = await supplier('aliexpress', 'r1');
      const s2 = await supplier('aliexpress', 'r2');
      await assoc(p, s1, 1);
      await assoc(p, s2, 2);
      await sku(p, 'aliexpress');
      await expect(deleteSupplier(s1)).resolves.toMatchObject({ deleted: true });
      const { rows: [row] } = await db.query(`SELECT deleted_at FROM suppliers WHERE id = $1`, [s1]);
      expect(row.deleted_at).not.toBeNull();
      expect(await sellable(p)).toBe(true);
    });

    test('autorisée si les produits sont retirés de la vente (SKU inactifs)', async () => {
      const p = await product('retired');
      const s = await supplier('aliexpress', 'ret');
      await assoc(p, s, 1);
      const k = await sku(p, 'aliexpress');
      await db.query(`UPDATE product_skus SET is_active = FALSE WHERE id = $1`, [k]);
      await expect(deleteSupplier(s)).resolves.toMatchObject({ deleted: true });
    });

    test('refusée (409) avec une ligne d\'achat ouverte non terminée', async () => {
      const p = await product('open');
      const s1 = await supplier('aliexpress', 'o1');
      await assoc(p, s1, 1);
      const o = await importOrder(p);
      await triggerPurchasing(o.orderId);
      await expect(deleteSupplier(s1)).rejects.toMatchObject({ status: 409, code: 'SUPPLIER_HAS_OPEN_ENGAGEMENTS' });
    });

    test('désactivation d\'une association seule : même garde', async () => {
      const p = await product('assoc');
      const s = await supplier('aliexpress', 'as');
      const a = await assoc(p, s, 1);
      await sku(p, 'aliexpress');
      await expect(assertSourceRemovable(db, { supplierId: s, productSupplierId: a }))
        .rejects.toMatchObject({ status: 409, code: 'SUPPLIER_SOLE_SOURCE_OF_SELLABLE_PRODUCTS' });
    });
  });
}
