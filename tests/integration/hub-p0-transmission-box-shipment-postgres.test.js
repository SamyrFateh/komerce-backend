'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration hub-p0-transmission-box-shipment-postgres.test.js
 * @brief HUB P0 (#3247) — migration 358 sur PostgreSQL réel : preuve d'envoi de PO immuable et rattachement KOM-BOX → expédition mono-marché.
 */

const crypto = require('crypto');
const { Pool } = require('pg');

jest.setTimeout(30000);

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;
const id = () => crypto.randomUUID();

describeDb('migration 358 — transmission de PO et carton → expédition (REAL_DB)', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const tag = `H358-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const created = { po: [], units: [], shipments: [], links: [] };
  let km; let cm; let user; let supplier;

  const rejects = async (promise, fragment) => {
    await expect(promise).rejects.toThrow(new RegExp(fragment));
  };

  // Les fixtures d'unités physiques sautent les triggers d'état Hub (réservés au parcours opérateur) ;
  // les triggers de la migration 358 sont, eux, toujours actifs lors des assertions.
  async function makeUnit({ market, state = 'PACKED', type = 'MARKET_PARCEL' }) {
    const unitId = id();
    const client = await pool.connect();
    try {
      await client.query("SET session_replication_role = 'replica'");
      await client.query(
        `INSERT INTO hub_physical_units(id, reference, unit_type, state, market_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [unitId, `${tag}-U-${created.units.length}`, type, state, market]
      );
    } finally {
      await client.query("SET session_replication_role = 'origin'");
      client.release();
    }
    created.units.push(unitId);
    return unitId;
  }

  async function makeShipment({ market, stage = 'hub_ready' }) {
    const shipmentId = id();
    await pool.query(
      `INSERT INTO international_shipments(id, market_id, reference, forwarder_name, transport_mode, stage, created_by)
       VALUES ($1, $2, $3, 'Transitaire test', 'sea', $4, $5)`,
      [shipmentId, market, `${tag}-S-${created.shipments.length}`, stage, user]
    );
    created.shipments.push(shipmentId);
    return shipmentId;
  }

  async function makePo(status = 'draft') {
    const poId = id();
    await pool.query(
      `INSERT INTO purchase_orders(id, order_id, supplier_id, market_id, status, trigger_mode, procurement_hub_ref, qty, supplier_sku)
       VALUES ($1, NULL, $2, $3, $4, 'manual', 'DXB', NULL, NULL)`,
      [poId, supplier, km, status]
    );
    created.po.push(poId);
    return poId;
  }

  const attach = (shipment, unit) => pool.query(
    'INSERT INTO international_shipment_hub_units(shipment_id, physical_unit_id, attached_by) VALUES ($1, $2, $3)',
    [shipment, unit, user]
  );

  beforeAll(async () => {
    km = (await pool.query("SELECT id FROM markets WHERE code='KM'")).rows[0].id;
    cm = (await pool.query("SELECT id FROM markets WHERE code='CM'")).rows[0].id;
    user = id();
    supplier = id();
    await pool.query(
      "INSERT INTO users(id, full_name, email, phone, role) VALUES ($1, 'H358 Admin', $2, $3, 'admin')",
      [user, `${tag.toLowerCase()}@komerce.test`, `+2693${String(Date.now()).slice(-7)}`]
    );
    await pool.query(
      "INSERT INTO suppliers(id, name, platform, is_active) VALUES ($1, $2, 'local', true)",
      [supplier, `Fournisseur ${tag}`]
    );
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await client.query("SET session_replication_role = 'replica'");
      if (created.shipments.length) {
        await client.query('DELETE FROM international_shipment_hub_units WHERE shipment_id = ANY($1::uuid[])', [created.shipments]);
        await client.query('DELETE FROM international_shipments WHERE id = ANY($1::uuid[])', [created.shipments]);
      }
      if (created.units.length) await client.query('DELETE FROM hub_physical_units WHERE id = ANY($1::uuid[])', [created.units]);
      if (created.po.length) await client.query('DELETE FROM purchase_orders WHERE id = ANY($1::uuid[])', [created.po]);
      await client.query('DELETE FROM suppliers WHERE id = $1', [supplier]);
      await client.query('DELETE FROM users WHERE id = $1', [user]);
    } finally {
      await client.query("SET session_replication_role = 'origin'");
      client.release();
      await pool.end();
    }
  });

  describe('preuve d\'envoi de PO', () => {
    test('nominal : une PO soumise enregistre son envoi réel', async () => {
      const po = await makePo('notified');
      await pool.query(
        "UPDATE purchase_orders SET sent_at = NOW(), sent_channel = 'whatsapp', sent_by = $2 WHERE id = $1",
        [po, user]
      );
      const { rows: [row] } = await pool.query('SELECT sent_at, sent_channel, sent_by FROM purchase_orders WHERE id = $1', [po]);
      expect(row.sent_channel).toBe('whatsapp');
      expect(row.sent_at).toBeInstanceOf(Date);
      expect(row.sent_by).toBe(user);
    });

    test('refus : un brouillon ne peut pas être envoyé', async () => {
      const po = await makePo('draft');
      await rejects(
        pool.query("UPDATE purchase_orders SET sent_at = NOW(), sent_channel = 'email' WHERE id = $1", [po]),
        'purchase_order_sent_requires_submitted'
      );
    });

    test('refus : canal inconnu', async () => {
      const po = await makePo('notified');
      await rejects(
        pool.query("UPDATE purchase_orders SET sent_at = NOW(), sent_channel = 'pigeon' WHERE id = $1", [po]),
        'chk_purchase_orders_sent_proof'
      );
    });

    test('refus : un envoi sans canal', async () => {
      const po = await makePo('notified');
      await rejects(
        pool.query('UPDATE purchase_orders SET sent_at = NOW() WHERE id = $1', [po]),
        'chk_purchase_orders_sent_proof'
      );
    });

    test('refus : la preuve d\'envoi est immuable (canal et date)', async () => {
      const po = await makePo('notified');
      await pool.query("UPDATE purchase_orders SET sent_at = NOW(), sent_channel = 'phone' WHERE id = $1", [po]);
      await rejects(
        pool.query("UPDATE purchase_orders SET sent_channel = 'email' WHERE id = $1", [po]),
        'purchase_order_sent_proof_immutable'
      );
      await rejects(
        pool.query("UPDATE purchase_orders SET sent_at = NOW() + interval '1 day' WHERE id = $1", [po]),
        'purchase_order_sent_proof_immutable'
      );
    });
  });

  describe('carton KOM-BOX → expédition', () => {
    test('nominal : un carton emballé rejoint une expédition du même marché', async () => {
      const unit = await makeUnit({ market: km });
      const shipment = await makeShipment({ market: km });
      await attach(shipment, unit);
      const { rows } = await pool.query('SELECT 1 FROM international_shipment_hub_units WHERE physical_unit_id = $1', [unit]);
      expect(rows).toHaveLength(1);
    });

    test('refus inter-marchés : carton CM vers expédition KM', async () => {
      const unit = await makeUnit({ market: cm });
      const shipment = await makeShipment({ market: km });
      await rejects(attach(shipment, unit), 'hub_box_shipment_market_mismatch');
    });

    test('refus : unité qui n\'est pas un carton marché', async () => {
      const unit = await makeUnit({ market: km, type: 'SUPPLIER_PACKAGE', state: 'RECEIVED' });
      const shipment = await makeShipment({ market: km });
      await rejects(attach(shipment, unit), 'hub_box_shipment_requires_market_parcel');
    });

    test('refus : carton non emballé', async () => {
      const unit = await makeUnit({ market: km, state: 'PICKED' });
      const shipment = await makeShipment({ market: km });
      await rejects(attach(shipment, unit), 'hub_box_shipment_requires_packed_box');
    });

    test('refus : expédition déjà remise au transitaire', async () => {
      const unit = await makeUnit({ market: km });
      const shipment = await makeShipment({ market: km, stage: 'handed_over' });
      await rejects(attach(shipment, unit), 'hub_box_shipment_closed');
    });

    test('refus : un carton ne rejoint pas deux expéditions', async () => {
      const unit = await makeUnit({ market: km });
      const first = await makeShipment({ market: km });
      const second = await makeShipment({ market: km });
      await attach(first, unit);
      await rejects(attach(second, unit), 'uq_international_shipment_hub_unit');
    });

    test('concurrence : deux rattachements simultanés du même carton, un seul gagne', async () => {
      const unit = await makeUnit({ market: km });
      const first = await makeShipment({ market: km });
      const second = await makeShipment({ market: km });
      const results = await Promise.allSettled([attach(first, unit), attach(second, unit)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      const { rows } = await pool.query('SELECT 1 FROM international_shipment_hub_units WHERE physical_unit_id = $1', [unit]);
      expect(rows).toHaveLength(1);
    });

    test('refus : le lien est immuable ; détachement permis seulement avant la remise', async () => {
      const unit = await makeUnit({ market: km });
      const other = await makeShipment({ market: km });
      const shipment = await makeShipment({ market: km });
      await attach(shipment, unit);
      await rejects(
        pool.query('UPDATE international_shipment_hub_units SET shipment_id = $1 WHERE physical_unit_id = $2', [other, unit]),
        'hub_box_shipment_link_immutable'
      );
      await pool.query("UPDATE international_shipments SET stage = 'handed_over' WHERE id = $1", [shipment]);
      await rejects(
        pool.query('DELETE FROM international_shipment_hub_units WHERE physical_unit_id = $1', [unit]),
        'hub_box_shipment_detach_after_handover'
      );
    });

    test('nominal : détachement avant la remise', async () => {
      const unit = await makeUnit({ market: km });
      const shipment = await makeShipment({ market: km });
      await attach(shipment, unit);
      await pool.query('DELETE FROM international_shipment_hub_units WHERE physical_unit_id = $1', [unit]);
      const { rows } = await pool.query('SELECT 1 FROM international_shipment_hub_units WHERE physical_unit_id = $1', [unit]);
      expect(rows).toHaveLength(0);
    });
  });
});
