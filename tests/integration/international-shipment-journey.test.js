'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/** G6-E : une expédition internationale dont le dossier douane est retenu ne change pas d'étape (mainlevée requise). */
if (!process.env.DATABASE_URL) {
  describe.skip('JOURNEY CUSTOMS HOLD — REAL_DB — SKIPPED: no DATABASE_URL', () => { it('requires DATABASE_URL', () => {}); });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const journey = require('../../services/international-shipment-journey');
  const ws = require('../../services/shipping-customs-workspace');

  jest.setTimeout(20000);
  const TAG = `e2e_test_jhold_${Date.now().toString(36)}`;
  let market; let userId; const csId = crypto.randomUUID(); let isRef;

  beforeAll(async () => {
    ({ rows: [market] } = await db.query(`SELECT id, code, name, currency, lifecycle_status FROM markets WHERE code='KM'`));
    ({ rows: [{ id: userId }] } = await db.query(`INSERT INTO users (full_name) VALUES ($1) RETURNING id`, [TAG]));
    await db.query(`INSERT INTO customs_shipments (id, reference, shipment_date, transport_mode, cif_value_kmf, allocation_method, status, market_id)
                    VALUES ($1,$2,CURRENT_DATE,'sea',1000,'by_cif_value','pending',$3)`, [csId, `${TAG}-C`, market.id]);
    isRef = `${TAG}-I`;
    await db.query(`INSERT INTO international_shipments (market_id, reference, created_by, customs_shipment_id) VALUES ($1,$2,$3,$4)`, [market.id, isRef, userId, csId]);
  });
  afterAll(async () => {
    await db.query('DELETE FROM international_shipment_events WHERE shipment_id IN (SELECT id FROM international_shipments WHERE reference=$1)', [isRef]).catch(() => {});
    await db.query('DELETE FROM international_shipments WHERE reference=$1', [isRef]);
    await db.query('DELETE FROM customs_shipment_holds WHERE shipment_id=$1', [csId]);
    await db.query('DELETE FROM customs_shipments WHERE id=$1', [csId]);
    await db.query('DELETE FROM users WHERE id=$1', [userId]).catch(() => {});
    await db.pool.end();
  });

  it('refuse toute transition tant que le dossier est retenu, puis ne bloque plus après mainlevée', async () => {
    await ws.holdCustomsShipment(`${TAG}-C`, { reason: 'Contrôle douanier' }, market, { id: userId, role: 'admin' });
    const body = { to_stage: 'forwarder_received', proof_ref: 'preuve-1' };
    const actor = { id: userId, role: 'admin' };
    await expect(journey.transition(market, actor, isRef, body)).rejects.toMatchObject({ code: 'JOURNEY_CUSTOMS_HELD', status: 409 });
    await ws.releaseCustomsShipment(`${TAG}-C`, {}, market, { id: userId, role: 'market_operator' });
    const after = await journey.transition(market, actor, isRef, body).catch(e => e);
    expect(after && after.code).not.toBe('JOURNEY_CUSTOMS_HELD');
  });
}
