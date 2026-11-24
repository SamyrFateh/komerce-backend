'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration order-delivery-wave-migration-postgres.test.js
 * @brief Executes migration 426 against a disposable PostgreSQL 16 database, never shared staging.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

jest.setTimeout(30000);
const isolated = process.env.KOMERCE_ORDER_WAVE_PG_ISOLATED === '1' && !!process.env.DATABASE_URL;
const describeDb = isolated ? describe : describe.skip;

describeDb('migration 426 — real PostgreSQL transactional smoke', () => {
  let pg;
  const mkt = '11111111-1111-4111-8111-111111111111';
  const relay1 = '22222222-2222-4222-8222-222222222221';
  const relay2 = '22222222-2222-4222-8222-222222222222';
  const rec1 = '33333333-3333-4333-8333-333333333331';
  const rec2 = '33333333-3333-4333-8333-333333333332';
  const buyer = '44444444-4444-4444-8444-444444444444';

  beforeAll(async () => {
    pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    await pg.query('BEGIN');
    // This CI-only database starts EMPTY. We intentionally create only the
    // prerequisite identities so no dependency on a shared staging dump exists.
    await pg.query('CREATE TABLE public.users (id uuid PRIMARY KEY)');
    await pg.query('CREATE TABLE public.markets (id uuid PRIMARY KEY)');
    await pg.query('CREATE TABLE public.relais (id uuid PRIMARY KEY, market_id uuid NOT NULL, name text NOT NULL, is_active boolean NOT NULL DEFAULT TRUE)');
    await pg.query('CREATE TABLE public.recipients (id uuid PRIMARY KEY, user_id uuid NOT NULL, relais_id uuid NOT NULL)');
    await pg.query('CREATE TABLE public.orders (id uuid PRIMARY KEY, reference text UNIQUE NOT NULL)');
    const sql = fs.readFileSync(path.join(__dirname, '../../migrations/426_order_delivery_waves.sql'),'utf8');
    await pg.query(sql);
    await pg.query(sql); // idempotence of schema migration
    await pg.query('INSERT INTO public.users (id) VALUES ($1)', [buyer]);
    await pg.query('INSERT INTO public.markets (id) VALUES ($1)', [mkt]);
    await pg.query('INSERT INTO public.relais (id,market_id,name,short_code) VALUES ($1,$3,\'Yaounde Centre\',\'YA01\'),($2,$3,\'Yaounde Est\',\'YA02\')', [relay1, relay2, mkt]);
    await pg.query('INSERT INTO public.recipients (id,user_id,relais_id) VALUES ($1,$3,$4),($2,$3,$4)',[rec1,rec2,buyer,relay1]);
  });
  afterAll(async () => {
    if (pg) {
      await pg.query('ROLLBACK').catch(() => {});
      await pg.end().catch(() => {});
    }
  });
  async function expectConflict(sql, params, errorCode) {
    await pg.query('SAVEPOINT migration_expected_failure');
    let thrown;
    try { await pg.query(sql,params); } catch (error) { thrown = error; }
    await pg.query('ROLLBACK TO SAVEPOINT migration_expected_failure');
    if (!thrown) throw new Error('A PostgreSQL constraint was bypassed');
    expect(thrown.code).toBe(errorCode);
  }
  test('stable name-derived relay codes are unique per market and support YA10', async () => {
    await expectConflict('UPDATE public.relais SET short_code=\'YA01\' WHERE id=$1',[relay2],'23505');
    await pg.query('UPDATE public.relais SET short_code=\'YA10\' WHERE id=$1',[relay2]);
    await expectConflict('UPDATE public.relais SET short_code=\'YA00\' WHERE id=$1',[relay2],'23514');
  });
  test('a recipient has one open wave and 3-character codes do not collide in one relay', async () => {
    const x = await pg.query('INSERT INTO public.order_delivery_waves(subject_recipient_id,market_id,relais_id,client_code) VALUES ($1,$2,$3,$4) RETURNING id',[rec1,mkt,relay1,'B7Q']);
    const waveId=x.rows[0].id;
    await expectConflict('INSERT INTO public.order_delivery_waves(subject_recipient_id,market_id,relais_id,client_code) VALUES ($1,$2,$3,$4)',[rec1,mkt,relay1,'F6T'],'23505');
    await expectConflict('INSERT INTO public.order_delivery_waves(subject_recipient_id,market_id,relais_id,client_code) VALUES ($1,$2,$3,$4)',[rec2,mkt,relay1,'B7Q'],'23505');
    await pg.query('INSERT INTO public.order_delivery_waves(subject_recipient_id,market_id,relais_id,client_code) VALUES ($1,$2,$3,$4)',[rec2,mkt,relay1,'F6T']);
    await pg.query('INSERT INTO public.orders (id,reference,delivery_wave_id) VALUES ($1,$2,$3)', ['55555555-5555-4555-8555-555555555555','CM-YA01-B7Q01',waveId]);
    await pg.query('UPDATE public.order_delivery_waves SET closed_at=now(),close_reason=\'FIRST_HANDOFF\' WHERE id=$1',[waveId]);
    await pg.query('INSERT INTO public.order_delivery_waves(subject_recipient_id,market_id,relais_id,client_code) VALUES ($1,$2,$3,$4)',[rec1,mkt,relay1,'H5T']);
    const allocated=await pg.query('UPDATE public.order_delivery_waves SET next_order_number=next_order_number+1, planned_units=planned_units+3 WHERE id=$1 RETURNING next_order_number,planned_units',[waveId]);
    expect(allocated.rows[0]).toMatchObject({next_order_number:2,planned_units:3});
    const result=await pg.query('SELECT count(*)::int AS count FROM public.order_delivery_waves WHERE subject_recipient_id=$1',[rec1]);
    expect(result.rows[0].count).toBe(2);
  });
});
