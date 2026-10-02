'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration purchase-lines-grouped-postgres.test.js
 * @brief PURCHASE-LINES PR 4 — preuve PostgreSQL réelle : migration 266 (draft, forme d'en-tête, I4), services de la forme regroupée et annulation de commande sur lignes.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

jest.setTimeout(30000);

jest.mock('../../db', () => ({ getClient: jest.fn(), query: jest.fn() }));
jest.mock('../../utils/logger', () => {
  const f = jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
  return { child: f, forModule: f, info: jest.fn(), warn: jest.fn(), error: jest.fn() };
});
const mockCreateAlert = jest.fn().mockResolvedValue({ id: 'alert-1' });
jest.mock('../../utils/alerts', () => ({ createAlert: (...args) => mockCreateAlert(...args) }));

const db = require('../../db');
const grouped = require('../../services/purchasing-grouped-service');
const { syncPurchaseOrdersOnOrderCancel } = require('../../services/purchasing-cancel-service');

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;
const id = () => crypto.randomUUID();
const MIGRATIONS = ['263_purchase_lines_foundation.sql', '264_purchase_line_progress_view.sql', '266_purchase_orders_grouped_form.sql'];
const IDENTITY = JSON.stringify({ provider: 'manual', version: 1, payload: { supplier_sku: 'U1' } });

describeDb('forme regroupée — migration 266 et services (REAL_DB)', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const schemas = [];
  let current;

  function migrationSql(name) {
    return fs.readFileSync(path.join(__dirname, '../../migrations', name), 'utf8').replace(/public\./g, `${current}.`);
  }

  async function newSchema({ migrate = true } = {}) {
    current = `plg266_${process.pid}_${Date.now()}_${schemas.length}`.replace(/[^a-zA-Z0-9_]/g, '_');
    schemas.push(current);
    await pool.query(`CREATE SCHEMA ${current}`);
    const c = await pool.connect();
    try {
      await c.query(`SET search_path TO ${current}`);
      await c.query(`
        CREATE TABLE users (id uuid PRIMARY KEY);
        CREATE TABLE suppliers (id uuid PRIMARY KEY, name text, platform text, deleted_at timestamptz);
        CREATE TABLE product_suppliers (id uuid PRIMARY KEY);
        CREATE TABLE product_skus (id uuid PRIMARY KEY);
        CREATE TABLE products (id uuid PRIMARY KEY, name text);
        CREATE TABLE orders (id uuid PRIMARY KEY, reference text);
        CREATE TABLE order_items (
          id uuid PRIMARY KEY,
          order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          product_id uuid,
          quantity integer NOT NULL DEFAULT 1
        );
        CREATE TABLE purchase_orders (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          order_item_id uuid REFERENCES order_items(id) ON DELETE SET NULL,
          supplier_id uuid NOT NULL REFERENCES suppliers(id),
          product_supplier_id uuid REFERENCES product_suppliers(id),
          product_sku_id uuid REFERENCES product_skus(id),
          supplier_sku text NOT NULL DEFAULT 'SKU',
          supplier_unit_ref text,
          supplier_order_identity jsonb,
          qty integer NOT NULL DEFAULT 1,
          supplier_unit_price numeric(18,4),
          supplier_currency text,
          status text NOT NULL DEFAULT 'pending',
          supplier_order_id text,
          trigger_mode text NOT NULL DEFAULT 'manual',
          notes text,
          confirmed_at timestamptz,
          received_qty integer NOT NULL DEFAULT 0,
          hub_received_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT chk_purchase_orders_qty CHECK (qty > 0),
          CONSTRAINT purchase_orders_status_check CHECK (status = ANY (ARRAY['pending'::text, 'notified'::text, 'confirmed'::text, 'shipped'::text, 'hub_received'::text, 'cancelled'::text]))
        );
      `);
      if (migrate) {
        for (const name of MIGRATIONS) await c.query(migrationSql(name));
      }
    } finally {
      c.release();
    }
    return current;
  }

  async function q(sql, params = []) {
    const c = await pool.connect();
    try {
      await c.query(`SET search_path TO ${current}`);
      return await c.query(sql, params);
    } finally {
      c.release();
    }
  }

  async function tx(fn) {
    const c = await pool.connect();
    try {
      await c.query(`SET search_path TO ${current}`);
      await c.query('BEGIN');
      const v = await fn(c);
      await c.query('COMMIT');
      return v;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  beforeAll(() => {
    db.getClient.mockImplementation(async () => {
      const c = await pool.connect();
      await c.query(`SET search_path TO ${current}`);
      return c;
    });
    db.query.mockImplementation(async (sql, params) => q(sql, params));
  });

  afterAll(async () => {
    for (const s of schemas) await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`).catch(() => {});
    await pool.end();
  });

  beforeEach(() => {
    process.env.KOMERCE_GROUPED_PURCHASING = '1';
    mockCreateAlert.mockClear();
  });
  afterEach(() => { delete process.env.KOMERCE_GROUPED_PURCHASING; });

  // ─── fixtures ─────────────────────────────────────────────────────────────────────────────────
  async function seedSupplier({ platform = 'manual', name = 'Fournisseur' } = {}) {
    const supplier = id();
    await q('INSERT INTO suppliers(id, name, platform) VALUES ($1,$2,$3)', [supplier, name, platform]);
    return supplier;
  }

  async function seedItem({ quantity = 1 } = {}) {
    const order = id(); const item = id(); const product = id();
    await q('INSERT INTO orders(id, reference) VALUES ($1,$2)', [order, `CMD-${order.slice(0, 6)}`]);
    await q('INSERT INTO products(id, name) VALUES ($1,$2)', [product, 'Produit']);
    await q('INSERT INTO order_items(id, order_id, product_id, quantity) VALUES ($1,$2,$3,$4)', [item, order, product, quantity]);
    return { order, item };
  }

  async function seedLine({ supplier, item, quantity = 1, exact = true, hub = 'DXB', currency = 'USD', sku = null } = {}) {
    const lineItem = item || (await seedItem({ quantity })).item;
    const productSku = exact ? (sku || id()) : null;
    if (productSku) await q('INSERT INTO product_skus(id) VALUES ($1) ON CONFLICT DO NOTHING', [productSku]);
    const { rows: [line] } = await q(`
      INSERT INTO purchase_lines(order_item_id, supplier_id, product_sku_id, supplier_sku, supplier_unit_ref,
                                 supplier_order_identity, quantity, supplier_unit_price, supplier_currency, procurement_hub_ref)
      VALUES ($1,$2,$3,'SKU',$4,$5::jsonb,$6,$7,$8,$9) RETURNING id
    `, [lineItem, supplier, productSku, exact ? 'U1' : null, exact ? IDENTITY : null, quantity,
      exact ? 10 : null, exact ? currency : null, hub]);
    return line.id;
  }

  const poCount = async () => (await q('SELECT count(*)::int AS n FROM purchase_orders')).rows[0].n;

  // ─── migration 266 ────────────────────────────────────────────────────────────────────────────
  describe('migration 266 — en-tête', () => {
    it('ajoute draft sans retirer les statuts existants et reste idempotente', async () => {
      await newSchema();
      await q(`INSERT INTO suppliers(id) VALUES ('00000000-0000-0000-0000-0000000000a1')`);
      const draft = (status) => q(
        `INSERT INTO purchase_orders(order_id, supplier_id, status, qty, supplier_sku)
         VALUES (NULL, '00000000-0000-0000-0000-0000000000a1', $1, NULL, NULL)`, [status]);
      await expect(draft('draft')).resolves.toBeTruthy();
      await expect(draft('shipped')).resolves.toBeTruthy();
      await expect(draft('bogus')).rejects.toThrow(/purchase_orders_status_check/);
      await q(migrationSql('266_purchase_orders_grouped_form.sql'));
      await expect(draft('draft')).resolves.toBeTruthy();
    });

    it('recopie DXB sur l\'existant et pose NOT NULL', async () => {
      await newSchema({ migrate: false });
      const supplier = await seedSupplier();
      const { order, item } = await seedItem();
      await q('INSERT INTO purchase_orders(order_id, order_item_id, supplier_id, qty) VALUES ($1,$2,$3,1)', [order, item, supplier]);
      const c = await pool.connect();
      try {
        await c.query(`SET search_path TO ${current}`);
        for (const name of MIGRATIONS) await c.query(migrationSql(name));
      } finally { c.release(); }
      const { rows } = await q('SELECT procurement_hub_ref FROM purchase_orders');
      expect(rows).toEqual([{ procurement_hub_ref: 'DXB' }]);
      await expect(q('UPDATE purchase_orders SET procurement_hub_ref = NULL')).rejects.toThrow(/null value/);
      await expect(q(`UPDATE purchase_orders SET procurement_hub_ref = ' '`)).rejects.toThrow(/chk_purchase_orders_hub_ref/);
    });

    it('chk_purchase_orders_header_shape : historique XOR regroupée', async () => {
      await newSchema();
      const supplier = await seedSupplier();
      const { order } = await seedItem();
      const insert = (orderId, qty, sku, extra = '') => q(
        `INSERT INTO purchase_orders(order_id, supplier_id, status, qty, supplier_sku${extra ? ', supplier_unit_ref' : ''})
         VALUES ($1,$2,'draft',$3,$4${extra ? ', $5' : ''})`,
        extra ? [orderId, supplier, qty, sku, extra] : [orderId, supplier, qty, sku]);
      await expect(insert(null, null, null)).resolves.toBeTruthy();           // regroupée
      await expect(insert(order, 2, 'SKU')).resolves.toBeTruthy();            // historique
      await expect(insert(null, 2, null)).rejects.toThrow(/chk_purchase_orders_header_shape/); // qty sur regroupée
      await expect(insert(null, null, 'SKU')).rejects.toThrow(/chk_purchase_orders_header_shape/);
      await expect(insert(null, null, null, 'U1')).rejects.toThrow(/chk_purchase_orders_header_shape/);
      await expect(insert(order, null, 'SKU')).rejects.toThrow(/chk_purchase_orders_header_shape/); // historique sans qty
      await expect(insert(order, 0, 'SKU')).rejects.toThrow(/chk_purchase_orders_qty/);
    });

    it('is_order_complete : une ligne ouverte non reçue rend la commande incomplète', async () => {
      await newSchema();
      const supplier = await seedSupplier();
      const { order, item } = await seedItem();
      await seedLine({ supplier, item });
      expect((await q('SELECT is_order_complete($1) AS c', [order])).rows[0].c).toBe(false);
    });
  });

  describe('garde I4 — homogénéité', () => {
    let supplier; let po;
    beforeEach(async () => {
      await newSchema();
      supplier = await seedSupplier();
      ({ rows: [{ id: po }] } = await q(
        `INSERT INTO purchase_orders(order_id, supplier_id, status, qty, supplier_sku, procurement_hub_ref)
         VALUES (NULL,$1,'draft',NULL,NULL,'DXB') RETURNING id`, [supplier]));
    });
    const attach = (line) => q('UPDATE purchase_lines SET purchase_order_id = $1 WHERE id = $2', [po, line]);

    it('rattache une ligne à identité exacte, même fournisseur, même hub', async () => {
      await expect(attach(await seedLine({ supplier }))).resolves.toBeTruthy();
    });

    it('refuse une ligne sans identité exacte (purchase_line_not_groupable)', async () => {
      await expect(attach(await seedLine({ supplier, exact: false }))).rejects.toThrow(/purchase_line_not_groupable/);
    });

    it('refuse un autre fournisseur, un autre hub ou une autre devise (purchase_line_not_homogeneous)', async () => {
      await expect(attach(await seedLine({ supplier: await seedSupplier() }))).rejects.toThrow(/purchase_line_not_homogeneous/);
      await expect(attach(await seedLine({ supplier, hub: 'CAN' }))).rejects.toThrow(/purchase_line_not_homogeneous/);
      await attach(await seedLine({ supplier, currency: 'USD' }));
      await expect(attach(await seedLine({ supplier, currency: 'EUR' }))).rejects.toThrow(/devise différente/);
    });

    it('sérialise deux rattachements concurrents de devises différentes : un seul gagne', async () => {
      const a = await seedLine({ supplier, currency: 'USD' });
      const b = await seedLine({ supplier, currency: 'EUR' });
      const results = await Promise.allSettled([
        tx((c) => c.query('UPDATE purchase_lines SET purchase_order_id = $1 WHERE id = $2', [po, a])),
        tx((c) => c.query('UPDATE purchase_lines SET purchase_order_id = $1 WHERE id = $2', [po, b])),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const { rows } = await q('SELECT DISTINCT supplier_currency FROM purchase_lines WHERE purchase_order_id = $1', [po]);
      expect(rows).toHaveLength(1);
    });

    it('n\'intervient pas sur une PO historique (écriture double 1:1)', async () => {
      const { order, item } = await seedItem();
      const { rows: [{ id: historical }] } = await q(
        `INSERT INTO purchase_orders(order_id, order_item_id, supplier_id, qty, status) VALUES ($1,$2,$3,1,'pending') RETURNING id`,
        [order, item, supplier]);
      await expect(q(`
        INSERT INTO purchase_lines(purchase_order_id, order_item_id, supplier_id, supplier_sku, quantity, procurement_hub_ref)
        VALUES ($1,$2,$3,'SKU',1,'DXB')`, [historical, item, supplier])).resolves.toBeTruthy();
    });
  });

  // ─── services ─────────────────────────────────────────────────────────────────────────────────
  describe('purchasing-grouped-service', () => {
    beforeEach(() => newSchema());

    it('refuse tout quand le drapeau est éteint', async () => {
      delete process.env.KOMERCE_GROUPED_PURCHASING;
      expect(grouped.isGroupedPurchasingEnabled()).toBe(false);
      await expect(grouped.listOpenLines()).rejects.toMatchObject({ status: 409, code: 'GROUPED_PURCHASING_DISABLED' });
      await expect(grouped.preparePurchaseOrder({})).rejects.toMatchObject({ code: 'GROUPED_PURCHASING_DISABLED' });
      await expect(grouped.detachLines(id(), [id()])).rejects.toMatchObject({ code: 'GROUPED_PURCHASING_DISABLED' });
      await expect(grouped.discardPurchaseOrder(id())).rejects.toMatchObject({ code: 'GROUPED_PURCHASING_DISABLED' });
      await expect(grouped.cancelLine(id(), 'x')).rejects.toMatchObject({ code: 'GROUPED_PURCHASING_DISABLED' });
    });

    it('open-lines regroupe par (fournisseur, hub) avec agrégat par supplier_unit_ref', async () => {
      const s1 = await seedSupplier({ name: 'Alpha' });
      const s2 = await seedSupplier({ name: 'Beta' });
      await seedLine({ supplier: s1, quantity: 2 });
      await seedLine({ supplier: s1, quantity: 3 });
      await seedLine({ supplier: s1, hub: 'CAN' });
      await seedLine({ supplier: s2, exact: false });
      const cancelled = await seedLine({ supplier: s2 });
      await q(`UPDATE purchase_lines SET cancelled_at = now(), cancel_reason = 'x' WHERE id = $1`, [cancelled]);

      const result = await grouped.listOpenLines();
      expect(result.total_lines).toBe(4);
      expect(result.groups.map((g) => `${g.supplier_name}|${g.procurement_hub_ref}`)).toEqual(['Alpha|CAN', 'Alpha|DXB', 'Beta|DXB']);
      const alphaDxb = result.groups.find((g) => g.supplier_name === 'Alpha' && g.procurement_hub_ref === 'DXB');
      expect(alphaDxb.by_supplier_unit_ref).toEqual([{ supplier_unit_ref: 'U1', quantity: 5, lines: 2 }]);
      expect(alphaDxb.currencies).toEqual(['USD']);
      expect(alphaDxb.lines[0]).toMatchObject({ groupable: true, expected_unit_price: 10, product_name: 'Produit' });
      const beta = result.groups.find((g) => g.supplier_name === 'Beta');
      expect(beta.lines[0].groupable).toBe(false);
    });

    it('prepare crée une PO draft regroupée et rattache les lignes', async () => {
      const supplier = await seedSupplier({ platform: 'whatsapp' });
      const l1 = await seedLine({ supplier });
      const l2 = await seedLine({ supplier });

      const result = await grouped.preparePurchaseOrder(
        { supplier_id: supplier, procurement_hub_ref: ' DXB ', line_ids: [l2, l1] }, { actor: { id: 'admin-1' } });
      expect(result.purchase_order).toMatchObject({
        status: 'draft', order_id: null, qty: null, supplier_sku: null, trigger_mode: 'whatsapp', procurement_hub_ref: 'DXB',
      });
      expect(result.purchase_order.notes).toContain('admin-1');
      const { rows } = await q('SELECT purchase_order_id FROM purchase_lines WHERE id = ANY($1::uuid[])', [[l1, l2]]);
      expect(rows.every((r) => r.purchase_order_id === result.purchase_order.id)).toBe(true);
      expect((await grouped.listOpenLines()).total_lines).toBe(0);
    });

    it('prepare : une ligne déjà prise annule tout (409, aucune PO créée)', async () => {
      const supplier = await seedSupplier();
      const l1 = await seedLine({ supplier });
      const l2 = await seedLine({ supplier });
      await grouped.preparePurchaseOrder({ supplier_id: supplier, procurement_hub_ref: 'DXB', line_ids: [l1] });
      const before = await poCount();
      await expect(grouped.preparePurchaseOrder({ supplier_id: supplier, procurement_hub_ref: 'DXB', line_ids: [l1, l2] }))
        .rejects.toMatchObject({ status: 409, code: 'PURCHASE_LINES_ALREADY_ATTACHED' });
      expect(await poCount()).toBe(before);
      expect((await q('SELECT purchase_order_id FROM purchase_lines WHERE id = $1', [l2])).rows[0].purchase_order_id).toBeNull();
    });

    it('prepare : deux préparations concurrentes de la même ligne, une seule gagne', async () => {
      const supplier = await seedSupplier();
      const line = await seedLine({ supplier });
      const attempt = () => grouped.preparePurchaseOrder({ supplier_id: supplier, procurement_hub_ref: 'DXB', line_ids: [line] });
      const results = await Promise.allSettled([attempt(), attempt()]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await poCount()).toBe(1);
    });

    it('prepare : refus lisibles (non regroupable, hétérogène, entrées invalides, fournisseur inconnu)', async () => {
      const supplier = await seedSupplier();
      const inexact = await seedLine({ supplier, exact: false });
      const other = await seedLine({ supplier: await seedSupplier() });
      const base = { supplier_id: supplier, procurement_hub_ref: 'DXB' };
      await expect(grouped.preparePurchaseOrder({ ...base, line_ids: [inexact] })).rejects.toMatchObject({ status: 409, code: 'PURCHASE_LINE_NOT_GROUPABLE' });
      await expect(grouped.preparePurchaseOrder({ ...base, line_ids: [other] })).rejects.toMatchObject({ status: 409, code: 'PURCHASE_LINE_NOT_HOMOGENEOUS' });
      await expect(grouped.preparePurchaseOrder({ ...base, line_ids: [] })).rejects.toMatchObject({ status: 400 });
      await expect(grouped.preparePurchaseOrder({ ...base, line_ids: [other, other] })).rejects.toMatchObject({ status: 400 });
      await expect(grouped.preparePurchaseOrder({ ...base, line_ids: ['nope'] })).rejects.toMatchObject({ status: 400 });
      await expect(grouped.preparePurchaseOrder({ ...base, procurement_hub_ref: '  ', line_ids: [other] })).rejects.toMatchObject({ status: 400 });
      await expect(grouped.preparePurchaseOrder({ supplier_id: 'x', line_ids: [other] })).rejects.toMatchObject({ status: 400 });
      await expect(grouped.preparePurchaseOrder({ ...base, supplier_id: id(), line_ids: [other] })).rejects.toMatchObject({ status: 404, code: 'SUPPLIER_NOT_FOUND' });
      expect(await poCount()).toBe(0);
    });

    it('detach rend les lignes ouvertes ; refus hors draft, hors PO, historique', async () => {
      const supplier = await seedSupplier();
      const l1 = await seedLine({ supplier });
      const l2 = await seedLine({ supplier });
      const { purchase_order: po } = await grouped.preparePurchaseOrder({ supplier_id: supplier, procurement_hub_ref: 'DXB', line_ids: [l1, l2] });

      const outsider = await seedLine({ supplier });
      await expect(grouped.detachLines(po.id, [outsider])).rejects.toMatchObject({ status: 409, code: 'PURCHASE_LINE_NOT_IN_PURCHASE_ORDER' });
      const result = await grouped.detachLines(po.id, [l1]);
      expect(result).toMatchObject({ detached: [l1], remaining_lines: 1 });
      expect((await q('SELECT purchase_order_id FROM purchase_lines WHERE id = $1', [l1])).rows[0].purchase_order_id).toBeNull();

      await expect(grouped.detachLines(id(), [l1])).rejects.toMatchObject({ status: 404, code: 'PURCHASE_ORDER_NOT_FOUND' });
      await q(`UPDATE purchase_orders SET status = 'notified' WHERE id = $1`, [po.id]);
      await expect(grouped.detachLines(po.id, [l2])).rejects.toMatchObject({ status: 409, code: 'PURCHASE_ORDER_NOT_DRAFT', current_status: 'notified' });

      const { order, item } = await seedItem();
      const { rows: [{ id: historical }] } = await q(
        `INSERT INTO purchase_orders(order_id, order_item_id, supplier_id, qty) VALUES ($1,$2,$3,1) RETURNING id`, [order, item, supplier]);
      await expect(grouped.detachLines(historical, [l2])).rejects.toMatchObject({ status: 409, code: 'PURCHASE_ORDER_NOT_GROUPED' });
    });

    it('discard détache toutes les lignes et annule la PO draft (lignes conservées, ouvertes)', async () => {
      const supplier = await seedSupplier();
      const l1 = await seedLine({ supplier });
      const l2 = await seedLine({ supplier });
      const { purchase_order: po } = await grouped.preparePurchaseOrder({ supplier_id: supplier, procurement_hub_ref: 'DXB', line_ids: [l1, l2] });

      const result = await grouped.discardPurchaseOrder(po.id);
      expect(result.status).toBe('cancelled');
      expect(result.detached.sort()).toEqual([l1, l2].sort());
      const { rows: lines } = await q('SELECT purchase_order_id, cancelled_at FROM purchase_lines WHERE id = ANY($1::uuid[])', [[l1, l2]]);
      expect(lines.every((l) => l.purchase_order_id === null && l.cancelled_at === null)).toBe(true);
      expect((await q('SELECT status, notes FROM purchase_orders WHERE id = $1', [po.id])).rows[0]).toMatchObject({ status: 'cancelled' });
      await expect(grouped.discardPurchaseOrder(po.id)).rejects.toMatchObject({ code: 'PURCHASE_ORDER_NOT_DRAFT' });
    });

    it('lines/:id/cancel : ligne ouverte, ligne en brouillon (détachée), refus engagée / déjà annulée / sans motif', async () => {
      const supplier = await seedSupplier();
      const open = await seedLine({ supplier });
      expect(await grouped.cancelLine(open, ' client a changé ')).toMatchObject({ cancelled: true, detached_from: null });
      expect((await q('SELECT cancelled_at, cancel_reason FROM purchase_lines WHERE id = $1', [open])).rows[0].cancel_reason).toBe('client a changé');
      await expect(grouped.cancelLine(open, 'encore')).rejects.toMatchObject({ code: 'PURCHASE_LINE_ALREADY_CANCELLED' });

      const inDraft = await seedLine({ supplier });
      const kept = await seedLine({ supplier });
      const { purchase_order: po } = await grouped.preparePurchaseOrder({ supplier_id: supplier, procurement_hub_ref: 'DXB', line_ids: [inDraft, kept] });
      expect(await grouped.cancelLine(inDraft, 'doublon')).toMatchObject({ detached_from: po.id });
      const row = (await q('SELECT purchase_order_id, cancelled_at FROM purchase_lines WHERE id = $1', [inDraft])).rows[0];
      expect(row.purchase_order_id).toBeNull();
      expect(row.cancelled_at).not.toBeNull();

      await q(`UPDATE purchase_orders SET status = 'notified' WHERE id = $1`, [po.id]);
      await expect(grouped.cancelLine(kept, 'trop tard')).rejects.toMatchObject({ status: 409, code: 'PURCHASE_LINE_NOT_CANCELLABLE' });
      await expect(grouped.cancelLine(kept, '')).rejects.toMatchObject({ status: 400 });
      await expect(grouped.cancelLine(id(), 'x')).rejects.toMatchObject({ status: 404, code: 'PURCHASE_LINE_NOT_FOUND' });
      await expect(grouped.cancelLine('nope', 'x')).rejects.toMatchObject({ status: 400 });
    });
  });

  // ─── annulation d'une commande client ────────────────────────────────────────────────────────
  describe('purchasing-cancel-service — lignes de la forme regroupée', () => {
    beforeEach(() => newSchema());
    const cancelOrder = (order) => tx((c) => syncPurchaseOrdersOnOrderCancel(c, { orderId: order, orderReference: 'CMD', reason: 'client_cancel' }));

    it('annule la ligne ouverte, détache puis annule la ligne draft et vide la PO brouillon', async () => {
      const supplier = await seedSupplier();
      const { order, item } = await seedItem({ quantity: 2 });
      const mine = await seedLine({ supplier, item, quantity: 1 });
      const mine2 = await seedLine({ supplier, item, quantity: 1 });
      const { purchase_order: po } = await grouped.preparePurchaseOrder({ supplier_id: supplier, procurement_hub_ref: 'DXB', line_ids: [mine] });

      const result = await cancelOrder(order);
      expect(result).toMatchObject({ lines_cancelled: 2, blocking: 0, auto_cancelled: 1 });
      const { rows } = await q(`SELECT id, purchase_order_id, cancel_reason FROM purchase_lines WHERE id = ANY($1::uuid[])`, [[mine, mine2]]);
      expect(rows.every((r) => r.purchase_order_id === null && r.cancel_reason === 'order_cancelled')).toBe(true);
      expect((await q('SELECT status FROM purchase_orders WHERE id = $1', [po.id])).rows[0].status).toBe('cancelled');
      expect(mockCreateAlert).not.toHaveBeenCalled();
    });

    it('une PO brouillon qui garde d\'autres lignes reste draft', async () => {
      const supplier = await seedSupplier();
      const { order, item } = await seedItem();
      const mine = await seedLine({ supplier, item });
      const other = await seedLine({ supplier });
      const { purchase_order: po } = await grouped.preparePurchaseOrder({ supplier_id: supplier, procurement_hub_ref: 'DXB', line_ids: [mine, other] });

      await cancelOrder(order);
      expect((await q('SELECT status FROM purchase_orders WHERE id = $1', [po.id])).rows[0].status).toBe('draft');
      expect((await q('SELECT purchase_order_id, cancelled_at FROM purchase_lines WHERE id = $1', [other])).rows[0]).toMatchObject({ purchase_order_id: po.id, cancelled_at: null });
    });

    it('PO regroupée déjà soumise : rien d\'annulé, alerte avec purchase_line_ids', async () => {
      const supplier = await seedSupplier();
      const { order, item } = await seedItem();
      const mine = await seedLine({ supplier, item });
      const { purchase_order: po } = await grouped.preparePurchaseOrder({ supplier_id: supplier, procurement_hub_ref: 'DXB', line_ids: [mine] });
      await q(`UPDATE purchase_orders SET status = 'notified' WHERE id = $1`, [po.id]);

      const result = await cancelOrder(order);
      expect(result).toMatchObject({ lines_cancelled: 0, blocking: 1 });
      expect(result.blocking_pos[0]).toMatchObject({ id: po.id, status: 'notified', purchase_line_ids: [mine] });
      expect((await q('SELECT cancelled_at FROM purchase_lines WHERE id = $1', [mine])).rows[0].cancelled_at).toBeNull();
      expect((await q('SELECT status FROM purchase_orders WHERE id = $1', [po.id])).rows[0].status).toBe('notified');
      expect(mockCreateAlert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        type: 'order_cancel_purchasing_blocked',
        description: expect.stringContaining(mine),
      }));
    });

    it('commande sans ligne regroupée : résultat vide, PO historique inchangée dans son comportement', async () => {
      const supplier = await seedSupplier();
      const { order, item } = await seedItem();
      const { rows: [{ id: historical }] } = await q(
        `INSERT INTO purchase_orders(order_id, order_item_id, supplier_id, qty, status) VALUES ($1,$2,$3,1,'pending') RETURNING id`,
        [order, item, supplier]);
      await q(`INSERT INTO purchase_lines(purchase_order_id, order_item_id, supplier_id, supplier_sku, quantity, procurement_hub_ref)
               VALUES ($1,$2,$3,'SKU',1,'DXB')`, [historical, item, supplier]);

      const result = await cancelOrder(order);
      expect(result).toMatchObject({ total: 1, auto_cancelled: 1, blocking: 0, lines_cancelled: 0 });
      expect((await q('SELECT status FROM purchase_orders WHERE id = $1', [historical])).rows[0].status).toBe('cancelled');
      expect((await q('SELECT cancel_reason FROM purchase_lines WHERE purchase_order_id = $1', [historical])).rows[0].cancel_reason).not.toBeNull();
    });
  });
});
