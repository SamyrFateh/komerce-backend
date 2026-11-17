'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * G6-E : état « retenu en douane » sur vraie base. Motif obligatoire, une seule retenue active,
 * mainlevée réservée (service) au responsable marché ou à l'admin, refus du transitaire,
 * déclaration douane bloquée tant que retenu, rejouable après mainlevée.
 */

if (!process.env.DATABASE_URL) {
  describe.skip('CUSTOMS HOLD — REAL_DB — SKIPPED: no DATABASE_URL', () => { it('requires DATABASE_URL', () => {}); });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const ws = require('../../services/shipping-customs-workspace');
  const customs = require('../../services/customs-shipment-service');

  jest.setTimeout(20000);
  const TAG = `e2e_test_hold_${Date.now().toString(36)}`;
  let market; let otherMarket; let userId; let shipmentId; let reference;

  beforeAll(async () => {
    const { rows } = await db.query(`SELECT id, code, name, currency, lifecycle_status FROM markets WHERE code IN ('KM','CM') ORDER BY code`);
    otherMarket = rows.find(r => r.code === 'CM'); market = rows.find(r => r.code === 'KM');
    ({ rows: [{ id: userId }] } = await db.query(`INSERT INTO users (full_name) VALUES ($1) RETURNING id`, [TAG]));
    shipmentId = crypto.randomUUID(); reference = `${TAG}-1`;
    await db.query(
      `INSERT INTO customs_shipments (id, reference, shipment_date, transport_mode, cif_value_kmf, allocation_method, status, market_id)
       VALUES ($1,$2,CURRENT_DATE,'sea',30000,'by_cif_value','pending',$3)`, [shipmentId, reference, market.id]);
  });
  afterAll(async () => {
    await db.query('DELETE FROM customs_shipment_holds WHERE shipment_id = $1', [shipmentId]);
    await db.query('DELETE FROM customs_shipments WHERE id = $1', [shipmentId]);
    await db.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
    await db.pool.end();
  });

  const as = role => ({ id: userId, role });

  it('refuse un motif vide et un rôle hors habilitation', async () => {
    await expect(ws.holdCustomsShipment(reference, { reason: ' ' }, market, as('agent_transitaire'))).rejects.toMatchObject({ code: 'customs_hold_reason_required' });
    await expect(ws.holdCustomsShipment(reference, { reason: 'inspection' }, market, as('customer'))).rejects.toMatchObject({ code: 'customs_hold_role_forbidden' });
  });

  it('le transitaire retient ; double retenue refusée ; marché étranger introuvable', async () => {
    const r = await ws.holdCustomsShipment(reference, { reason: 'Inspection scanner port' }, market, as('agent_transitaire'));
    expect(r.customs_held).toBe(true);
    await expect(ws.holdCustomsShipment(reference, { reason: 'encore' }, market, as('admin'))).rejects.toMatchObject({ code: 'customs_already_held' });
    await expect(ws.holdCustomsShipment(reference, { reason: 'autre marché' }, otherMarket, as('admin'))).rejects.toMatchObject({ code: 'customs_shipment_not_found' });
  });

  it('déclaration douane bloquée tant que retenu (service canonique et workspace)', async () => {
    await expect(customs.declareCustomsPayment(db, shipmentId, { customs_paid_kmf: 1000 }, userId)).rejects.toMatchObject({ status: 409 });
    await expect(ws.declareCustomsShipment(reference, { customs_paid_kmf: 1000 }, market, as('admin'))).rejects.toMatchObject({ code: 'customs_held' });
  });

  it('transitaire et autre marché refusés à la mainlevée ; responsable marché libère', async () => {
    await expect(ws.releaseCustomsShipment(reference, {}, market, as('agent_transitaire'))).rejects.toMatchObject({ code: 'customs_release_role_forbidden' });
    await expect(ws.releaseCustomsShipment(reference, {}, otherMarket, as('market_operator'))).rejects.toMatchObject({ code: 'customs_shipment_not_found' });
    const r = await ws.releaseCustomsShipment(reference, { note: 'Mainlevée reçue' }, market, as('market_operator'));
    expect(r.customs_held).toBe(false);
    await expect(ws.releaseCustomsShipment(reference, {}, market, as('admin'))).rejects.toMatchObject({ code: 'customs_not_held' });
    const { rows } = await db.query(`SELECT status, released_by_role FROM customs_shipment_holds WHERE shipment_id=$1`, [shipmentId]);
    expect(rows).toEqual([{ status: 'released', released_by_role: 'market_operator' }]);
  });

  it('après mainlevée la déclaration redevient possible', async () => {
    const out = await customs.declareCustomsPayment(db, shipmentId, { customs_paid_kmf: 0 }, userId).catch(e => e);
    expect(String(out && out.message)).not.toMatch(/retenu/);
  });
}
