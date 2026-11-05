'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration hub-v1-certification-runner-postgres.test.js
 * @brief Runner unique des 13 étapes Hub V1 sur PG16 éphémère : mêmes commandes de bout en bout, réexécution idempotente, LOCAL hors Hub, refus de rôles, zéro effet externe.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../../db');
const runner = require('../../scripts/recette/hub-v1-certification-runner');

jest.setTimeout(240000);
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const q = (sql, args) => db.query(sql, args);

const COUNT_SQL = {
  orders: "SELECT count(*)::int AS n FROM orders WHERE reference LIKE $1",
  order_items: "SELECT count(*)::int AS n FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.reference LIKE $1",
  purchase_lines: "SELECT count(*)::int AS n FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id JOIN orders o ON o.id=oi.order_id WHERE o.reference LIKE $1",
  purchase_orders: "SELECT count(DISTINCT pl.purchase_order_id)::int AS n FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id JOIN orders o ON o.id=oi.order_id WHERE o.reference LIKE $1",
  po_authorizations: "SELECT count(*)::int AS n FROM purchase_order_authorizations a WHERE a.purchase_order_id IN (SELECT pl.purchase_order_id FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id JOIN orders o ON o.id=oi.order_id WHERE o.reference LIKE $1)",
  hub_allocations: "SELECT count(*)::int AS n FROM hub_purchase_allocations WHERE order_id IN (SELECT id FROM orders WHERE reference LIKE $1)",
  hub_units: "SELECT count(*)::int AS n FROM hub_physical_units WHERE reference LIKE $1",
  hub_placements: "SELECT count(*)::int AS n FROM hub_physical_unit_placements p JOIN hub_purchase_allocations a ON a.id=p.allocation_id WHERE a.order_id IN (SELECT id FROM orders WHERE reference LIKE $1)",
  box_bags: "SELECT count(*)::int AS n FROM hub_box_bags b JOIN hub_physical_units u ON u.id=b.bag_unit_id WHERE u.reference LIKE $1",
  parcels: "SELECT count(*)::int AS n FROM parcels p JOIN orders o ON o.id=p.order_id WHERE o.reference LIKE $1",
  shipments: "SELECT count(*)::int AS n FROM international_shipments WHERE reference LIKE $1",
  shipment_events: "SELECT count(*)::int AS n FROM international_shipment_events e JOIN international_shipments s ON s.id=e.shipment_id WHERE s.reference LIKE $1",
  relay_receipts: "SELECT count(*)::int AS n FROM international_shipment_relay_receipts r JOIN international_shipments s ON s.id=r.shipment_id WHERE s.reference LIKE $1",
  customs: "SELECT count(*)::int AS n FROM customs_shipments WHERE reference LIKE $1",
  users: "SELECT count(*)::int AS n FROM users WHERE lower(email) LIKE $1",
};
async function fixtureCounts(run) {
  const orderLike = `E2E-HUB-V1-${run}-%`; const unitLike = `E2E-HUB-V1-${run}-%`; const emailLike = `e2e-hub-v1-${run.toLowerCase()}%@komerce.test`;
  const out = {};
  for (const [k, sql] of Object.entries(COUNT_SQL)) {
    const param = k === 'users' ? emailLike : ['hub_units', 'box_bags', 'shipments', 'shipment_events', 'relay_receipts', 'customs'].includes(k) ? unitLike : orderLike;
    out[k] = (await q(sql, [param])).rows[0].n;
  }
  return out;
}

