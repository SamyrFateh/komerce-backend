'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration purchase-line-progress-postgres.test.js
 * @brief PURCHASE-LINES PR 2 — preuve PostgreSQL réelle : v_purchase_line_progress et is_order_complete donnent exactement les anciens résultats (calculés depuis purchase_orders) pour les PO historiques avec ligne, sans ligne (avant 225) et annulées.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

jest.setTimeout(30000);

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;
const MIG = (n) => path.join(__dirname, '../../migrations', n);
const id = () => crypto.randomUUID();

describeDb('v_purchase_line_progress — migration 264 (REAL_DB)', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const schemas = [];

  afterAll(async () => {
    for (const s of schemas) await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`).catch(() => {});
    await pool.end();
  });

  async function run(schema, sql, params = []) {
    const c = await pool.connect();
    try {
      await c.query(`SET search_path TO ${schema}`);
      return await c.query(sql, params);
    } finally {
      c.release();
    }
  }

  async function setup() {
    const schema = `pl264_${process.pid}_${Date.now()}_${schemas.length}`.replace(/[^a-zA-Z0-9_]/g, '_');
    schemas.push(schema);
    await pool.query(`CREATE SCHEMA ${schema}`);
    await run(schema, `
      CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE suppliers (id uuid PRIMARY KEY);
      CREATE TABLE product_suppliers (id uuid PRIMARY KEY);
      CREATE TABLE product_skus (id uuid PRIMARY KEY);
      CREATE TABLE orders (id uuid PRIMARY KEY);
      CREATE TABLE order_items (id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE, quantity integer NOT NULL DEFAULT 1);
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
        received_qty integer NOT NULL DEFAULT 0,
        supplier_unit_price numeric(18,4),
        supplier_currency text,
        status text NOT NULL DEFAULT 'pending',
        confirmed_at timestamptz,
        hub_received_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    return schema;
  }

  async function applyMigrations(schema) {
    for (const n of ['263_purchase_lines_foundation.sql', '264_purchase_line_progress_view.sql']) {
      const sql = fs.readFileSync(MIG(n), 'utf8').replace(/public\./g, `${schema}.`);
      await run(schema, sql);
    }
  }

  // Jeu de données historique : (item, qty, received, status, withItem)
  async function seed(schema) {
    const supplier = id();
    await run(schema, 'INSERT INTO suppliers(id) VALUES ($1)', [supplier]);
    const orders = {};
    const mk = async (name, specs) => {
      const order = id();
      orders[name] = order;
      await run(schema, 'INSERT INTO orders(id) VALUES ($1)', [order]);
      for (const sp of specs) {
        const item = id();
        await run(schema, 'INSERT INTO order_items(id, order_id, quantity) VALUES ($1,$2,$3)', [item, order, sp.qty]);
        await run(schema, `INSERT INTO purchase_orders(order_id, order_item_id, supplier_id, qty, received_qty, status, hub_received_at, supplier_unit_price, supplier_currency)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [order, sp.withItem === false ? null : item, supplier, sp.qty, sp.received, sp.status, sp.hub ? new Date(Date.now() - 3600e3) : null,
            sp.status === 'cancelled' ? null : 2, sp.status === 'cancelled' ? null : 'AED']);
      }
    };
    await mk('complete', [{ qty: 2, received: 2, status: 'hub_received', hub: true }, { qty: 1, received: 1, status: 'hub_received', hub: true }]);
    await mk('partial', [{ qty: 3, received: 1, status: 'confirmed' }, { qty: 1, received: 1, status: 'hub_received', hub: true }]);
    await mk('over', [{ qty: 1, received: 3, status: 'hub_received', hub: true }]);
    await mk('cancelled_plus_done', [{ qty: 2, received: 0, status: 'cancelled' }, { qty: 1, received: 1, status: 'hub_received', hub: true }]);
    await mk('all_cancelled', [{ qty: 2, received: 0, status: 'cancelled' }]);
    await mk('pending', [{ qty: 4, received: 0, status: 'pending' }]);
    await mk('pre225_done', [{ qty: 2, received: 2, status: 'hub_received', hub: true, withItem: false }]);
    await mk('empty', []);
    return orders;
  }

  // Anciennes requêtes, calculées depuis purchase_orders (référence de parité).
  const OLD_IS_COMPLETE = `SELECT o.id, NOT EXISTS (SELECT 1 FROM purchase_orders WHERE order_id = o.id AND status != 'cancelled' AND received_qty < qty) AS v FROM orders o`;
  const NEW_IS_COMPLETE = `SELECT o.id, is_order_complete(o.id) AS v FROM orders o`;
  const OLD_AGG = `SELECT o.id,
      COUNT(*) FILTER (WHERE po.status != 'cancelled')::int AS total,
      COUNT(*) FILTER (WHERE po.received_qty >= po.qty AND po.status != 'cancelled')::int AS recus,
      COALESCE(SUM(po.qty) FILTER (WHERE po.status != 'cancelled'),0)::int AS qty_totale,
      COALESCE(SUM(po.received_qty) FILTER (WHERE po.status != 'cancelled'),0)::int AS qty_recue,
      COALESCE(SUM(po.received_qty - po.qty) FILTER (WHERE po.status != 'cancelled' AND po.received_qty > po.qty),0)::int AS excess,
      COALESCE(BOOL_AND(po.received_qty >= po.qty AND po.hub_received_at IS NOT NULL) FILTER (WHERE po.status != 'cancelled'), false) AS all_done_with_ts,
      MAX(po.hub_received_at) FILTER (WHERE po.status != 'cancelled') AS last_rx
    FROM orders o LEFT JOIN purchase_orders po ON po.order_id = o.id GROUP BY o.id`;
  const NEW_AGG = `SELECT o.id,
      COUNT(*) FILTER (WHERE NOT v.cancelled)::int AS total,
      COUNT(*) FILTER (WHERE v.received_quantity >= v.effective_quantity AND NOT v.cancelled)::int AS recus,
      COALESCE(SUM(v.effective_quantity) FILTER (WHERE NOT v.cancelled),0)::int AS qty_totale,
      COALESCE(SUM(v.received_quantity) FILTER (WHERE NOT v.cancelled),0)::int AS qty_recue,
      COALESCE(SUM(v.received_quantity - v.effective_quantity) FILTER (WHERE NOT v.cancelled AND v.received_quantity > v.effective_quantity),0)::int AS excess,
      COALESCE(BOOL_AND(v.received_quantity >= v.effective_quantity AND v.hub_received_at IS NOT NULL) FILTER (WHERE NOT v.cancelled), false) AS all_done_with_ts,
      MAX(v.hub_received_at) FILTER (WHERE NOT v.cancelled) AS last_rx
    FROM orders o LEFT JOIN v_purchase_line_progress v ON v.order_id = o.id AND v.purchase_order_id IS NOT NULL GROUP BY o.id`;

  // Contrat de GET /order/:id/completeness : par PO, la quantité commandée brute (annulée comprise).
  const OLD_COMPLETENESS = `SELECT po.id, po.status, po.qty::int AS qty, po.received_qty::int AS received_qty, (po.qty - po.received_qty)::int AS remaining
    FROM purchase_orders po`;
  const NEW_COMPLETENESS = `SELECT po.id, po.status, SUM(v.quantity)::int AS qty, SUM(v.received_quantity)::int AS received_qty, (SUM(v.quantity) - SUM(v.received_quantity))::int AS remaining
    FROM v_purchase_line_progress v JOIN purchase_orders po ON po.id = v.purchase_order_id GROUP BY po.id, po.status`;

  const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

  it('is_order_complete et les agrégats de réception sont identiques à l\'ancien calcul (PO historiques)', async () => {
    const s = await setup();
    const orders = await seed(s);
    await applyMigrations(s);
    expect(byId((await run(s, NEW_IS_COMPLETE)).rows)).toEqual(byId((await run(s, OLD_IS_COMPLETE)).rows));
    expect(byId((await run(s, NEW_AGG)).rows)).toEqual(byId((await run(s, OLD_AGG)).rows));
    expect(byId((await run(s, NEW_COMPLETENESS)).rows)).toEqual(byId((await run(s, OLD_COMPLETENESS)).rows));
    // garde-fous de lecture : le jeu de données couvre bien les cas métier
    const complete = byId((await run(s, NEW_IS_COMPLETE)).rows);
    expect(complete[orders.complete].v).toBe(true);
    expect(complete[orders.partial].v).toBe(false);
    expect(complete[orders.pending].v).toBe(false);
    expect(complete[orders.all_cancelled].v).toBe(true);
  });

  it('les PO antérieures à 225 (sans ligne) restent visibles avec line_id NULL', async () => {
    const s = await setup();
    const orders = await seed(s);
    await applyMigrations(s);
    const { rows } = await run(s, `SELECT line_id, po_shape, effective_quantity, received_quantity FROM v_purchase_line_progress WHERE order_id = $1`, [orders.pre225_done]);
    expect(rows).toEqual([{ line_id: null, po_shape: 'historical_no_line', effective_quantity: 2, received_quantity: 2 }]);
  });

  it('une PO historique avec ligne : une seule ligne de vue, effectif = confirmé, annulée = effectif 0', async () => {
    const s = await setup();
    const orders = await seed(s);
    await applyMigrations(s);
    const { rows } = await run(s, `SELECT po_shape, effective_quantity, received_quantity, cancelled FROM v_purchase_line_progress WHERE order_id = $1 ORDER BY effective_quantity`, [orders.cancelled_plus_done]);
    expect(rows).toEqual([
      { po_shape: 'historical', effective_quantity: 0, received_quantity: 0, cancelled: true },
      { po_shape: 'historical', effective_quantity: 1, received_quantity: 1, cancelled: false },
    ]);
    // exactement une ligne de vue par PO (pas de doublon avec la branche « sans ligne »)
    const { rows: [c] } = await run(s, `SELECT (SELECT count(*) FROM v_purchase_line_progress)::int AS v, (SELECT count(*) FROM purchase_orders)::int AS p`);
    expect(c.v).toBe(c.p);
  });

  it('ligne ouverte (sans PO) et ligne d\'une PO regroupée : jamais comptées comme reçu, is_order_complete ignore l\'ouverte', async () => {
    const s = await setup();
    const orders = await seed(s);
    await applyMigrations(s);
    const it = { id: id() };
    await run(s, 'INSERT INTO order_items(id, order_id, quantity) VALUES ($1,$2,2)', [it.id, orders.empty]);
    const supplier = (await run(s, 'SELECT id FROM suppliers LIMIT 1')).rows[0].id;
    // ligne ouverte
    await run(s, `INSERT INTO purchase_lines(order_item_id, supplier_id, supplier_sku, quantity, procurement_hub_ref) VALUES ($1,$2,'S',2,'DXB')`, [it.id, supplier]);
    const { rows } = await run(s, `SELECT po_shape, purchase_order_id, effective_quantity, received_quantity FROM v_purchase_line_progress WHERE order_id = $1`, [orders.empty]);
    expect(rows).toEqual([{ po_shape: null, purchase_order_id: null, effective_quantity: 2, received_quantity: 0 }]);
    expect((await run(s, `SELECT is_order_complete($1) AS v`, [orders.empty])).rows[0].v).toBe(true);
  });
});
