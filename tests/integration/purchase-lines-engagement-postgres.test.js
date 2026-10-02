'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration purchase-lines-engagement-postgres.test.js
 * @brief PURCHASE-LINES PR 5 — preuve PostgreSQL réelle : soumission, confirmation par PO avec reliquat (ordre I1), clôture de ligne, rejet fournisseur sans écriture, marché conservé par ligne.
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
const mockNotifyText = jest.fn().mockResolvedValue(true);
jest.mock('../../services/notification-service', () => ({ notifyText: (...args) => mockNotifyText(...args) }));
const mockReadiness = jest.fn();
jest.mock('../../services/suppliers/canonical-unit-purchasing-gate', () => ({
  evaluateCanonicalProcurementReadiness: (...args) => mockReadiness(...args),
}));

const db = require('../../db');
const grouped = require('../../services/purchasing-grouped-service');
const engagement = require('../../services/purchasing-engagement-service');

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;
const id = () => crypto.randomUUID();
const MIGRATIONS = ['263_purchase_lines_foundation.sql', '264_purchase_line_progress_view.sql', '265_hub_allocations_purchase_line.sql', '266_purchase_orders_grouped_form.sql'];
const identityOf = (provider, payload = { supplier_sku: 'U1' }) => JSON.stringify({ provider, version: 1, payload });
const NOON = identityOf('noon');
const ALLEGRO = (offer) => identityOf('allegro', { environment: 'sandbox', offer_id: offer });

