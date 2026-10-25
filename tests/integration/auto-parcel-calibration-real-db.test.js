'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * Calibration, NOT fix certification. Actual auto-parcel service + genuine
 * PostgreSQL uniqueness constraint; database fixture held in one ROLLBACK.
 * Deterministic interleaving models a changed membership after pre-check.
 * No supplier/production/Railway side effects.
 */
const ci = process.env.GITHUB_ACTIONS === 'true'
  && process.env.NODE_ENV === 'test'
  && process.env.KOMERCE_DISABLE_CRONS === 'true'
  && process.env.DATABASE_URL === 'postgresql://komerce:komerce@localhost:5432/komerce_test';
if (!ci) {
  describe.skip('Auto-parcel calibration (disposable CI PostgreSQL only)', () => {
    test('skipped', () => {});
  });
} else {
  const { randomUUID } = require('node:crypto');
  const { Pool } = require('pg');
  const { distributeOrder } = require('../../services/auto-parcel');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const id = () => randomUUID();
  let conn, ids;

  beforeAll(async () => {
    conn = await pool.connect();
    await conn.query('BEGIN');
    const { rows: [market] } = await conn.query("SELECT id FROM markets WHERE code = 'KM'");
    if (!market) throw new Error('CI schema has no KM market');
    ids = { relais: id(), product: id(), order: id(), line: id(), first: id(), second: id() };
    const ref = id().slice(0, 12);
    await conn.query(
      'INSERT INTO relais(id,name,phone,address,market_id) VALUES($1,$2,$3,$4,$5)',
      [ids.relais, 'CI Parcel Calibration', '+269100001', 'CI disposable', market.id]
    );
    await conn.query(
      'INSERT INTO products(id,name,price_kmf,stock) VALUES($1,$2,5000,20)',
      [ids.product, 'CI parcel calibration item']
    );
    await conn.query(
      `INSERT INTO orders(id,reference,relais_id,market_id,total_kmf,payment_mode,status)
       VALUES($1,$2,$3,$4,5000,'stripe_eur','ordered')`,
      [ids.order, 'CI-CAL-ORDER-' + ref, ids.relais, market.id]
    );
    await conn.query(
      'INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf) VALUES($1,$2,$3,1,5000)',
      [ids.line, ids.order, ids.product]
    );
    await conn.query(
      `INSERT INTO parcels(id,reference,order_id,relais_id,status,type,label,created_at)
       VALUES($1,$3,$5,$6,'preparation','standard','calibration-first','2025-01-01T00:00:00Z'),
             ($2,$4,$5,$6,'preparation','standard','calibration-second','2025-01-02T00:00:00Z')`,
      [ids.first, ids.second, 'CI-CAL-P1-' + ref, 'CI-CAL-P2-' + ref, ids.order, ids.relais]
    );
    await conn.query('SAVEPOINT calibrated_seed');
  });

  afterAll(async () => {
    if (conn) {
      await conn.query('ROLLBACK').catch(() => {});
      conn.release();
    }
    await pool.end();
  });

  async function memberships() {
    const { rows } = await conn.query(
      'SELECT parcel_id FROM parcel_items WHERE order_item_id = $1 ORDER BY parcel_id',
      [ids.line]
    );
    return rows.map(r => r.parcel_id);
  }

  test('NOMINAL: real SQL inserts one row and the service reports one assignment', async () => {
    await conn.query('ROLLBACK TO SAVEPOINT calibrated_seed');
    let actualInserted = null;
    const executor = { query: async (sql, params) => {
      const result = await conn.query(sql, params);
      if (/^\s*INSERT INTO parcel_items\s*\(/i.test(String(sql))) actualInserted = result.rowCount;
      return result;
    }};
    const result = await distributeOrder(ids.order, executor);
    const persisted = await memberships();
    expect(result.success).toBe(true);
    expect(result.parcel_id).toBe(ids.first);
    expect(actualInserted).toBe(1);
    expect(result.items_assigned).toBe(1);
    expect(persisted).toEqual([ids.first]);
    console.log('CALIBRATION_EVIDENCE ' + JSON.stringify({
      caseId: 'AUTO_PARCEL_SILENT_CONFLICT', mode: 'NOMINAL', service: 'auto-parcel.distributeOrder',
      db: 'POSTGRES_REAL', expected: { sqlInserted: 1, reportedAssigned: 1, chosenParcelMembership: 1 },
      observed: { sqlInserted: actualInserted, reportedAssigned: result.items_assigned,
        chosenParcelMembership: persisted.filter(x => x === ids.first).length },
      invariantOK: true
    }));
  });

  test('DEVIATION: real ON CONFLICT ignores insertion, service still claims success', async () => {
    await conn.query('ROLLBACK TO SAVEPOINT calibrated_seed');
    let actualInserted = null, injected = false, competitorInsertCount = null;
    const executor = { query: async (sql, params) => {
      if (!injected && /^\s*INSERT INTO parcel_items\s*\(/i.test(String(sql))) {
        injected = true;
        // Deterministic time-of-check/time-of-use interleaving. No fabricated pg rowCount.
        // The first parcel was selected while empty; the line is now in another parcel.
        const competing = await conn.query(
          'INSERT INTO parcel_items(parcel_id,order_item_id,quantity,product_id) VALUES($1,$2,1,$3)',
          [ids.second, ids.line, ids.product]
        );
        competitorInsertCount = competing.rowCount;
      }
      const result = await conn.query(sql, params);
      if (/^\s*INSERT INTO parcel_items\s*\(/i.test(String(sql))) actualInserted = result.rowCount;
      return result;
    }};
    const result = await distributeOrder(ids.order, executor);
    const persisted = await memberships();
    expect(injected).toBe(true);
    expect(competitorInsertCount).toBe(1);
    expect(actualInserted).toBe(0);
    expect(result.success).toBe(true);
    expect(result.parcel_id).toBe(ids.first);
    expect(result.items_assigned).toBe(1); // diagnostic of today's bug, NOT desired behavior
    expect(persisted).toEqual([ids.second]); // chosen parcel has no membership
    console.log('CALIBRATION_EVIDENCE ' + JSON.stringify({
      caseId: 'AUTO_PARCEL_SILENT_CONFLICT', mode: 'DEVIATION', service: 'auto-parcel.distributeOrder',
      db: 'POSTGRES_REAL', stimulus: 'competing membership after precheck, before insertion',
      expected: { sqlInserted: 0, reportedAssigned: 0, chosenParcelMembership: 0 },
      observed: { sqlInserted: actualInserted, reportedAssigned: result.items_assigned,
        chosenParcelMembership: persisted.filter(x => x === ids.first).length },
      invariantOK: false
    }));
  });

  test('CLEAN_CONTROL: already assigned before the call is not counted as a new allocation', async () => {
    await conn.query('ROLLBACK TO SAVEPOINT calibrated_seed');
    await conn.query(
      'INSERT INTO parcel_items(parcel_id,order_item_id,quantity,product_id) VALUES($1,$2,1,$3)',
      [ids.second, ids.line, ids.product]
    );
    const result = await distributeOrder(ids.order, conn);
    expect(result.already_assigned).toBe(true);
    expect(result.items_assigned).toBeUndefined();
    expect(await memberships()).toEqual([ids.second]);
  });
}
