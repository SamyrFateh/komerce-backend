'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration hub-t8-unreconciled-arrival-postgres.test.js
 * @brief T8 / HB-08: une arrivée fournisseur sans contenu crée une tâche de rapprochement datée, visible dans le dossier et chez la directrice.
 */
const crypto = require('crypto');
const db = require('../../db');
const hubOps = require('../../services/hub-operations');
const { getDossier, getDirectorTodo } = require('../../services/hub-procurement-dossier');
const { assertTestDatabase } = require('../helpers/e2eDbKit');

jest.setTimeout(60000);
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('Hub T8 — colis fournisseur arrivé sans contenu (PostgreSQL 16 jetable)', () => {
  let km;
  beforeAll(async () => {
    assertTestDatabase();
    const host = new URL(process.env.DATABASE_URL).hostname;
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
      throw new Error('T8_TEST_LOCAL_POSTGRES_ONLY');
    }
    km = (await db.query("SELECT id FROM markets WHERE code='KM' LIMIT 1")).rows[0]?.id;
    expect(km).toBeTruthy();
  });
  afterAll(async () => {
    await db.pool.end().catch(() => {});
  });

  test('T8 : arrivée sans manifeste -> unité RECEIVED unique -> tâche RECONCILE_PARCEL datée dans les 2 vues', async () => {
    const reference = 'T8-ARR-' + crypto.randomBytes(6).toString('hex').toUpperCase();
    const created = await hubOps.receiveSupplierPackageCommand({
      reference, location_ref: 'HUB-E2E-UNRECONCILED', contents: [],
    }, null);
    expect(created.status).toBe(201);
    expect(created.body?.reconciliation_mode).toBe('UNRECONCILED');
    const unit = created.body.unit;
    expect(unit?.id).toBeTruthy();
    expect(unit.state).toBe('RECEIVED');
    const { rows: [physical] } = await db.query(
      'SELECT id,reference,unit_type,state,created_at FROM hub_physical_units WHERE reference=$1',
      [reference]
    );
    expect(physical.id).toBe(unit.id);
    expect(physical.unit_type).toBe('SUPPLIER_PACKAGE');
    expect(physical.state).toBe('RECEIVED');
    expect(physical.created_at).toBeTruthy();

    const { rows: [count] } = await db.query(
      'SELECT COUNT(*)::int AS n FROM hub_physical_unit_placements WHERE physical_unit_id=$1 AND removed_at IS NULL',
      [unit.id]
    );
    expect(count.n).toBe(0);

    const dossier = await getDossier({ marketId: km });
    const taskId = 'RECONCILE_PARCEL:' + unit.id;
    const task = dossier.cockpit.todo.find(t => t.id === taskId);
    expect(task).toBeDefined();
    expect(task).toMatchObject({
      kind: 'RECONCILE_PARCEL', owner: 'agent_hub', severity: 'anomaly',
      subject: { parcel_unit_id: unit.id },
      overdue: false,
    });
    expect(task.since).toBeTruthy();
    expect(task.missing).toContain(reference);

    const director = await getDirectorTodo();
    const matching = director.tasks.filter(t => t.id === taskId);
    expect(matching).toHaveLength(1);
    expect(matching[0].market).toBeTruthy();
    expect(matching[0].since).toBeTruthy();
    expect(matching[0].age_hours).toBeGreaterThanOrEqual(0);
  });
});
