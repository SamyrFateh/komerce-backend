'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration auto-parcel-cleanup-postgres.test.js
 * @brief cleanupGhostParcels : annulation (jamais DELETE) des seuls colis Auto-% vides de plus de 24 h sans preuve ; POST /auto-distribute sans 500.
 */
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'test', role: 'admin' }; next(); },
  requireRole: () => (_req, _res, next) => next(),
}));

const db = require('../../db');
const { assertTestDatabase } = require('../helpers/e2eDbKit');
const autoParcel = require('../../services/auto-parcel');
const router = require('../../routes/auto-distribute-api');

jest.setTimeout(60000);
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const q = (sql, args) => db.query(sql, args);
const run = crypto.randomBytes(4).toString('hex');

describeDb('cleanupGhostParcels — annulation ciblée (PG16 jetable)', () => {
  let marketId; let orderId; let relaisId; let userId; let n = 0;
  const ids = {};
  const refOf = () => `KOM-P-2026-${String(700000 + (parseInt(run.slice(0, 4), 16) % 20000) * 10 + (n += 1))}`;
  const parcel = async (key, { label, age = '48 hours', status = 'preparation' }) => {
    const id = crypto.randomUUID(); ids[key] = id;
    await q(`INSERT INTO parcels(id,order_id,relais_id,reference,status,type,label,created_at)
             VALUES ($1,$2,$3,$4,$5::parcel_status,'standard',$6,NOW() - $7::interval)`, [id, orderId, relaisId, refOf(), status, label, age]);
    return id;
  };
  const statusOf = async (key) => (await q('SELECT status::text AS s, cancel_reason FROM parcels WHERE id=$1', [ids[key]])).rows[0];

  beforeAll(async () => {
    assertTestDatabase();
    if (!['localhost', '127.0.0.1', '::1'].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error('CLEANUP_TEST_LOCAL_POSTGRES_ONLY');
    ({ rows: [{ id: marketId }] } = await q("SELECT id FROM markets WHERE code='KM' LIMIT 1"));
    userId = crypto.randomUUID(); orderId = crypto.randomUUID(); relaisId = crypto.randomUUID();
    await q("INSERT INTO users(id,full_name,email,phone,role) VALUES ($1,$2,$3,$4,'client')", [userId, `Cleanup ${run}`, `cleanup-${run}@komerce.test`, `+2697${parseInt(run.slice(0, 6), 16) % 10000000}`.slice(0, 12)]);
    await q("INSERT INTO relais(id,name,phone,address,market_id,island,island_code,is_active) VALUES ($1,$2,$3,'Moroni',$4,'Grande Comore','MORONI',TRUE)", [relaisId, `Relais cleanup ${run}`, `+2696${parseInt(run.slice(2, 7), 16) % 1000000}`.slice(0, 12), marketId]);
    await q("INSERT INTO orders(id,reference,user_id,relais_id,total_kmf,payment_mode,market_id,status,payment_status) VALUES ($1,$2,$3,$4,1000,(SELECT (enum_range(NULL::payment_mode))[1]),$5,'preparation','paid')", [orderId, `CLN-${run}`, userId, relaisId, marketId]);
    await parcel('manual', { label: 'Colis manuel en préparation' });
    await parcel('manualDraft', { label: 'Manuel brouillon', status: 'draft' });
    await parcel('autoRecent', { label: 'Auto-MORONI', age: '2 hours' });
    await parcel('autoOld', { label: 'Auto-MORONI' });
    await parcel('autoScan', { label: 'Auto-MORONI' });
    await parcel('autoShipped', { label: 'Auto-MORONI', status: 'shipped' });
    await q("INSERT INTO scan_events(parcel_id,event_type) VALUES ($1,'test_proof')", [ids.autoScan]);
  });
  afterAll(async () => { await db.pool.end().catch(() => {}); });

  test('seul le colis Auto-% vide, ancien et sans preuve est annulé (jamais de DELETE) ; idempotent', async () => {
    const first = await autoParcel.cleanupGhostParcels();
    expect(first.references).toContain((await q('SELECT reference FROM parcels WHERE id=$1', [ids.autoOld])).rows[0].reference);
    expect(first.cancelled).toBe(first.references.length);
    expect(await statusOf('autoOld')).toEqual({ s: 'cancelled', cancel_reason: 'ghost_auto_parcel_cleanup' });
    expect((await statusOf('manual')).s).toBe('preparation'); // colis manuel vide en préparation : jamais touché
    expect((await statusOf('manualDraft')).s).toBe('draft');
    expect((await statusOf('autoRecent')).s).toBe('preparation'); // < 24 h
    expect((await statusOf('autoScan')).s).toBe('preparation'); // scan_events
    // hub_box_bags : exclusion portée par le même NOT EXISTS (preuve de la clause dans le test unitaire) ; le lien exige
    // une chaîne sac/boîte complète (HUB_BOX_BAG_NOT_PACKED), non fabriquable ici sans contourner le garde.
    expect((await statusOf('autoShipped')).s).toBe('shipped');
    const { rows } = await q('SELECT count(*)::int AS n FROM parcels WHERE id = ANY($1)', [Object.values(ids)]);
    expect(rows[0].n).toBe(Object.keys(ids).length); // aucune ligne supprimée
    const second = await autoParcel.cleanupGhostParcels();
    expect(second).toEqual({ cancelled: 0, references: [] });
  });

  test('POST /auto-distribute et /cleanup ne renvoient plus 500 en présence de candidats', async () => {
    await parcel('autoOld2', { label: 'Auto-MORONI', age: '3 days' });
    const app = express(); app.use(express.json()); app.use('/api/hub', router);
    const res = await request(app).post('/api/hub/auto-distribute');
    expect(res.status).toBe(200);
    expect(res.body.cleanup.cancelled).toBeGreaterThanOrEqual(1);
    expect(res.body.message).toMatch(/\d+ colis fantômes annulés/);
    expect((await statusOf('autoOld2')).s).toBe('cancelled');
    const again = await request(app).post('/api/hub/auto-distribute/cleanup');
    expect(again.status).toBe(200);
    expect(again.body.cancelled).toBe(0);
  });
});
