'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration hub-v1-runner-market-stop-postgres.test.js
 * @brief Runner Hub V1 : --market (CM/CG/YT en base éphémère) et --stop-after=N (fixture prête, aucun faux 13/13).
 */
const db = require('../../db');
const runner = require('../../scripts/recette/hub-v1-certification-runner');

jest.setTimeout(240000);
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const argv = (...a) => [process.argv[0], 'runner', ...a];

describeDb('runner Hub V1 — marché et arrêt à l’étape N', () => {
  afterAll(async () => { await db.pool.end().catch(() => {}); });

  test('--stop-after=2 : fixture prête, verdict partiel, jamais 13/13', async () => {
    const run = runner.newRun8();
    const report = await runner.runCertification({ db, run, argv: argv('--stop-after=2') });
    expect(report.verdict).toBe('PARTIAL_STOP_AFTER_STEP_PASS');
    expect(report.steps.map((s) => s.status)).toEqual(['PASS', 'PASS']);
    expect(report.checks.all_13_steps_pass).toBe(false);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id JOIN orders o ON o.id=oi.order_id WHERE o.reference LIKE $1', [`E2E-HUB-V1-${run}-%`]);
    expect(rows[0].n).toBe(0); // aucune préparation PO : réservée à l'UI
  });

  test.each(['CM', 'YT'])('--market=%s : 13/13 dans la devise du marché', async (code) => {
    const run = runner.newRun8();
    const report = await runner.runCertification({ db, run, argv: argv(`--market=${code}`) });
    expect(report.market).toBe(code);
    expect(report.verdict).toBe('PASS_EPHEMERAL_13_STEPS');
    const { rows } = await db.query("SELECT DISTINCT o.market_id, m.code FROM orders o JOIN markets m ON m.id=o.market_id WHERE o.reference LIKE $1", [`E2E-HUB-V1-${run}-%`]);
    expect(rows.map((r) => r.code)).toEqual([code]);
  });

  test('options invalides refusées', () => {
    expect(() => runner.parseRunOptions(argv('--market=XYZ'))).toThrow('HUB_V1_RUNNER_MARKET_INVALID');
    expect(() => runner.parseRunOptions(argv('--stop-after=13'))).toThrow('HUB_V1_RUNNER_STOP_AFTER_INVALID');
    expect(runner.parseRunOptions(argv())).toEqual({ market: 'KM', stopAfter: null });
  });
});