describeDb('engagement d\'une PO regroupée — soumission, confirmation, reliquats, clôture (REAL_DB)', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const schemas = [];
  let current;
  const markets = {};

  function migrationSql(name) {
    return fs.readFileSync(path.join(__dirname, '../../migrations', name), 'utf8').replace(/public\./g, `${current}.`);
  }

  async function newSchema() {
    current = `plg267_${process.pid}_${Date.now()}_${schemas.length}`.replace(/[^a-zA-Z0-9_]/g, '_');
    schemas.push(current);
    await pool.query(`CREATE SCHEMA ${current}`);
    const c = await pool.connect();
    try {
      await c.query(`SET search_path TO ${current}`);
      await c.query(`
        CREATE TABLE users (id uuid PRIMARY KEY);
        CREATE TABLE suppliers (id uuid PRIMARY KEY, name text, platform text, contact_phone text, deleted_at timestamptz);
        CREATE TABLE product_suppliers (id uuid PRIMARY KEY);
        CREATE TABLE product_skus (id uuid PRIMARY KEY);
        CREATE TABLE products (id uuid PRIMARY KEY, name text);
        CREATE TABLE markets (id uuid PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL);
        CREATE TABLE orders (id uuid PRIMARY KEY, reference text, market_id uuid REFERENCES markets(id), created_at timestamptz NOT NULL DEFAULT now());
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
          tracking_url text,
          tracking_number text,
          trigger_mode text NOT NULL DEFAULT 'manual',
          notes text,
          ordered_at timestamptz,
          confirmed_at timestamptz,
          received_qty integer NOT NULL DEFAULT 0,
          hub_received_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT chk_purchase_orders_qty CHECK (qty > 0),
          CONSTRAINT purchase_orders_status_check CHECK (status = ANY (ARRAY['pending'::text, 'notified'::text, 'confirmed'::text, 'shipped'::text, 'hub_received'::text, 'cancelled'::text]))
        );
        -- Tables Hub minimales : la vue de progression lit le reçu d'une ligne regroupée dans les placements RECEIVE.
        CREATE TABLE hub_purchase_allocations (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          purchase_order_id uuid NOT NULL,
          order_item_id uuid,
          product_sku_id uuid,
          supplier_id uuid
        );
        CREATE TABLE hub_physical_unit_placements (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          allocation_id uuid NOT NULL REFERENCES hub_purchase_allocations(id),
          operation_type text NOT NULL,
          quantity integer NOT NULL
        );
      `);
      for (const name of MIGRATIONS) await c.query(migrationSql(name));
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

  beforeEach(async () => {
    process.env.KOMERCE_GROUPED_PURCHASING = '1';
    mockNotifyText.mockClear();
    mockReadiness.mockReset();
    mockReadiness.mockResolvedValue({ ready: true, status: 'FULFILLMENT_READY', preflight: { ready: true, evidence: { manual_procurement_ready: true } } });
    await newSchema();
  });
  afterEach(() => { delete process.env.KOMERCE_GROUPED_PURCHASING; delete process.env.ADMIN_PHONE; });

  // ─── fixtures ─────────────────────────────────────────────────────────────────────────────────
  async function seedSupplier({ platform = 'manual', name = 'Fournisseur', phone = null } = {}) {
    const supplier = id();
    await q('INSERT INTO suppliers(id, name, platform, contact_phone) VALUES ($1,$2,$3,$4)', [supplier, name, platform, phone]);
    return supplier;
  }

  async function seedMarket(code) {
    if (!markets[`${current}:${code}`]) {
      const market = id();
      await q('INSERT INTO markets(id, code, name) VALUES ($1,$2,$3)', [market, code, `Marché ${code}`]);
      markets[`${current}:${code}`] = market;
    }
    return markets[`${current}:${code}`];
  }

  async function seedItem({ quantity = 1, market = 'KM' } = {}) {
    const order = id(); const item = id(); const product = id();
    const marketId = await seedMarket(market);
    await q('INSERT INTO orders(id, reference, market_id) VALUES ($1,$2,$3)', [order, `CMD-${order.slice(0, 6)}`, marketId]);
    await q('INSERT INTO products(id, name) VALUES ($1,$2)', [product, 'Produit']);
    await q('INSERT INTO order_items(id, order_id, product_id, quantity) VALUES ($1,$2,$3,$4)', [item, order, product, quantity]);
    return { order, item, market: marketId };
  }

  async function seedLine({ supplier, quantity = 1, market = 'KM', identity = NOON, unitRef = 'U1', price = 10, item = null } = {}) {
    const lineItem = item || (await seedItem({ quantity, market })).item;
    const sku = id();
    await q('INSERT INTO product_skus(id) VALUES ($1)', [sku]);
    const { rows: [line] } = await q(`
      INSERT INTO purchase_lines(order_item_id, supplier_id, product_sku_id, supplier_sku, supplier_unit_ref,
                                 supplier_order_identity, quantity, supplier_unit_price, supplier_currency, procurement_hub_ref)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'USD','DXB') RETURNING id
    `, [lineItem, supplier, sku, `SKU-${unitRef}`, unitRef, identity, quantity, price]);
    return { line: line.id, item: lineItem };
  }

  async function preparedPo(supplier, lineIds) {
    return (await grouped.preparePurchaseOrder({ supplier_id: supplier, procurement_hub_ref: 'DXB', line_ids: lineIds })).purchase_order;
  }

  async function submittedPo(supplier, lineIds) {
    const po = await preparedPo(supplier, lineIds);
    await q(`UPDATE purchase_orders SET status = 'notified', ordered_at = now() WHERE id = $1`, [po.id]);
    return po;
  }

  const row = async (sql, params) => (await q(sql, params)).rows[0];
  const need = async (item) => (await row(`
    SELECT COALESCE(SUM(public_eff), 0)::int AS n FROM (
      SELECT purchase_line_effective_quantity(cancelled_at, settled_quantity, confirmed_quantity, quantity) AS public_eff
        FROM purchase_lines WHERE order_item_id = $1) x`, [item])).n;

  /** Réception Hub simulée : une allocation par ligne et un placement RECEIVE (ce que lit v_purchase_line_progress). */
  async function receive(lineId, quantity) {
    const { rows: [line] } = await q('SELECT purchase_order_id, order_item_id, product_sku_id, supplier_id FROM purchase_lines WHERE id = $1', [lineId]);
    const { rows: [alloc] } = await q(`
      INSERT INTO hub_purchase_allocations(purchase_order_id, order_item_id, product_sku_id, supplier_id, purchase_line_id)
      VALUES ($1,$2,$3,$4,$5) RETURNING id`, [line.purchase_order_id, line.order_item_id, line.product_sku_id, line.supplier_id, lineId]);
    await q('INSERT INTO hub_physical_unit_placements(allocation_id, operation_type, quantity) VALUES ($1,$2,$3)', [alloc.id, 'RECEIVE', quantity]);
  }

  // ─── submit ───────────────────────────────────────────────────────────────────────────────────
  describe('submit', () => {
    it('PO draft multi-marché → notified, groupes par supplier_unit_ref (quantité sommée), message admin après commit', async () => {
      process.env.ADMIN_PHONE = '+2250000';
      const supplier = await seedSupplier({ name: 'Noon Trading' });
      const a = await seedLine({ supplier, quantity: 2, market: 'KM', unitRef: 'U1' });
      const b = await seedLine({ supplier, quantity: 3, market: 'CM', unitRef: 'U1' });
      const c = await seedLine({ supplier, quantity: 1, market: 'CG', unitRef: 'U2' });
      const po = await preparedPo(supplier, [a.line, b.line, c.line]);

      const out = await engagement.submitPurchaseOrder(po.id);

      expect(out.purchase_order.status).toBe('notified');
      expect(out.purchase_order.ordered_at).not.toBeNull();
      expect(out.place_order_invoked).toBe(false);
      const byRef = Object.fromEntries(out.groups.map((g) => [g.supplier_unit_ref, g.quantity]));
      expect(byRef).toEqual({ U1: 5, U2: 1 });
      expect(out.multi_market).toBe(true);
      expect(out.markets.map((m) => m.market_code)).toEqual(['CG', 'CM', 'KM']);
      expect(out.preflights.every((p) => p.ready && p.status === 'NOT_REQUIRED')).toBe(true);
      expect(out.notification.channel).toBe('admin_manual');
      expect(mockNotifyText).toHaveBeenCalledTimes(1);
      expect(mockNotifyText.mock.calls[0][1]).toContain('x5');
      expect(mockReadiness).not.toHaveBeenCalled();
    });

    it('fournisseur WhatsApp : lien wa.me écrit APRÈS la persistance de la PO, aucun message admin', async () => {
      const supplier = await seedSupplier({ platform: 'whatsapp', phone: '+971500000' });
      const a = await seedLine({ supplier, quantity: 2 });
      const po = await preparedPo(supplier, [a.line]);
      expect((await row('SELECT trigger_mode FROM purchase_orders WHERE id=$1', [po.id])).trigger_mode).toBe('whatsapp');

      const out = await engagement.submitPurchaseOrder(po.id);

      expect(out.notification.channel).toBe('whatsapp');
      expect(out.purchase_order.notes).toMatch(/^wa_url:https:\/\/wa\.me\/\+971500000\?text=/);
      expect(decodeURIComponent(out.notification.wa_url)).toContain('(x2)');
      expect(mockNotifyText).not.toHaveBeenCalled();
    });

    it('préparation distante refusée → 409 avec les verdicts, la PO reste draft et les lignes rattachées', async () => {
      const supplier = await seedSupplier({ platform: 'allegro' });
      const a = await seedLine({ supplier, quantity: 2, identity: ALLEGRO('111'), unitRef: '111' });
      const po = await preparedPo(supplier, [a.line]);
      mockReadiness.mockResolvedValue({ ready: false, status: 'OUT_OF_STOCK', reason: 'ALLEGRO_INSUFFICIENT_STOCK' });

      await expect(engagement.submitPurchaseOrder(po.id)).rejects.toMatchObject({
        status: 409, code: 'PURCHASE_ORDER_SUBMIT_REFUSED',
        verdicts: [expect.objectContaining({ supplier_unit_ref: '111', ready: false, status: 'OUT_OF_STOCK' })],
      });
      expect(mockReadiness).toHaveBeenCalledWith(expect.objectContaining({ quantity: 2, productSkuId: expect.any(String) }));
      const after = await row('SELECT status, ordered_at FROM purchase_orders WHERE id=$1', [po.id]);
      expect(after).toEqual({ status: 'draft', ordered_at: null });
      expect((await row('SELECT count(*)::int AS n FROM purchase_lines WHERE purchase_order_id=$1', [po.id])).n).toBe(1);
      expect(mockNotifyText).not.toHaveBeenCalled();
    });

    it('Allegro ne prend qu\'une ligne : deux supplier_unit_ref → ALLEGRO_MULTI_ITEM_UNSUPPORTED, PO reste draft', async () => {
      const supplier = await seedSupplier({ platform: 'allegro' });
      const a = await seedLine({ supplier, identity: ALLEGRO('111'), unitRef: '111' });
      const b = await seedLine({ supplier, identity: ALLEGRO('222'), unitRef: '222' });
      const po = await preparedPo(supplier, [a.line, b.line]);

      await expect(engagement.submitPurchaseOrder(po.id)).rejects.toMatchObject({
        status: 409, code: 'PURCHASE_ORDER_SUBMIT_REFUSED',
        verdicts: expect.arrayContaining([expect.objectContaining({ status: 'BUILD_ORDER_PAYLOAD_REFUSED', reason: 'ALLEGRO_MULTI_ITEM_UNSUPPORTED' })]),
      });
      expect((await row('SELECT status FROM purchase_orders WHERE id=$1', [po.id])).status).toBe('draft');
    });

    it('PO déjà soumise, historique ou introuvable : 409 / 404 ; flag éteint : 409', async () => {
      const supplier = await seedSupplier();
      const a = await seedLine({ supplier });
      const po = await preparedPo(supplier, [a.line]);
      await engagement.submitPurchaseOrder(po.id);
      await expect(engagement.submitPurchaseOrder(po.id)).rejects.toMatchObject({ status: 409, code: 'PURCHASE_ORDER_NOT_DRAFT' });
      await expect(engagement.submitPurchaseOrder(id())).rejects.toMatchObject({ status: 404 });
      await expect(engagement.submitPurchaseOrder('pas-un-uuid')).rejects.toMatchObject({ status: 400 });
      delete process.env.KOMERCE_GROUPED_PURCHASING;
      await expect(engagement.submitPurchaseOrder(po.id)).rejects.toMatchObject({ status: 409, code: 'GROUPED_PURCHASING_DISABLED' });
    });

    it('une PO draft sans ligne active ne se soumet pas', async () => {
      const supplier = await seedSupplier();
      const a = await seedLine({ supplier });
      const po = await preparedPo(supplier, [a.line]);
      await grouped.cancelLine(a.line, 'test');
      await expect(engagement.submitPurchaseOrder(po.id)).rejects.toMatchObject({ status: 409, code: 'PURCHASE_ORDER_EMPTY' });
    });
  });

  // ─── confirm ──────────────────────────────────────────────────────────────────────────────────
  describe('confirm', () => {
    it('confirmation partielle : la ligne d\'origine baisse d\'abord, le reliquat naît ouvert avec parent_line_id et le même marché', async () => {
      const supplier = await seedSupplier();
      const a = await seedLine({ supplier, quantity: 5, market: 'KM' });
      const b = await seedLine({ supplier, quantity: 2, market: 'CM', unitRef: 'U2' });
      const po = await submittedPo(supplier, [a.line, b.line]);

      const out = await engagement.confirmGroupedPurchaseOrder(po.id, {
        supplier_order_id: 'SUP-1', tracking_number: 'TRK',
        lines: [
          { purchase_line_id: a.line, confirmed_quantity: 3, confirmed_unit_price: 12.5 },
          { purchase_line_id: b.line, confirmed_quantity: 2 },
        ],
      });

      expect(out.purchase_order).toMatchObject({ status: 'confirmed', supplier_order_id: 'SUP-1', tracking_number: 'TRK' });
      expect(out.purchase_order.confirmed_at).not.toBeNull();
      expect(out.remnants).toHaveLength(1);
      expect(out.remnants[0]).toMatchObject({
        parent_line_id: a.line, quantity: 2, purchase_order_id: null, market_code: 'KM', confirmed_quantity: null,
      });
      const lineA = out.lines.find((l) => l.line_id === a.line);
      expect(lineA).toMatchObject({ confirmed_quantity: 3, confirmed_unit_price: 12.5, effective_quantity: 3, market_code: 'KM' });
      expect(out.lines.find((l) => l.line_id === b.line)).toMatchObject({ confirmed_quantity: 2, confirmed_unit_price: 10 });
      // I1 : la somme des effectifs de l'article reste égale au besoin (3 confirmés + 2 en reliquat).
      expect(await need(a.item)).toBe(5);
      // Ventilation par marché (lecture seule) : quantités, reliquat et montants confirmés.
      expect(out.multi_market).toBe(true);
      const km = out.markets.find((m) => m.market_code === 'KM');
      const cm = out.markets.find((m) => m.market_code === 'CM');
      expect(km).toMatchObject({ confirmed_quantity: 3, remnant_quantity: 2, confirmed_amounts: [{ currency: 'USD', amount: 37.5 }] });
      expect(cm).toMatchObject({ confirmed_quantity: 2, remnant_quantity: 0, confirmed_amounts: [{ currency: 'USD', amount: 20 }] });
      // La PO ne porte aucun marché.
      expect(Object.keys(out.purchase_order)).not.toContain('market_id');
    });

    it('un reliquat ouvert est regroupable dans une nouvelle PO (même fournisseur ou autre)', async () => {
      const supplier = await seedSupplier();
      const a = await seedLine({ supplier, quantity: 4 });
      const po = await submittedPo(supplier, [a.line]);
      const out = await engagement.confirmGroupedPurchaseOrder(po.id, { lines: [{ purchase_line_id: a.line, confirmed_quantity: 1 }] });
      const open = await grouped.listOpenLines();
      expect(open.groups[0].lines.map((l) => l.line_id)).toEqual([out.remnants[0].line_id]);
      const second = await grouped.preparePurchaseOrder({ supplier_id: supplier, procurement_hub_ref: 'DXB', line_ids: [out.remnants[0].line_id] });
      expect(second.purchase_order.status).toBe('draft');
    });

    it('lines doit couvrir exactement les lignes non annulées : manquante ou en trop → 409, rien n\'est écrit', async () => {
      const supplier = await seedSupplier();
      const a = await seedLine({ supplier, quantity: 2 });
      const b = await seedLine({ supplier, quantity: 2, unitRef: 'U2' });
      const stranger = await seedLine({ supplier, quantity: 2, unitRef: 'U3' });
      const po = await submittedPo(supplier, [a.line, b.line]);

      await expect(engagement.confirmGroupedPurchaseOrder(po.id, { lines: [{ purchase_line_id: a.line, confirmed_quantity: 2 }] }))
        .rejects.toMatchObject({ status: 409, code: 'PURCHASE_LINES_MISMATCH', missing: [b.line], extra: [] });
      await expect(engagement.confirmGroupedPurchaseOrder(po.id, {
        lines: [
          { purchase_line_id: a.line, confirmed_quantity: 2 }, { purchase_line_id: b.line, confirmed_quantity: 2 },
          { purchase_line_id: stranger.line, confirmed_quantity: 2 },
        ],
      })).rejects.toMatchObject({ status: 409, code: 'PURCHASE_LINES_MISMATCH', extra: [stranger.line] });

      expect((await row('SELECT status FROM purchase_orders WHERE id=$1', [po.id])).status).toBe('notified');
      expect((await row('SELECT count(*)::int AS n FROM purchase_lines WHERE confirmed_quantity IS NOT NULL')).n).toBe(0);
      expect((await row('SELECT count(*)::int AS n FROM purchase_lines WHERE parent_line_id IS NOT NULL')).n).toBe(0);
    });

    it('validation : quantité > ligne, négative, doublon, prix ≤ 0, corps vide → 400', async () => {
      const supplier = await seedSupplier();
      const a = await seedLine({ supplier, quantity: 2 });
      const po = await submittedPo(supplier, [a.line]);
      const bad = [
        { lines: [{ purchase_line_id: a.line, confirmed_quantity: 3 }] },
        { lines: [{ purchase_line_id: a.line, confirmed_quantity: -1 }] },
        { lines: [{ purchase_line_id: a.line, confirmed_quantity: 1.5 }] },
        { lines: [{ purchase_line_id: a.line, confirmed_quantity: 1 }, { purchase_line_id: a.line, confirmed_quantity: 1 }] },
        { lines: [{ purchase_line_id: a.line, confirmed_quantity: 1, confirmed_unit_price: 0 }] },
        { lines: [] },
        {},
      ];
      for (const body of bad) {
        await expect(engagement.confirmGroupedPurchaseOrder(po.id, body)).rejects.toMatchObject({ status: 400 });
      }
      expect((await row('SELECT status FROM purchase_orders WHERE id=$1', [po.id])).status).toBe('notified');
    });

    it('tout à zéro → PO cancelled, lignes annulées, reliquats ouverts pour le besoin entier', async () => {
      const supplier = await seedSupplier();
      const a = await seedLine({ supplier, quantity: 3 });
      const po = await submittedPo(supplier, [a.line]);

      const out = await engagement.confirmGroupedPurchaseOrder(po.id, { lines: [{ purchase_line_id: a.line, confirmed_quantity: 0 }] });

      expect(out.purchase_order.status).toBe('cancelled');
      expect(out.remnants).toHaveLength(1);
      expect(out.remnants[0]).toMatchObject({ quantity: 3, parent_line_id: a.line, purchase_order_id: null });
      expect((await row('SELECT cancelled_at IS NOT NULL AS c FROM purchase_lines WHERE id=$1', [a.line])).c).toBe(true);
      expect(await need(a.item)).toBe(3);
    });

    it('confirmation intégrale : aucun reliquat ; seule une PO notified se confirme (draft, déjà confirmée → 409)', async () => {
      const supplier = await seedSupplier();
      const a = await seedLine({ supplier, quantity: 2 });
      const draft = await preparedPo(supplier, [a.line]);
      await expect(engagement.confirmGroupedPurchaseOrder(draft.id, { lines: [{ purchase_line_id: a.line, confirmed_quantity: 2 }] }))
        .rejects.toMatchObject({ status: 409, code: 'PURCHASE_ORDER_NOT_NOTIFIED', current_status: 'draft' });
      await q(`UPDATE purchase_orders SET status = 'notified' WHERE id = $1`, [draft.id]);
      const out = await engagement.confirmGroupedPurchaseOrder(draft.id, { lines: [{ purchase_line_id: a.line, confirmed_quantity: 2 }] });
      expect(out.remnants).toEqual([]);
      expect(out.markets[0].remnant_quantity).toBe(0);
      await expect(engagement.confirmGroupedPurchaseOrder(draft.id, { lines: [{ purchase_line_id: a.line, confirmed_quantity: 2 }] }))
        .rejects.toMatchObject({ status: 409, code: 'PURCHASE_ORDER_NOT_NOTIFIED', current_status: 'confirmed' });
    });

    it('rejet de la réconciliation fournisseur (Allegro) → 409 et RIEN n\'est écrit (ni lignes, ni reliquat, ni PO)', async () => {
      const supplier = await seedSupplier({ platform: 'allegro' });
      const a = await seedLine({ supplier, quantity: 2, identity: ALLEGRO('111'), unitRef: '111' });
      const po = await submittedPo(supplier, [a.line]);
      const client = { getSellerOrder: jest.fn(async () => { throw new Error('ALLEGRO_DOWN'); }) };

      await expect(engagement.confirmGroupedPurchaseOrder(
        po.id,
        { supplier_order_id: 'CHECKOUT-1', lines: [{ purchase_line_id: a.line, confirmed_quantity: 1 }] },
        { context: { allegroSandboxClient: client } }
      )).rejects.toMatchObject({ status: 409, code: 'PURCHASE_ORDER_CONFIRMATION_REJECTED', provider: 'allegro' });

      expect((await row('SELECT status, supplier_order_id FROM purchase_orders WHERE id=$1', [po.id]))).toEqual({ status: 'notified', supplier_order_id: null });
      expect((await row('SELECT confirmed_quantity FROM purchase_lines WHERE id=$1', [a.line])).confirmed_quantity).toBeNull();
      expect((await row('SELECT count(*)::int AS n FROM purchase_lines')).n).toBe(1);
    });

    it('Allegro sans référence externe → rejeté (EXTERNAL_REF_REQUIRED), pas de confirmation silencieuse', async () => {
      const supplier = await seedSupplier({ platform: 'allegro' });
      const a = await seedLine({ supplier, quantity: 2, identity: ALLEGRO('111'), unitRef: '111' });
      const po = await submittedPo(supplier, [a.line]);
      await expect(engagement.confirmGroupedPurchaseOrder(po.id, { lines: [{ purchase_line_id: a.line, confirmed_quantity: 2 }] }))
        .rejects.toMatchObject({ status: 409, code: 'PURCHASE_ORDER_CONFIRMATION_REJECTED' });
    });

    it('la confirmation est à usage unique : I5 refuse de réécrire une ligne déjà confirmée', async () => {
      const supplier = await seedSupplier();
      const a = await seedLine({ supplier, quantity: 2 });
      const po = await submittedPo(supplier, [a.line]);
      await engagement.confirmGroupedPurchaseOrder(po.id, { lines: [{ purchase_line_id: a.line, confirmed_quantity: 2 }] });
      await q(`UPDATE purchase_orders SET status = 'notified' WHERE id = $1`, [po.id]);
      await expect(engagement.confirmGroupedPurchaseOrder(po.id, { lines: [{ purchase_line_id: a.line, confirmed_quantity: 1 }] }))
        .rejects.toMatchObject({ status: 409, code: 'PURCHASE_LINE_FROZEN' });
    });
  });

  // ─── settle ───────────────────────────────────────────────────────────────────────────────────
  describe('settle', () => {
    async function confirmedLine({ quantity = 6, market = 'KM', extra = [] } = {}) {
      const supplier = await seedSupplier();
      const a = await seedLine({ supplier, quantity, market });
      const others = [];
      for (const [i, q2] of extra.entries()) others.push(await seedLine({ supplier, quantity: q2, unitRef: `X${i}` }));
      const po = await submittedPo(supplier, [a.line, ...others.map((o) => o.line)]);
      await engagement.confirmGroupedPurchaseOrder(po.id, {
        lines: [{ purchase_line_id: a.line, confirmed_quantity: quantity }, ...others.map((o, i) => ({ purchase_line_id: o.line, confirmed_quantity: extra[i] }))],
      });
      return { supplier, ...a, po, others };
    }

    it('écart à la réception : 4 reçus sur 6 → soldée à 4 ; le reliquat de 2 naît ouvert (même marché) seulement avec reopen_remainder', async () => {
      const { line, item, others } = await confirmedLine({ quantity: 6, market: 'CG', extra: [3] });
      await receive(line, 4);

      const out = await engagement.settleLine(line, { settled_quantity: 4, reason: '2 unités endommagées', reopen_remainder: true });

      expect(out.line).toMatchObject({ settled_quantity: 4, effective_quantity: 4, settle_reason: '2 unités endommagées', market_code: 'CG' });
      expect(out.remnant).toMatchObject({ parent_line_id: line, quantity: 2, purchase_order_id: null, market_code: 'CG' });
      expect(out.unsettled_quantity).toBe(2);
      expect(out.markets[0]).toMatchObject({ market_code: 'CG', confirmed_quantity: 4, remnant_quantity: 2 });
      expect(await need(item)).toBe(6);
      // L'autre ligne n'est pas encore reçue : la PO n'est pas clôturée.
      expect(out.purchase_order.status).toBe('confirmed');
      expect(others).toHaveLength(1);
    });

    it('sans reopen_remainder (défaut) : aucune ligne créée', async () => {
      const { line } = await confirmedLine({ quantity: 6, extra: [2] });
      await receive(line, 5);
      const out = await engagement.settleLine(line, { settled_quantity: 5, reason: 'écart accepté' });
      expect(out.remnant).toBeNull();
      expect((await row('SELECT count(*)::int AS n FROM purchase_lines WHERE parent_line_id IS NOT NULL')).n).toBe(0);
    });

    it('toutes les lignes soldées (reçu ≥ effectif) → la PO regroupée passe en hub_received', async () => {
      const { line, others, po } = await confirmedLine({ quantity: 6, extra: [3] });
      await receive(others[0].line, 3);
      await receive(line, 4);
      const out = await engagement.settleLine(line, { settled_quantity: 4, reason: 'casse' });
      expect(out.purchase_order).toMatchObject({ id: po.id, status: 'hub_received' });
      expect(out.purchase_order.hub_received_at).not.toBeNull();
    });

    it('settled_quantity ≤ reçu : au-delà du reçu → 409 ; ≥ effectif → 400 ; rien n\'est écrit', async () => {
      const { line } = await confirmedLine({ quantity: 6 });
      await receive(line, 3);
      await expect(engagement.settleLine(line, { settled_quantity: 4, reason: 'x' }))
        .rejects.toMatchObject({ status: 409, code: 'PURCHASE_LINE_SETTLE_ABOVE_RECEIVED', received_quantity: 3 });
      await expect(engagement.settleLine(line, { settled_quantity: 6, reason: 'x' })).rejects.toMatchObject({ status: 400 });
      await expect(engagement.settleLine(line, { settled_quantity: 7, reason: 'x' })).rejects.toMatchObject({ status: 400 });
      expect((await row('SELECT settled_at FROM purchase_lines WHERE id=$1', [line])).settled_at).toBeNull();
    });

    it('rien reçu : une ligne se solde à 0 ; refus sans motif, quantité négative, déjà soldée, ligne ouverte, PO non confirmée, introuvable', async () => {
      const { line, supplier } = await confirmedLine({ quantity: 4, extra: [2] });
      await expect(engagement.settleLine(line, { settled_quantity: 2 })).rejects.toMatchObject({ status: 400 });
      await expect(engagement.settleLine(line, { settled_quantity: -1, reason: 'x' })).rejects.toMatchObject({ status: 400 });
      const out = await engagement.settleLine(line, { settled_quantity: 0, reason: 'jamais livrée', reopen_remainder: true });
      expect(out.remnant).toMatchObject({ quantity: 4 });
      await expect(engagement.settleLine(line, { settled_quantity: 0, reason: 'x' }))
        .rejects.toMatchObject({ status: 409, code: 'PURCHASE_LINE_ALREADY_SETTLED' });

      const open = await seedLine({ supplier, quantity: 2 });
      await expect(engagement.settleLine(open.line, { settled_quantity: 0, reason: 'x' }))
        .rejects.toMatchObject({ status: 409, code: 'PURCHASE_LINE_NOT_SETTLEABLE' });

      const notified = await seedLine({ supplier, quantity: 2 });
      await submittedPo(supplier, [notified.line]);
      await expect(engagement.settleLine(notified.line, { settled_quantity: 0, reason: 'x' }))
        .rejects.toMatchObject({ status: 409, code: 'PURCHASE_LINE_NOT_SETTLEABLE', current_status: 'notified' });

      await expect(engagement.settleLine(id(), { settled_quantity: 0, reason: 'x' })).rejects.toMatchObject({ status: 404 });
    });
  });

  // ─── reliquat acheté ailleurs ─────────────────────────────────────────────────────────────────
  describe('reliquat acheté ailleurs', () => {
    it('annuler le reliquat ouvert libère le besoin ; I1 refuse une ligne qui le dépasse', async () => {
      const supplier = await seedSupplier();
      const a = await seedLine({ supplier, quantity: 4 });
      const po = await submittedPo(supplier, [a.line]);
      const out = await engagement.confirmGroupedPurchaseOrder(po.id, { lines: [{ purchase_line_id: a.line, confirmed_quantity: 1 }] });
      const remnant = out.remnants[0].line_id;

      // Tant que le reliquat est ouvert, le besoin est couvert : une ligne manuelle de 3 serait un sur-engagement.
      await expect(q(`
        INSERT INTO purchase_lines(order_item_id, supplier_id, product_sku_id, supplier_sku, supplier_unit_ref, supplier_order_identity,
                                   quantity, supplier_unit_price, supplier_currency, procurement_hub_ref)
        SELECT order_item_id, supplier_id, product_sku_id, supplier_sku, supplier_unit_ref, supplier_order_identity, 3, 9, 'USD', 'DXB'
          FROM purchase_lines WHERE id = $1`, [a.line])).rejects.toThrow(/purchase_line_overcommitted/);

      await grouped.cancelLine(remnant, 'racheté chez un autre fournisseur');
      expect(await need(a.item)).toBe(1);
      await q(`
        INSERT INTO purchase_lines(order_item_id, supplier_id, product_sku_id, supplier_sku, supplier_unit_ref, supplier_order_identity,
                                   quantity, supplier_unit_price, supplier_currency, procurement_hub_ref)
        SELECT order_item_id, supplier_id, product_sku_id, supplier_sku, supplier_unit_ref, supplier_order_identity, 3, 9, 'USD', 'DXB'
          FROM purchase_lines WHERE id = $1`, [a.line]);
      expect(await need(a.item)).toBe(4);
    });
  });
});
