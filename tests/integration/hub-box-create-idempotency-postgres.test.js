'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration hub-box-create-idempotency-postgres.test.js
 * @brief #3900 A2 — POST /market/:code/boxes idempotent par Idempotency-Key : rejeu séquentiel et simultané = une seule KOM-BOX ; même clé + contenu différent = 409 ; clé absente = 400.
 */
jest.setTimeout(60000);

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = global.__a2User; next(); },
  requireRole: () => (req, res, next) => next(),
}));
jest.mock('../../middleware/require-dashboard-global-authority', () => ({
  hasDashboardGlobalAuthority: jest.fn(async () => true),
}));
jest.mock('../../services/market-delegation-service', () => ({
  resolveAuthorization: jest.fn(async (_db, { marketCode }) => ({
    market_id: global.__a2Market.id, market_code: marketCode, assignment_id: null, membership_id: null,
  })),
  audit: jest.fn(async () => undefined),
}));

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const db = require('../../db');

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const q = (sql, params) => db.query(sql, params);
const tag = 'A2BOX-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');

describeDb('A2 — POST /boxes idempotent (PG réel)', () => {
  let app;
  const post = (key, body = {}) => {
    const r = request(app).post('/api/admin/workspaces/operations/market/KM/boxes');
    if (key !== undefined) r.set('Idempotency-Key', key);
    return r.send(body);
  };
  const boxCount = async (ref = null) => (await q(
    "SELECT count(*)::int AS n FROM hub_physical_units WHERE unit_type='MARKET_PARCEL' AND created_by=$1" + (ref ? ' AND reference=$2' : ''),
    ref ? [global.__a2User.id, ref] : [global.__a2User.id])).rows[0].n;

  beforeAll(async () => {
    const host = new URL(process.env.DATABASE_URL).hostname;
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('A2_TEST_LOCAL_POSTGRES_ONLY');
    global.__a2Market = (await q("SELECT id, code FROM markets WHERE code='KM'")).rows[0];
    const userId = crypto.randomUUID();
    await q("INSERT INTO users(id,full_name,email,phone,role) VALUES($1,'A2 Admin',$2,$3,'admin')",
      [userId, tag.toLowerCase() + '@komerce.test', '+2693' + String(Date.now()).slice(-7)]);
    global.__a2User = { id: userId, role: 'admin', full_name: 'A2 Admin', email: tag.toLowerCase() + '@komerce.test' };
    app = express();
    app.use(express.json());
    app.use('/api/admin/workspaces/operations', require('../../routes/admin-operations-workspace'));
  });
  afterAll(async () => { await db.pool.end().catch(() => {}); });

  test('clé absente : 400, aucune KOM-BOX créée', async () => {
    const res = await post(undefined);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('HUB_OPERATOR_IDEMPOTENCY_KEY_REQUIRED');
    expect(await boxCount()).toBe(0);
  });

  test('deux POST identiques : même KOM-BOX, une seule en base', async () => {
    const key = `${tag}-seq`;
    const first = await post(key);
    expect(first.status).toBe(201);
    expect(first.body.replayed).toBe(false);
    const second = await post(key);
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.physical_unit.id).toBe(first.body.physical_unit.id);
    expect(second.body.physical_unit.reference).toBe(first.body.physical_unit.reference);
    expect(await boxCount()).toBe(1);
  });

  test('deux POST simultanés (clé neuve) : une seule KOM-BOX, même identité', async () => {
    const before = await boxCount();
    const key = `${tag}-par`;
    const results = await Promise.all([post(key), post(key), post(key)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(results.map((r) => r.body.physical_unit.id)).size).toBe(1);
    expect(await boxCount()).toBe(before + 1);
  });

  test('deux POST simultanés avec référence explicite : une KOM-BOX, aucune violation d unicité', async () => {
    const key = `${tag}-ref`; const reference = `${tag}-BOX-REF`;
    const results = await Promise.all([post(key, { reference }), post(key, { reference })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await boxCount(reference)).toBe(1);
  });

  test('même clé avec un contenu différent : 409, aucune seconde KOM-BOX', async () => {
    const key = `${tag}-diff`;
    expect((await post(key, { reference: `${tag}-A` })).status).toBe(201);
    const before = await boxCount();
    const clash = await post(key, { reference: `${tag}-B` });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('HUB_IDEMPOTENCY_KEY_REUSED');
    expect(await boxCount()).toBe(before);
    expect(await boxCount(`${tag}-B`)).toBe(0);
  });

  test('une autre clé crée bien une autre KOM-BOX ; la même clé sur un autre marché reste isolée', async () => {
    const a = await post(`${tag}-k1`); const b = await post(`${tag}-k2`);
    expect(a.status).toBe(201); expect(b.status).toBe(201);
    expect(a.body.physical_unit.id).not.toBe(b.body.physical_unit.id);
    const hubOps = require('../../services/hub-operations');
    const otherMarket = await hubOps.createOperatorUnitCommand({ unit_type: 'MARKET_PARCEL' }, global.__a2User.id,
      { idempotencyKey: `${tag}-k1`, idempotencyScope: crypto.randomUUID() });
    expect(otherMarket.status).toBe(201);
    expect(otherMarket.body.physical_unit.id).not.toBe(a.body.physical_unit.id);
  });
});
