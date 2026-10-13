'use strict';
/**
 * @test-kind e2e-api
 * @test-runner jest
 * @test-requires postgres
 */
// Le Hub organise librement ses colis : la preuve Golden suit les LIGNES (order_items ↔ parcel_items) et leurs
// quantités, jamais parcels.order_id. Niveau L4 (vraie base PostgreSQL), aucune donnée staging.
const db = require('../../db');
const { describeE2E, createCleanup, uuid } = require('../helpers/e2eDbKit');
const { createGoldenJourney } = require('../helpers/goldenJourneySetup');
const { advanceGoldenJourney } = require('../helpers/goldenJourney');
const { projectGoldenEvidence } = require('../../services/golden-e2e-cockpit');

const step = (projection, key) => projection.steps.find((s) => s.key === key);
const project = async (orderId) => projectGoldenEvidence(db, (await db.query('SELECT id, reference, status, payment_status FROM orders WHERE id = $1', [orderId])).rows[0]);

describeE2E('Golden — preuves physiques par unités (colis libres)', () => {
  const cleanup = createCleanup(db);
  afterAll(async () => cleanup.run());

  async function journeyUpToRelay() {
    const x = await createGoldenJourney(db, { marketCode: 'KM' });
    const y = await createGoldenJourney(db, { marketCode: 'KM' });
    for (const j of [x, y]) cleanup.trackSql(`UPDATE orders SET status='cancelled', updated_at=NOW() WHERE id=$1`, [j.orderId]);
    // CUSTOMS puis RELAY_AVAILABLE de la commande X
    for (let i = 0; i < 3; i += 1) await advanceGoldenJourney(db, x.reference);
    const parcel = (await db.query('SELECT id, relais_id FROM parcels WHERE order_id = $1 ORDER BY created_at LIMIT 1', [x.orderId])).rows[0];
    return { x, y, parcel };
  }

  test('colis rattaché à une autre commande par parcels.order_id mais lié par ses lignes : preuve retrouvée', async () => {
    const { x, y, parcel } = await journeyUpToRelay();
    const before = await project(x.orderId);
    expect(step(before, 'CUSTOMS').passed).toBe(true);
    expect(step(before, 'RELAY_AVAILABLE').passed).toBe(true);

    // Le Hub regroupe : le colis est désormais « porté » par la commande Y, il contient toujours la ligne de X.
    await db.query('UPDATE parcels SET order_id = $2 WHERE id = $1', [parcel.id, y.orderId]);
    const grouped = await project(x.orderId);
    expect(step(grouped, 'CUSTOMS')).toMatchObject({ passed: true });
    expect(step(grouped, 'RELAY_AVAILABLE')).toMatchObject({ passed: true });
    expect(step(grouped, 'RELAY_AVAILABLE').evidence).toMatch(/1 colis · 1 unité/);
  });

  test('réaffectation vers un colis non disponible : la preuve de X ne survit pas, sans passer par parcels.order_id', async () => {
    const { x, y, parcel } = await journeyUpToRelay();
    const ref = `E2E-GRP-${uuid().slice(0, 8)}`;
    const q = (await db.query(`INSERT INTO parcels(order_id, relais_id, reference, status) VALUES ($1,$2,$3,'in_transit') RETURNING id`, [y.orderId, parcel.relais_id, ref])).rows[0];
    cleanup.trackSql('DELETE FROM parcel_items WHERE parcel_id = $1', [q.id]);
    const itemId = (await db.query('SELECT id FROM order_items WHERE order_id = $1', [x.orderId])).rows[0].id;
    await db.query('UPDATE parcel_items SET parcel_id = $2 WHERE order_item_id = $1', [itemId, q.id]);
    const moved = await project(x.orderId);
    expect(step(moved, 'RELAY_AVAILABLE').passed).toBe(false);
    expect(step(moved, 'CUSTOMS').passed).toBe(false);
  });

  test('quantité partiellement reçue au relais ou allocation incomplète : jamais de preuve complète', async () => {
    const { x } = await journeyUpToRelay();
    await db.query('UPDATE parcel_items pi SET quantity = pi.quantity + 1 FROM order_items oi WHERE oi.id = pi.order_item_id AND oi.order_id = $1', [x.orderId]);
    const over = await project(x.orderId);
    expect(step(over, 'RELAY_AVAILABLE')).toMatchObject({ passed: false });
    expect(step(over, 'RELAY_AVAILABLE').evidence).toContain('NON_PROUVE:QUANTITY_OVER_ALLOCATED');
    await db.query('UPDATE parcel_items pi SET quantity = 1, qty_received = 0 FROM order_items oi WHERE oi.id = pi.order_item_id AND oi.order_id = $1', [x.orderId]);
    await db.query('UPDATE order_items SET quantity = quantity + 1 WHERE order_id = $1', [x.orderId]);
    const partial = await project(x.orderId);
    expect(step(partial, 'RELAY_AVAILABLE').evidence).toContain('QUANTITY_NOT_FULLY_ALLOCATED');
  });
});
