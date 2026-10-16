'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * tests/integration/customs-margin-truth-real-db.test.js
 *
 * Feature propriétaire : economic-engine
 *
 * PR2a — vérité des coûts douane sur vraie base :
 *  - finance-summary n'assimile jamais « douane inconnue » à un coût nul ;
 *  - métriques physiques par colis sans duplication (commande multi-colis) ;
 *  - by_volume par défaut au maritime (méthode explicite respectée).
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('CUSTOMS MARGIN TRUTH — REAL_DB proofs — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const svc = require('../../services/customs-shipment-service');
  const { getFinanceSummary } = require('../../services/finance-metrics/finance-summary');

  jest.setTimeout(30000);

  const RUN_TAG = `e2e_test_custtruth_${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
  const orderIds = [];
  const parcelIds = [];
  const productIds = [];
  const shipmentIds = [];
  let relaisId; let marketId; let seq = 0;

  async function seedOrder({ parcels, itemQty = 4, totalKmf = 80000, weightKg = 2, volumeCm3 = 1000, withParcelItems = null }) {
    seq += 1;
    const orderId = crypto.randomUUID();
    const productId = crypto.randomUUID();
    const orderItemId = crypto.randomUUID();
    orderIds.push(orderId); productIds.push(productId);
    await db.query(
      `INSERT INTO products (id, name, price_kmf, stock, weight_kg, volume_cm3, cost_kmf)
       VALUES ($1, $2, 20000, 100, $3, $4, 10000)`,
      [productId, `E2E Truth Produit ${RUN_TAG}-${seq}`, weightKg, volumeCm3]);
    await db.query(
      `INSERT INTO orders (id, reference, user_id, relais_id, market_id, total_kmf, payment_mode, payment_status, status)
       VALUES ($1, $2, NULL, $3, $4, $5, 'cash_relais', 'paid', 'confirmed')`,
      [orderId, `${RUN_TAG}-order-${seq}`, relaisId, marketId, totalKmf]);
    if (!withParcelItems) {
      await db.query(
        `INSERT INTO order_items (id, order_id, product_id, quantity, price_kmf) VALUES ($1,$2,$3,$4,20000)`,
        [orderItemId, orderId, productId, itemQty]);
    }
    const ids = [];
    for (let i = 0; i < parcels; i++) {
      const parcelId = crypto.randomUUID();
      parcelIds.push(parcelId); ids.push(parcelId);
      await db.query(`INSERT INTO parcels (id, order_id, reference, status) VALUES ($1,$2,$3,'in_transit')`,
        [parcelId, orderId, `${RUN_TAG}-parcel-${seq}-${i}`]);
      if (withParcelItems) {
        // un order_item par colis (unicité order_item/colis)
        const itemId = crypto.randomUUID();
        await db.query(
          `INSERT INTO order_items (id, order_id, product_id, quantity, price_kmf) VALUES ($1,$2,$3,$4,20000)`,
          [itemId, orderId, productId, withParcelItems[i]]);
        await db.query(
          `INSERT INTO parcel_items (id, parcel_id, order_item_id, product_id, quantity, qty_allocated)
           VALUES ($1,$2,$3,$4,$5,$5)`,
          [crypto.randomUUID(), parcelId, itemId, productId, withParcelItems[i]]);
      }
    }
    return { orderId, parcelIds: ids };
  }

  const ship = async (body) => {
    seq += 1;
    const r = await svc.createShipment(db, {
      reference: `${RUN_TAG}-ship-${seq}`, shipment_date: '2026-01-01', cif_value_kmf: 100000, ...body,
    }, null, {marketId});
    shipmentIds.push(r.shipment.id);
    return r;
  };
  const cspRows = async (shipmentId) => (await db.query(
    `SELECT parcel_id, parcel_cif_kmf, parcel_weight_kg, parcel_volume_cm3, customs_share_kmf
       FROM customs_shipment_parcels WHERE shipment_id = $1 ORDER BY parcel_id`, [shipmentId])).rows;
  const sum = (rows, k) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);

  beforeAll(async () => {
    const { rows: [m] } = await db.query(`SELECT id FROM markets WHERE code = 'KM'`);
    marketId = m.id;
    relaisId = crypto.randomUUID();
    await db.query(
      `INSERT INTO relais (id, name, agent_name, phone, address, island, market_id)
       VALUES ($1, $2, 'E2E Agent', '+269000111', 'Moroni Test', 'Ngazidja', $3)`,
      [relaisId, `E2E Truth Relais ${RUN_TAG}`, marketId]);
  });

  afterAll(async () => {
    if (shipmentIds.length) {
      await db.query('DELETE FROM order_item_real_cost_allocations WHERE shipment_id = ANY($1::uuid[])', [shipmentIds]).catch(() => {});
      await db.query('DELETE FROM customs_shipment_parcels WHERE shipment_id = ANY($1::uuid[])', [shipmentIds]).catch(() => {});
      await db.query('DELETE FROM customs_shipments WHERE id = ANY($1::uuid[])', [shipmentIds]).catch(() => {});
    }
    if (parcelIds.length) {
      await db.query('DELETE FROM parcel_items WHERE parcel_id = ANY($1::uuid[])', [parcelIds]).catch(() => {});
      await db.query('SET session_replication_role = replica').catch(() => {});
      await db.query('DELETE FROM parcels WHERE id = ANY($1::uuid[])', [parcelIds]).catch(() => {});
      await db.query('SET session_replication_role = origin').catch(() => {});
    }
    if (orderIds.length) {
      await db.query('DELETE FROM order_items WHERE order_id = ANY($1::uuid[])', [orderIds]).catch(() => {});
      await db.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [orderIds]).catch(() => {});
    }
    if (productIds.length) await db.query('DELETE FROM products WHERE id = ANY($1::uuid[])', [productIds]).catch(() => {});
    if (relaisId) await db.query('DELETE FROM relais WHERE id = $1', [relaisId]).catch(() => {});
  });

  describe('PR2a — vérité des coûts douane (REAL_DB)', () => {
    it('T3a — commande à 2 colis sans métriques : somme = métriques commande, parts égales, conservation au centime', async () => {
      const { parcelIds: ps } = await seedOrder({ parcels: 2 });
      const { shipment } = await ship({ transport_mode: 'sea', customs_paid_kmf: 100001, parcel_ids: ps });
      const rows = await cspRows(shipment.id);
      expect(rows).toHaveLength(2);
      expect(sum(rows, 'parcel_cif_kmf')).toBe(80000);          // total_kmf, pas 2x
      expect(sum(rows, 'parcel_weight_kg')).toBeCloseTo(8, 5);  // 4 x 2 kg
      expect(sum(rows, 'parcel_volume_cm3')).toBeCloseTo(4000, 5);
      expect(Number(rows[0].parcel_cif_kmf)).toBe(Number(rows[1].parcel_cif_kmf));
      expect(Math.round(sum(rows, 'customs_share_kmf') * 100)).toBe(10000100);
    });

    it('T3b — colis avec parcel_items : métriques = quantité du colis x produit', async () => {
      const { parcelIds: ps } = await seedOrder({ parcels: 2, withParcelItems: [1, 3] });
      const { shipment } = await ship({ transport_mode: 'sea', customs_paid_kmf: 5000, parcel_ids: ps });
      const rows = await cspRows(shipment.id);
      const byParcel = Object.fromEntries(rows.map(r => [r.parcel_id, r]));
      expect(Number(byParcel[ps[0]].parcel_cif_kmf)).toBe(20000);
      expect(Number(byParcel[ps[1]].parcel_cif_kmf)).toBe(60000);
      expect(Number(byParcel[ps[0]].parcel_weight_kg)).toBeCloseTo(2, 5);
      expect(Number(byParcel[ps[1]].parcel_weight_kg)).toBeCloseTo(6, 5);
      expect(Number(byParcel[ps[1]].parcel_volume_cm3)).toBeCloseTo(3000, 5);
      expect(Math.round(sum(rows, 'customs_share_kmf') * 100)).toBe(500000);
    });

    it('T3c — commande à un seul colis : comportement historique (métriques de la commande)', async () => {
      const { parcelIds: ps } = await seedOrder({ parcels: 1 });
      const { shipment } = await ship({ transport_mode: 'air', customs_paid_kmf: 1234, parcel_ids: ps });
      const [r] = await cspRows(shipment.id);
      expect(Number(r.parcel_cif_kmf)).toBe(80000);
      expect(Number(r.parcel_weight_kg)).toBeCloseTo(8, 5);
      expect(Number(r.parcel_volume_cm3)).toBeCloseTo(4000, 5);
    });

    it('T4 — by_volume par défaut au maritime ; explicite respecté ; air inchangé ; volume nul sans perte', async () => {
      const sea = await ship({ transport_mode: 'sea' });
      expect(sea.shipment.allocation_method).toBe('by_volume');
      const explicit = await ship({ transport_mode: 'sea', allocation_method: 'by_cif_value' });
      expect(explicit.shipment.allocation_method).toBe('by_cif_value');
      const air = await ship({ transport_mode: 'air' });
      expect(air.shipment.allocation_method).toBe('by_cif_value');

      // volume total 0 : conservation #2554 + repli tracé
      const { parcelIds: ps } = await seedOrder({ parcels: 2, volumeCm3: 0 });
      const { shipment } = await ship({ transport_mode: 'sea', customs_paid_kmf: 7001, parcel_ids: ps });
      expect(shipment.allocation_method).toBe('by_volume');
      const rows = await cspRows(shipment.id);
      expect(Math.round(sum(rows, 'customs_share_kmf') * 100)).toBe(700100);
      const { rows: [b] } = await db.query(
        `SELECT DISTINCT allocation_basis FROM customs_shipment_parcels WHERE shipment_id = $1`, [shipment.id]);
      expect(b.allocation_basis).toBe('by_volume:equal_fallback');
    });

    it('T2 — finance-summary : transport>0 + expédition pending => exclue des coûts/marge, comptée inconnue ; déclarée => comptée', async () => {
      const { orderId, parcelIds: ps } = await seedOrder({ parcels: 1, totalKmf: 50000 });
      await db.query(`UPDATE orders SET cost_transport_kmf = 3000 WHERE id = $1`, [orderId]);
      const before = (await getFinanceSummary({ period: '365' })).marges;

      const { shipment } = await ship({ transport_mode: 'sea' });
      await db.query(`INSERT INTO customs_shipment_parcels (shipment_id, parcel_id) VALUES ($1,$2)`, [shipment.id, ps[0]]);

      const pending = (await getFinanceSummary({ period: '365' })).marges;
      // la commande (transport 3000, douane 0 par défaut) était comptée AVANT le rattachement ; maintenant exclue
      expect(pending.nb_douane_inconnue).toBe(before.nb_douane_inconnue + 1);
      expect(pending.cout_logistique_kmf).toBe(before.cout_logistique_kmf - 3000);
      expect(pending.marge_reelle_kmf).toBe(before.marge_reelle_kmf - 47000);
      expect(pending.nb_avec_cost).toBe(before.nb_avec_cost - 1);

      await svc.declareCustomsPayment(db, shipment.id, { customs_paid_kmf: 1000 }, null);
      const declared = (await getFinanceSummary({ period: '365' })).marges;
      expect(declared.nb_douane_inconnue).toBe(before.nb_douane_inconnue);
      expect(declared.cout_logistique_kmf).toBe(before.cout_logistique_kmf + 1000);
    });
  });
}
