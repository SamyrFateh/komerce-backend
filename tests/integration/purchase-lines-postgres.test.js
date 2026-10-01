'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration purchase-lines-postgres.test.js
 * @brief PURCHASE-LINES PR 1 — preuve PostgreSQL réelle : recopie 1:1 fail-closed, anti-sur-engagement concurrent (I1), rattachement (I3), gel (I5), pas de suppression directe (I6).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

jest.setTimeout(30000);

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;

const MIGRATION_PATH = path.join(__dirname, '../../migrations/263_purchase_lines_foundation.sql');
const id = () => crypto.randomUUID();

describeDb('purchase_lines — migration 263 (REAL_DB)', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const schemas = [];

  async function newSchema() {
    const schema = `pl263_${process.pid}_${Date.now()}_${schemas.length}`.replace(/[^a-zA-Z0-9_]/g, '_');
    schemas.push(schema);
    await pool.query(`CREATE SCHEMA ${schema}`);
    const c = await pool.connect();
    try {
      await c.query(`SET search_path TO ${schema}`);
      await c.query(`
        CREATE TABLE users (id uuid PRIMARY KEY);
        CREATE TABLE suppliers (id uuid PRIMARY KEY);
        CREATE TABLE product_suppliers (id uuid PRIMARY KEY);
        CREATE TABLE product_skus (id uuid PRIMARY KEY);
        CREATE TABLE orders (id uuid PRIMARY KEY);
        CREATE TABLE order_items (
          id uuid PRIMARY KEY,
          order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          quantity integer NOT NULL DEFAULT 1
        );
        CREATE TABLE purchase_orders (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
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
          confirmed_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
      `);
    } finally {
      c.release();
    }
    return schema;
  }

  async function q(schema, sql, params = []) {
    const c = await pool.connect();
    try {
      await c.query(`SET search_path TO ${schema}`);
      return await c.query(sql, params);
    } finally {
      c.release();
    }
  }

  async function tx(schema, fn) {
    const c = await pool.connect();
    try {
      await c.query(`SET search_path TO ${schema}`);
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

  async function applyMigration(schema) {
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf8').replace(/public\./g, `${schema}.`);
    const c = await pool.connect();
    try {
      await c.query(`SET search_path TO ${schema}`);
      await c.query(sql);
    } finally {
      c.release();
    }
  }

  async function seedItem(schema, { quantity = 3 } = {}) {
    const order = id(); const item = id(); const supplier = id();
    await q(schema, 'INSERT INTO orders(id) VALUES ($1)', [order]);
    await q(schema, 'INSERT INTO order_items(id, order_id, quantity) VALUES ($1,$2,$3)', [item, order, quantity]);
    await q(schema, 'INSERT INTO suppliers(id) VALUES ($1)', [supplier]);
    return { order, item, supplier };
  }

  async function seedPo(schema, { order, item, supplier, qty = 1, status = 'pending', withItem = true, price = null } = {}) {
    const po = id();
    await q(schema, `INSERT INTO purchase_orders(id, order_id, order_item_id, supplier_id, qty, status, supplier_unit_price, supplier_currency)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [po, order, withItem ? item : null, supplier, qty, status, price, price ? 'AED' : null]);
    return po;
  }

  const lineSql = `INSERT INTO purchase_lines(order_item_id, supplier_id, supplier_sku, quantity, procurement_hub_ref)
                   VALUES ($1,$2,'SKU',$3,'DXB') RETURNING id`;

  afterAll(async () => {
    for (const s of schemas) await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`).catch(() => {});
    await pool.end();
  });

  describe('recopie 1:1 des PO historiques', () => {
    it('crée une ligne par PO avec confirmation, annulation et hub DXB', async () => {
      const s = await newSchema();
      const base = await seedItem(s, { quantity: 1 });
      const confirmed = await seedPo(s, { ...base, qty: 1, status: 'confirmed', price: 12.5 });
      await q(s, 'UPDATE purchase_orders SET confirmed_at = now() WHERE id = $1', [confirmed]);
      const b2 = await seedItem(s, { quantity: 2 });
      const cancelled = await seedPo(s, { ...b2, qty: 2, status: 'cancelled' });
      const b3 = await seedItem(s, { quantity: 4 });
      const pending = await seedPo(s, { ...b3, qty: 4, status: 'pending' });
      const legacyTerminal = await seedPo(s, { ...(await seedItem(s)), qty: 1, status: 'hub_received', withItem: false });

      await applyMigration(s);

      const { rows } = await q(s, 'SELECT * FROM purchase_lines ORDER BY created_at');
      expect(rows).toHaveLength(3);
      const byPo = Object.fromEntries(rows.map(r => [r.purchase_order_id, r]));
      expect(byPo[confirmed]).toMatchObject({ quantity: 1, confirmed_quantity: 1, procurement_hub_ref: 'DXB', cancelled_at: null });
      expect(Number(byPo[confirmed].confirmed_unit_price)).toBe(12.5);
      expect(byPo[confirmed].confirmed_at).not.toBeNull();
      expect(byPo[cancelled].cancel_reason).toBe('legacy_backfill_cancelled');
      expect(byPo[cancelled].cancelled_at).not.toBeNull();
      expect(byPo[pending]).toMatchObject({ quantity: 4, confirmed_quantity: null, cancelled_at: null });
      expect(byPo[legacyTerminal]).toBeUndefined();
    });

    it('est idempotente : rejouer la migration ne duplique rien', async () => {
      const s = await newSchema();
      const base = await seedItem(s, { quantity: 1 });
      await seedPo(s, { ...base, qty: 1 });
      await applyMigration(s);
      await applyMigration(s);
      const { rows } = await q(s, 'SELECT count(*)::int AS n FROM purchase_lines');
      expect(rows[0].n).toBe(1);
    });

    it('échoue et liste les identifiants si des PO sur-engagent un order_item', async () => {
      const s = await newSchema();
      const base = await seedItem(s, { quantity: 1 });
      await seedPo(s, { ...base, qty: 1, status: 'pending' });
      await seedPo(s, { ...base, qty: 1, status: 'notified' });
      await expect(applyMigration(s)).rejects.toThrow(/purchase_lines_backfill_overcommitted.*besoin 1, engagé 2/);
      expect(base.item).toBeTruthy();
    });

    it('échoue si une PO active n\'a pas d\'order_item_id', async () => {
      const s = await newSchema();
      const base = await seedItem(s);
      const po = await seedPo(s, { ...base, status: 'confirmed', withItem: false });
      await expect(applyMigration(s)).rejects.toThrow(new RegExp(`purchase_lines_backfill_active_po_without_order_item.*${po}`));
    });
  });

  describe('gardes transactionnelles', () => {
    let s; let base;
    beforeEach(async () => {
      s = await newSchema();
      await applyMigration(s);
      base = await seedItem(s, { quantity: 3 });
    });

    it('I1 : refuse un sur-engagement séquentiel', async () => {
      await q(s, lineSql, [base.item, base.supplier, 2]);
      await expect(q(s, lineSql, [base.item, base.supplier, 2])).rejects.toThrow(/purchase_line_overcommitted/);
      await expect(q(s, lineSql, [base.item, base.supplier, 1])).resolves.toBeTruthy();
    });

    it('I1 : deux insertions concurrentes ne couvrent jamais deux fois le même besoin', async () => {
      const attempt = () => tx(s, c => c.query(lineSql, [base.item, base.supplier, 2]));
      const results = await Promise.allSettled([attempt(), attempt()]);
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find(r => r.status === 'rejected');
      expect(String(failed.reason.message)).toMatch(/purchase_line_overcommitted/);
      const { rows } = await q(s, 'SELECT sum(quantity)::int AS total FROM purchase_lines WHERE order_item_id = $1', [base.item]);
      expect(rows[0].total).toBe(2);
    });

    it('I1 : une ligne annulée libère le besoin ; confirmed_quantity réduit l\'effectif', async () => {
      const { rows: [l1] } = await q(s, lineSql, [base.item, base.supplier, 3]);
      await expect(q(s, lineSql, [base.item, base.supplier, 1])).rejects.toThrow(/overcommitted/);
      await q(s, `UPDATE purchase_lines SET cancelled_at = now(), cancel_reason = 'test' WHERE id = $1`, [l1.id]);
      await expect(q(s, lineSql, [base.item, base.supplier, 3])).resolves.toBeTruthy();
    });

    it('I3 : insertion rattachée à une PO historique du même item, une seule fois', async () => {
      const po = await seedPo(s, { ...base, qty: 1, status: 'pending' });
      const ins = `INSERT INTO purchase_lines(purchase_order_id, order_item_id, supplier_id, supplier_sku, quantity, procurement_hub_ref)
                   VALUES ($1,$2,$3,'SKU',1,'DXB')`;
      await expect(q(s, ins, [po, base.item, base.supplier])).resolves.toBeTruthy();
      await expect(q(s, ins, [po, base.item, base.supplier])).rejects.toThrow(/purchase_line_historical_po_already_has_line/);
    });

    it('I3 : refuse l\'insertion rattachée à une PO d\'un autre item ou de forme regroupée', async () => {
      const other = await seedItem(s, { quantity: 1 });
      const poOther = await seedPo(s, { ...other, qty: 1 });
      const ins = `INSERT INTO purchase_lines(purchase_order_id, order_item_id, supplier_id, supplier_sku, quantity, procurement_hub_ref)
                   VALUES ($1,$2,$3,'SKU',1,'DXB')`;
      await expect(q(s, ins, [poOther, base.item, base.supplier])).rejects.toThrow(/purchase_line_attach_forbidden/);
      const grouped = id();
      await q(s, `INSERT INTO purchase_orders(id, order_id, supplier_id, status) VALUES ($1, NULL, $2, 'draft')`, [grouped, base.supplier]);
      await expect(q(s, ins, [grouped, base.item, base.supplier])).rejects.toThrow(/purchase_line_attach_forbidden/);
    });

    it('I3 : rattache et détache seulement en brouillon', async () => {
      const draft = id(); const sent = id();
      await q(s, `INSERT INTO purchase_orders(id, order_id, supplier_id, status) VALUES ($1, NULL, $2, 'draft'),($3, NULL, $2, 'notified')`, [draft, base.supplier, sent]);
      const { rows: [l] } = await q(s, lineSql, [base.item, base.supplier, 1]);
      await expect(q(s, 'UPDATE purchase_lines SET purchase_order_id = $1 WHERE id = $2', [sent, l.id])).rejects.toThrow(/attach_forbidden/);
      await expect(q(s, 'UPDATE purchase_lines SET purchase_order_id = $1 WHERE id = $2', [draft, l.id])).resolves.toBeTruthy();
      await expect(q(s, 'UPDATE purchase_lines SET purchase_order_id = NULL WHERE id = $1', [l.id])).resolves.toBeTruthy();
      // soumise : ni détachement ni changement de PO
      await q(s, 'UPDATE purchase_lines SET purchase_order_id = $1 WHERE id = $2', [draft, l.id]);
      await q(s, `UPDATE purchase_orders SET status = 'notified' WHERE id = $1`, [draft]);
      await expect(q(s, 'UPDATE purchase_lines SET purchase_order_id = NULL WHERE id = $1', [l.id])).rejects.toThrow(/detach_forbidden/);
    });

    it('I5 : une ligne ouverte n\'est ni modifiable ni confirmable ; la quantité ne change jamais', async () => {
      const { rows: [l] } = await q(s, lineSql, [base.item, base.supplier, 2]);
      await expect(q(s, 'UPDATE purchase_lines SET quantity = 1 WHERE id = $1', [l.id])).rejects.toThrow(/purchase_line_frozen/);
      await expect(q(s, `UPDATE purchase_lines SET confirmed_quantity = 2, confirmed_at = now() WHERE id = $1`, [l.id])).rejects.toThrow(/avant soumission/);
    });

    it('I5 : après soumission, confirmation et clôture s\'écrivent une seule fois', async () => {
      const po = await seedPo(s, { ...base, qty: 3, status: 'notified' });
      const { rows: [l] } = await q(s, `INSERT INTO purchase_lines(purchase_order_id, order_item_id, supplier_id, supplier_sku, quantity, procurement_hub_ref)
                                         VALUES ($1,$2,$3,'SKU',3,'DXB') RETURNING id`, [po, base.item, base.supplier]);
      await q(s, `UPDATE purchase_lines SET confirmed_quantity = 2, confirmed_unit_price = 5, confirmed_at = now() WHERE id = $1`, [l.id]);
      await expect(q(s, 'UPDATE purchase_lines SET confirmed_quantity = 1 WHERE id = $1', [l.id])).rejects.toThrow(/confirmation déjà enregistrée/);
      await expect(q(s, 'UPDATE purchase_lines SET quantity = 5 WHERE id = $1', [l.id])).rejects.toThrow(/purchase_line_frozen/);
      await q(s, `UPDATE purchase_lines SET settled_quantity = 1, settled_at = now(), settle_reason = 'casse' WHERE id = $1`, [l.id]);
      await expect(q(s, 'UPDATE purchase_lines SET settled_quantity = 2 WHERE id = $1', [l.id])).rejects.toThrow(/clôture déjà enregistrée/);
    });

    it('I5 : la confirmation doit rester ≤ quantité, et le reliquat respecte I1 (écriture avant insertion)', async () => {
      const po = await seedPo(s, { ...base, qty: 3, status: 'notified' });
      const { rows: [l] } = await q(s, `INSERT INTO purchase_lines(purchase_order_id, order_item_id, supplier_id, supplier_sku, quantity, procurement_hub_ref)
                                         VALUES ($1,$2,$3,'SKU',3,'DXB') RETURNING id`, [po, base.item, base.supplier]);
      await expect(q(s, `UPDATE purchase_lines SET confirmed_quantity = 4, confirmed_at = now() WHERE id = $1`, [l.id])).rejects.toThrow(/chk_purchase_lines_confirmed_bound|purchase_line_overcommitted/);
      // reliquat inséré AVANT la confirmation : sur-engagement refusé
      await expect(q(s, lineSql, [base.item, base.supplier, 1])).rejects.toThrow(/overcommitted/);
      await q(s, `UPDATE purchase_lines SET confirmed_quantity = 2, confirmed_at = now() WHERE id = $1`, [l.id]);
      await expect(q(s, `INSERT INTO purchase_lines(order_item_id, supplier_id, supplier_sku, quantity, procurement_hub_ref, parent_line_id)
                         VALUES ($1,$2,'SKU',1,'DXB',$3)`, [base.item, base.supplier, l.id])).resolves.toBeTruthy();
    });

    it('I6 : suppression directe interdite, annulation possible une seule fois', async () => {
      const { rows: [l] } = await q(s, lineSql, [base.item, base.supplier, 1]);
      await expect(q(s, 'DELETE FROM purchase_lines WHERE id = $1', [l.id])).rejects.toThrow(/purchase_line_delete_forbidden/);
      await q(s, `UPDATE purchase_lines SET cancelled_at = now(), cancel_reason = 'x' WHERE id = $1`, [l.id]);
      await expect(q(s, `UPDATE purchase_lines SET cancel_reason = 'y' WHERE id = $1`, [l.id])).rejects.toThrow(/annulation déjà enregistrée/);
    });

    it('I6 : la purge d\'une commande (cascade) reste possible', async () => {
      await q(s, lineSql, [base.item, base.supplier, 1]);
      await q(s, 'DELETE FROM orders WHERE id = $1', [base.order]);
      const { rows } = await q(s, 'SELECT count(*)::int AS n FROM purchase_lines');
      expect(rows[0].n).toBe(0);
    });

    it('annuler une PO (SQL direct) annule sa ligne et libère le besoin', async () => {
      const po = await seedPo(s, { ...base, qty: 3 });
      const { rows: [l] } = await q(s, `INSERT INTO purchase_lines(purchase_order_id, order_item_id, supplier_id, supplier_sku, quantity, procurement_hub_ref)
                                        VALUES ($1,$2,$3,'SKU',3,'DXB') RETURNING id`, [po, base.item, base.supplier]);
      await q(s, `UPDATE purchase_orders SET status = 'cancelled' WHERE id = $1`, [po]);
      const { rows: [after] } = await q(s, 'SELECT cancelled_at, cancel_reason FROM purchase_lines WHERE id = $1', [l.id]);
      expect(after.cancelled_at).not.toBeNull();
      expect(after.cancel_reason).toBe('purchase_order_cancelled');
      await expect(q(s, lineSql, [base.item, base.supplier, 3])).resolves.toBeTruthy();
    });

    it('contraintes de forme : identité exacte exige SKU et référence ; paire prix/devise', async () => {
      const bad = `INSERT INTO purchase_lines(order_item_id, supplier_id, supplier_sku, quantity, procurement_hub_ref, supplier_order_identity)
                   VALUES ($1,$2,'SKU',1,'DXB','{"provider":"x","version":1,"payload":{"a":1}}')`;
      await expect(q(s, bad, [base.item, base.supplier])).rejects.toThrow(/chk_purchase_lines_supplier_order_identity_shape/);
      await expect(q(s, `INSERT INTO purchase_lines(order_item_id, supplier_id, supplier_sku, quantity, procurement_hub_ref, supplier_unit_price)
                         VALUES ($1,$2,'SKU',1,'DXB',3)`, [base.item, base.supplier])).rejects.toThrow(/chk_purchase_lines_supplier_money_pair/);
      await expect(q(s, `INSERT INTO purchase_lines(order_item_id, supplier_id, supplier_sku, quantity, procurement_hub_ref)
                         VALUES ($1,$2,'SKU',0,'DXB')`, [base.item, base.supplier])).rejects.toThrow(/chk_purchase_lines_quantity/);
    });
  });
});
