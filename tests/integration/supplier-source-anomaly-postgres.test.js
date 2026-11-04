'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration supplier-source-anomaly-postgres.test.js
 * @brief Certification PostgreSQL réelle des DEUX protections de la source unique fournisseur : (1) garde de désactivation (409, données strictement inchangées, relais autorisé) ; (2) anomalie « Sourcing requis » sur donnée historique incohérente insérée en SQL (dossier Hub, achats refusés côté serveur).
 */

jest.setTimeout(60000);

if (!process.env.DATABASE_URL) {
  describe.skip('supplier-source-anomaly (needs DATABASE_URL)', () => { test('skipped', () => {}); });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const grouped = require('../../services/purchasing-grouped-service');
  const engagement = require('../../services/purchasing-engagement-service');
  const dossierService = require('../../services/hub-procurement-dossier');
  const { triggerPurchasing } = require('../../services/purchasing-trigger-service');
  const { deleteSupplier } = require('../../services/purchasing-admin-service');
  const { assertSourceRemovable } = require('../../services/supplier-source-resolution');
  const { sellableCatalogUnitSql } = require('../../services/catalog-public-view');

  const id = () => crypto.randomUUID();
  const q = (sql, params) => db.query(sql, params);
  const tag = `SSA-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  let km; let relais; let admin; let agent;
  const made = { products: [], suppliers: [], orders: [], users: [] };

  async function user(role, label) {
    const uid = id();
    await q('INSERT INTO users(id,full_name,email,phone,role) VALUES($1,$2,$3,$4,$5)',
      [uid, `${label} ${tag}`, `${label}-${tag}@komerce.test`.toLowerCase(), `+2693${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, role]);
    made.users.push(uid);
    return { id: uid, role };
  }
  async function supplier(label, { active = true, platform = 'aliexpress' } = {}) {
    const sid = id();
    await q('INSERT INTO suppliers(id,name,platform,is_active) VALUES($1,$2,$3,$4)', [sid, `${label} ${tag}`, platform, active]);
    made.suppliers.push(sid);
    return sid;
  }
  async function product(label) {
    const pid = id(); const skuId = id();
    await q(`INSERT INTO products(id,name,price_kmf,cost_kmf,volume_cm3,stock,price_aed,is_active,inventory_model)
             VALUES($1,$2,10000,3000,1000,0,100,true,'SKU')`, [pid, `Produit ${label} ${tag}`]);
    made.products.push(pid);
    const identity = { provider: 'aliexpress', version: 1, payload: { sku_attr: label } };
    await q(`INSERT INTO product_skus(id,product_id,sku,stock,is_active,source,supplier_sku,supplier_unit_ref,supplier_order_identity)
             VALUES($1,$2,$3,5,true,'SUPPLIER',$4,$5,$6::jsonb)`,
    [skuId, pid, `${tag}-${label}`, `${tag}-${label}-S`, `${tag}-${label}-U`, JSON.stringify(identity)]);
    return { id: pid, skuId, name: `Produit ${label} ${tag}` };
  }
  const assoc = async (productId, supplierId, priority, extra = {}) => {
    const aid = id();
    await q(`INSERT INTO product_suppliers(id,product_id,supplier_id,supplier_sku,supplier_price_aed,priority,is_active,deleted_at)
             VALUES($1,$2,$3,'GEN',42,$4,$5,$6)`, [aid, productId, supplierId, priority, extra.active !== false, extra.deletedAt || null]);
    return aid;
  };
  const published = async (productId) =>
    (await q(`SELECT 1 FROM products p WHERE p.id=$1 AND p.is_active AND ${sellableCatalogUnitSql('p')}`, [productId])).rows.length === 1;

  // Instantané intégral : fournisseurs, associations et produit publié (+ SKU) — comparé avant/après un refus.
  async function snapshot(productId, supplierIds) {
    const rows = async (sql, p) => (await q(sql, p)).rows;
    return {
      suppliers: await rows('SELECT to_jsonb(t) AS r FROM suppliers t WHERE id = ANY($1::uuid[]) ORDER BY id', [supplierIds]),
      associations: await rows('SELECT to_jsonb(t) AS r FROM product_suppliers t WHERE product_id = $1 ORDER BY id', [productId]),
      product: await rows('SELECT to_jsonb(t) AS r FROM products t WHERE id = $1', [productId]),
      skus: await rows('SELECT to_jsonb(t) AS r FROM product_skus t WHERE product_id = $1 ORDER BY id', [productId]),
    };
  }

  async function importOrder(reference, products) {
    const orderId = id();
    await q(`INSERT INTO orders(id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur)
             VALUES($1,$2,$3,$4,$5,'ordered','paid','stripe_eur',10000,20)`, [orderId, admin.id, relais, km, reference]);
    made.orders.push(orderId);
    const itemIds = [];
    for (const p of products) {
      const itemId = id();
      await q(`INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,sku_id,fulfillment_source)
               VALUES($1,$2,$3,2,10000,$4,'IMPORT')`, [itemId, orderId, p.id, p.skuId]);
      itemIds.push(itemId);
    }
    return { orderId, itemIds };
  }

  beforeAll(async () => {
    km = (await q("SELECT id FROM markets WHERE code='KM'")).rows[0].id;
    admin = await user('admin', 'admin');
    agent = await user('agent_hub', 'agent');
    relais = id();
    await q("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'A','+2693000077','R',$3)", [relais, `R-${tag}`, km]);
  });

  afterAll(async () => {
    await q('DELETE FROM purchase_lines WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = ANY($1::uuid[]))', [made.orders]).catch(() => {});
    await q('DELETE FROM order_items WHERE order_id = ANY($1::uuid[])', [made.orders]).catch(() => {});
    await q('DELETE FROM orders WHERE id = ANY($1::uuid[])', [made.orders]).catch(() => {});
    await q('DELETE FROM product_skus WHERE product_id = ANY($1::uuid[])', [made.products]).catch(() => {});
    await q('DELETE FROM product_suppliers WHERE product_id = ANY($1::uuid[])', [made.products]).catch(() => {});
    await q('DELETE FROM products WHERE id = ANY($1::uuid[])', [made.products]).catch(() => {});
    await q('DELETE FROM suppliers WHERE id = ANY($1::uuid[])', [made.suppliers]).catch(() => {});
    await q('DELETE FROM relais WHERE id = $1', [relais]).catch(() => {});
    await q('DELETE FROM users WHERE id = ANY($1::uuid[])', [made.users]).catch(() => {});
  });

  describe('protection 1 — garde de désactivation', () => {
    test('dernière source d\'un produit publié : 409 + produits listés, données STRICTEMENT inchangées', async () => {
      const p = await product('sole');
      const s1 = await supplier('Sole');
      const a1 = await assoc(p.id, s1, 1);
      expect(await published(p.id)).toBe(true);
      const before = await snapshot(p.id, [s1]);

      await expect(deleteSupplier(s1)).rejects.toMatchObject({
        status: 409, code: 'SUPPLIER_SOLE_SOURCE_OF_SELLABLE_PRODUCTS',
        details: { products: [expect.objectContaining({ id: p.id, name: p.name })] },
      });
      await expect(assertSourceRemovable(db, { supplierId: s1, productSupplierId: a1 }))
        .rejects.toMatchObject({ status: 409, details: { products: [expect.objectContaining({ id: p.id })] } });

      expect(await snapshot(p.id, [s1])).toEqual(before);
      expect(await published(p.id)).toBe(true);
    });

    test('avec une source de remplacement admissible : autorisé, produit toujours publié, historique conservé', async () => {
      const p = await product('relay');
      const s1 = await supplier('Relay-1');
      const s2 = await supplier('Relay-2');
      await assoc(p.id, s1, 1);
      const a2 = await assoc(p.id, s2, 2);

      await expect(deleteSupplier(s1)).resolves.toMatchObject({ deleted: true, id: s1 });
      const { rows: [row] } = await q('SELECT deleted_at FROM suppliers WHERE id = $1', [s1]);
      expect(row.deleted_at).not.toBeNull();
      expect((await q('SELECT count(*)::int AS n FROM product_suppliers WHERE product_id = $1', [p.id])).rows[0].n).toBe(2);
      expect(await published(p.id)).toBe(true);
      // la source de remplacement devient à son tour la dernière : refusée.
      await expect(assertSourceRemovable(db, { supplierId: s2, productSupplierId: a2 })).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('protection 2 — anomalie « Sourcing requis » sur donnée historique incohérente', () => {
    let order; let pNone; let pInactive; let pDeleted; let draftPo;

    beforeAll(async () => {
      // Données volontairement incohérentes, insérées en SQL (la garde de désactivation est contournée) :
      // produits PUBLIÉS dont aucune association n'est admissible.
      pNone = await product('none');                       // aucune association
      pInactive = await product('inactive-supplier');       // association vers un fournisseur inactif
      await assoc(pInactive.id, await supplier('Off', { active: false }), 1);
      pDeleted = await product('deleted-assoc');            // association supprimée (soft delete)
      await assoc(pDeleted.id, await supplier('Gone'), 1, { deletedAt: new Date() });
      order = await importOrder(`${tag}-ANO`, [pNone, pInactive, pDeleted]);
      // Un fournisseur sain pour tenter une préparation de PO.
      draftPo = await supplier('Healthy');
    });

    test('(a) dossier Hub : anomalie rouge, ORDER_SOURCING_REQUIRED, libellé « Sourcing requis — aucun fournisseur admissible »', async () => {
      const d = await dossierService.getDossier({ marketId: km, viewer: agent });
      const o = d.orders.find((x) => x.id === order.orderId);
      expect(o).toBeTruthy();
      o.items.forEach((item) => expect(item).toMatchObject({ sourcing_required: true, supplier_mapping_present: false, uncovered: 2 }));

      const todo = d.cockpit.todo.find((t) => t.kind === 'SOURCING_REQUIRED' && t.subject.order_id === order.orderId);
      expect(todo).toMatchObject({ severity: 'anomaly', owner: 'agent_hub' });
      expect(todo.missing).toBe(`Sourcing requis — aucun fournisseur admissible · ${tag}-ANO`);

      const handled = d.to_handle.filter((t) => t.kind === 'ORDER_SOURCING_REQUIRED' && t.order_id === order.orderId);
      expect(handled).toHaveLength(3);
      handled.forEach((h) => expect(h.reason).toContain('aucun fournisseur admissible'));
    });

    test('(b) tout achat est refusé côté serveur : déclencheur, ligne manuelle, préparation, rattachement — aucune ligne ni PO', async () => {
      const countPos = async () => (await q('SELECT count(*)::int AS n FROM purchase_orders')).rows[0].n;
      const countLines = async () => (await q('SELECT count(*)::int AS n FROM purchase_lines WHERE order_item_id = ANY($1::uuid[])', [order.itemIds])).rows[0].n;
      const posBefore = await countPos();

      // Déclencheur automatique : aucune ligne d'achat.
      const r = await triggerPurchasing(order.orderId);
      expect(r.purchase_orders).toHaveLength(3);
      // Refus par absence de fournisseur (no_supplier) ou par blocage d'identité canonique (error) : jamais line_opened.
      r.purchase_orders.forEach((x) => expect(['no_supplier', 'error']).toContain(x.status));

      // Ligne manuelle : association inexistante, vers fournisseur inactif, supprimée.
      const assocs = (await q('SELECT id FROM product_suppliers WHERE product_id = ANY($1::uuid[])', [[pInactive.id, pDeleted.id]])).rows.map((x) => x.id);
      for (const [itemId, psId] of [[order.itemIds[0], id()], [order.itemIds[1], assocs[0]], [order.itemIds[2], assocs[1]]]) {
        await expect(engagement.createManualLine({ order_item_id: itemId, product_supplier_id: psId, quantity: 1 }, { actor: admin }))
          .rejects.toMatchObject({ status: 404, code: 'PRODUCT_SUPPLIER_NOT_FOUND' });
      }

      // Préparation d'une PO et rattachement : aucune ligne source à rattacher.
      await expect(grouped.preparePurchaseOrder({ supplier_id: draftPo, procurement_hub_ref: 'DXB', line_ids: [id()] }, { actor: admin }))
        .rejects.toMatchObject({ status: 409 });
      await expect(grouped.attachDraftLines(id(), [id()])).rejects.toBeTruthy();

      expect(await countLines()).toBe(0);
      expect(await countPos()).toBe(posBefore);
    });
  });
}
