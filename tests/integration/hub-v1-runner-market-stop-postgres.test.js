'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration hub-v1-runner-market-stop-postgres.test.js
 * @brief Runner V1 historique : --market CM/YT reste isolé et refuse le faux 13/13 après retraite des sacs.
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

  test.each(['CM', 'YT'])('--market=%s : marché correctement cloisonné, 13/13 impossible avec sacs retirés', async (code) => {
    const run = runner.newRun8();
    const report = await runner.runCertification({ db, run, argv: argv(`--market=${code}`) });
    expect(report.market).toBe(code);
    expect(report.verdict).toBe('FAIL_OR_BLOCKED');
    expect(report.staging_go).toBe(false);
    expect(report.checks.all_13_steps_pass).toBe(false);
    expect(report.steps.some(step=>step.status==='FAIL'||step.status==='BLOCKED')).toBe(true);
    const { rows } = await db.query("SELECT DISTINCT o.market_id, m.code FROM orders o JOIN markets m ON m.id=o.market_id WHERE o.reference LIKE $1", [`E2E-HUB-V1-${run}-%`]);
    expect(rows.map((r) => r.code)).toEqual([code]);
  });

  test('options invalides refusées', () => {
    expect(() => runner.parseRunOptions(argv('--market=XYZ'))).toThrow('HUB_V1_RUNNER_MARKET_INVALID');
    expect(() => runner.parseRunOptions(argv('--stop-after=13'))).toThrow('HUB_V1_RUNNER_STOP_AFTER_INVALID');
    expect(runner.parseRunOptions(argv())).toEqual({ market: 'KM', stopAfter: null });
  });
});