describeDb('Hub V1 — runner de certification 13 étapes (PG16 jetable)', () => {
  let first; let run; let before; let second; let after;

  beforeAll(async () => {
    run = runner.newRun8();
    first = await runner.runCertification({ db, run });
    before = await fixtureCounts(run);
    second = await runner.runCertification({ db, run });
    after = await fixtureCounts(run);
  });
  afterAll(async () => { await db.pool.end().catch(() => {}); });

  test('les 13 étapes passent sur les mêmes quatre commandes, avec writers, acteurs et UUID', () => {
    expect(first.verdict).toBe('PASS_EPHEMERAL_13_STEPS');
    expect(first.verdict_staging).toBe('HOLD_NO_STAGING_WRITES');
    expect(first.staging_go).toBe(false);
    expect(first.orders).toEqual(['KOM-101', 'KOM-102', 'KOM-103', 'LOCAL'].map((s) => `E2E-HUB-V1-${run}-${s}`));
    expect(first.steps.map((s) => s.status)).toEqual(Array(13).fill('PASS'));
    expect(first.steps.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    for (const step of first.steps) {
      expect(step.writers.length).toBeGreaterThan(0);
      expect(Object.keys(step.actors).length).toBeGreaterThan(0);
      expect(Object.keys(step.ids).length).toBeGreaterThan(0);
      expect(Object.keys(step.statuses || {}).length).toBeGreaterThan(0);
    }
    expect(first.checks).toEqual({ all_13_steps_pass: true, zero_external_effects: true, local_circuit_isolated: true });
  });

  test('quantités : FIFO KOM-101 d’abord, reliquat de KOM-102 livré, tout retiré', async () => {
    const step8 = first.steps[7];
    expect(step8.quantities.PO_A).toMatchObject({ ordered: 3, received: 2, remainder: 1 });
    expect(step8.quantities.fifo).toEqual({ kom101_A: 2, kom102_A: 0, kom101_B: 1 });
    const step13 = first.steps[12];
    expect(step13.quantities.KOM_101).toMatchObject({ received: 3, collected: 3, quantity: 3 });
    expect(step13.quantities.KOM_102).toMatchObject({ received: 1, collected: 1, quantity: 1 });
    const { rows } = await q("SELECT reference,status::text AS status,payment_status::text AS payment_status,simulation_scope,stripe_payment_id,cash_paid_at FROM orders WHERE reference LIKE $1 ORDER BY reference", [`E2E-HUB-V1-${run}-%`]);
    expect(rows.map((r) => [r.reference.split('-').pop(), r.status])).toEqual([['101', 'collected'], ['102', 'collected'], ['103', 'ordered'], ['LOCAL', 'collected']]);
    for (const r of rows) {
      expect(r).toMatchObject({ payment_status: 'paid', simulation_scope: 'E2E-HUB-V1', stripe_payment_id: null, cash_paid_at: null });
    }
  });

  test('KOM-103 : « Sourcing requis » observé via le trigger réel, aucune ligne ni PO', async () => {
    expect(first.steps[2].evidence[0]).toMatchObject({ kom103_sourcing_required: true, kom103_purchase_lines: 0, local_purchase_lines: 0 });
    const { rows } = await q("SELECT count(*)::int AS n FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id JOIN orders o ON o.id=oi.order_id WHERE o.reference=$1", [`E2E-HUB-V1-${run}-KOM-103`]);
    expect(rows[0].n).toBe(0);
  });

  test('rôles réels : un agent Hub, un responsable marché ou un admin sans grant ne peuvent pas autoriser', async () => {
    const step4 = first.steps[3];
    const denied = step4.refusals.filter((r) => r.code === 'AUTHORIZATION_GRANT_REQUIRED');
    expect(denied.length).toBeGreaterThanOrEqual(6); // 3 acteurs × 2 PO
    expect(first.steps[5].refusals.some((r) => r.code === 'AUTHORIZATION_GRANT_REQUIRED')).toBe(true);
    const { rows } = await q(
      `SELECT a.authorization_type, a.decided_by, u.role::text AS role FROM purchase_order_authorizations a JOIN users u ON u.id=a.decided_by
        WHERE a.purchase_order_id IN (SELECT pl.purchase_order_id FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id JOIN orders o ON o.id=oi.order_id WHERE o.reference LIKE $1)`,
      [`E2E-HUB-V1-${run}-%`]);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.decided_by)).size).toBe(1);
    expect(new Set(rows.map((r) => r.authorization_type))).toEqual(new Set(['purchase_commitment', 'supplier_payment']));
    const director = first.fixture.users.hub_director.id;
    expect(rows[0].decided_by).toBe(director);
  });

  test('zéro effet externe : réseau, caisse, fournisseur, notifications, outbox, fidélité', () => {
    expect(first.external_effects.network_attempts).toBe(0);
    expect(Object.values(first.external_effects.table_delta).every((n) => n === 0)).toBe(true);
    expect(first.steps[1].evidence.every((e) => e.proof === 'SIMULATION_ONLY_NO_DEBIT' && e.cash_collections === 0 && e.stripe_payment_id === null)).toBe(true);
    expect(first.steps[4].evidence.every((e) => e.place_order_invoked === false)).toBe(true);
  });

  test('le circuit LOCAL n’entre jamais dans le Hub', async () => {
    expect(first.local_circuit).toMatchObject({ circuit_only_local: true, status: 'collected', hub_rows: { hub_allocations: 0, hub_units: 0, purchase_lines: 0, shipment_receipts: 0 } });
    const ref = `E2E-HUB-V1-${run}-LOCAL`;
    const { rows: [n] } = await q(
      `SELECT (SELECT count(*) FROM hub_purchase_allocations WHERE order_id=o.id)::int AS allocations,
              (SELECT count(*) FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id WHERE oi.order_id=o.id)::int AS lines,
              (SELECT count(*) FROM international_shipment_relay_receipts r JOIN order_items oi ON oi.id=r.order_item_id WHERE oi.order_id=o.id)::int AS receipts
         FROM orders o WHERE o.reference=$1`, [ref]);
    expect(n).toEqual({ allocations: 0, lines: 0, receipts: 0 });
  });

  test('réexécution avec le même RUN8 : 13 PASS et aucun doublon (UUID, PO, autorisations, unités, expéditions)', () => {
    expect(second.steps.map((s) => s.status)).toEqual(Array(13).fill('PASS'));
    expect(second.verdict).toBe('PASS_EPHEMERAL_13_STEPS');
    expect(after).toEqual(before);
    expect(before.orders).toBe(4);
    expect(before.purchase_orders).toBe(2);
    expect(before.po_authorizations).toBe(4);
    expect(before.shipments).toBe(2);
    expect(second.external_effects.network_attempts).toBe(0);
    expect(Object.values(second.external_effects.table_delta).every((n) => n === 0)).toBe(true);
  });

  test('--dry-run n’écrit rien', async () => {
    const dry = `Q${runner.newRun8().slice(1)}`;
    const snapshot = async () => (await q('SELECT (SELECT count(*) FROM users)::int AS u, (SELECT count(*) FROM orders)::int AS o, (SELECT count(*) FROM suppliers)::int AS s, (SELECT count(*) FROM products)::int AS p')).rows[0];
    const b = await snapshot();
    const report = await runner.runCertification({ db, run: dry, dryRun: true });
    expect(report.verdict).toBe('DRY_RUN_NO_WRITES');
    expect(report.dry_run).toMatchObject({ writes: 0, existing_fixture_orders: [] });
    expect(report.dry_run.plan).toHaveLength(13);
    expect(await snapshot()).toEqual(b);
  });

  test('inventaire de nettoyage : preuves immuables conservées, aucune suppression', () => {
    const c = first.cleanup;
    expect(c).toMatchObject({ delete_performed: false, cleanup_certified: false });
    expect(c.strategy.decision).toBe('RETAIN_FIXTURE_PREFIX_NO_DELETE');
    expect(c.strategy.immutable_tables).toEqual(expect.arrayContaining(['purchase_lines', 'hub_purchase_allocations', 'hub_custody_events', 'international_shipment_relay_receipts', 'scan_events']));
    expect(c.order_roots).toHaveLength(4);
    const owned = Object.fromEntries(c.owned_roots_outside_fk_graph.map((o) => [o.table, o.count]));
    expect(owned).toMatchObject({ relais: 1, suppliers: 2, products: 4, purchase_orders: 2, international_shipments: 2, customs_shipments: 2 });
    expect(owned.users).toBe(7);
  });

  test('rapports JSON + Markdown générés par le runner', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-v1-cert-'));
    const files = runner.writeReports(first, dir);
    const json = JSON.parse(fs.readFileSync(files.json, 'utf8'));
    const md = fs.readFileSync(files.markdown, 'utf8');
    expect(json.steps).toHaveLength(13);
    expect(md).toContain('HOLD_NO_STAGING_WRITES');
    expect((md.match(/^\| \d+ \|/gm) || [])).toHaveLength(13);
    expect(md).not.toMatch(/password|secret|token/i);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('garde de cible : base distante et drapeau staging refusés avant toute connexion', () => {
    expect(() => runner.assertEphemeralTarget('postgres://u:p@db.railway.internal:5432/railway', [])).toThrow(/LOCAL_EPHEMERAL_DATABASE_ONLY/);
    expect(() => runner.assertEphemeralTarget('postgres://u:p@localhost:5432/komerce_prod', [])).toThrow(/LOCAL_EPHEMERAL_DATABASE_ONLY/);
    expect(() => runner.assertEphemeralTarget('postgres://u:p@localhost:5432/komerce_test', ['--allow-remote-staging'])).toThrow(/REMOTE_STAGING_NOT_IMPLEMENTED/);
    expect(runner.assertEphemeralTarget('postgres://u:p@127.0.0.1:5432/komerce_test', [])).toEqual({ host: '127.0.0.1', database: 'komerce_test' });
  });

  test('aucun UPDATE SQL de statut, aucun contournement de trigger dans le runner', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../scripts/recette/hub-v1-certification-runner.js'), 'utf8');
    expect(source).not.toMatch(/SET\s+(status|stage|state|payment_status)\s*=/i);
    expect(source).not.toMatch(/session_replication_role/i);
    expect(source).not.toMatch(/DISABLE\s+TRIGGER/i);
    expect(source).not.toMatch(/DELETE\s+FROM/i);
  });
});
