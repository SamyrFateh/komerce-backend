'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration hub-v1-certification-runner-postgres.test.js
 * @brief Archive Hub V1 13-step runner: with customer-bag writers retired,
 * this runner MUST fail closed, never fabricate 13/13 or a staging GO.
 * New direct-COMBOX certification belongs to the canonical G6 journeys.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../../db');
const runner = require('../../scripts/recette/hub-v1-certification-runner');
jest.setTimeout(240000);
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('Hub V1 historique — retraite des sacs sans faux certificat (PG réel)', () => {
  let first;
  let run;
  beforeAll(async () => {
    run = runner.newRun8();
    first = await runner.runCertification({db,run});
  });
  afterAll(async()=>{ await db.pool.end().catch(()=>{}); });

  test('runner historique échoue explicitement après retraite des sacs, jamais 13/13',()=>{
    expect(first.verdict).toBe('FAIL_OR_BLOCKED');
    expect(first.verdict_staging).toBe('HOLD_NO_STAGING_WRITES');
    expect(first.staging_go).toBe(false);
    expect(first.checks.all_13_steps_pass).toBe(false);
    expect(first.steps).toHaveLength(13);
    expect(first.steps.some(s=>s.status==='FAIL'||s.status==='BLOCKED')).toBe(true);
    expect(first.steps.some(s=>s.status==='SKIPPED')).toBe(true);
    expect(first.steps.map(s=>s.status)).not.toEqual(Array(13).fill('PASS'));
  });

  test('l identité des commandes historiques demeure inchangée et consultable',()=>{
    expect(first.orders).toEqual(['KOM-101','KOM-102','KOM-103','LOCAL'].map(s=>`E2E-HUB-V1-${run}-${s}`));
    expect(first.fixture).toBeTruthy();
  });

  test('aucun effet fournisseur, PSP ou réseau masqué',()=>{
    expect(first.external_effects).toBeTruthy();
    expect(first.external_effects.zero_external_effects).toBe(true);
  });

  test('dry-run reste lisible et ne crée aucune commande',async()=>{
    const other=runner.newRun8();
    const result=await runner.runCertification({db,run:other,dryRun:true});
    expect(result.verdict).toBe('DRY_RUN_NO_WRITES');
    expect(result.dry_run.writes).toBe(0);
    expect(result.dry_run.plan).toHaveLength(13);
    const {rows}=await db.query('SELECT count(*)::int AS n FROM orders WHERE reference LIKE $1',
      [`E2E-HUB-V1-${other}-%`]);
    expect(rows[0].n).toBe(0);
  });

  test('reporting historique conserve le vrai FAIL sans retoucher la source',()=>{
    const out=fs.mkdtempSync(path.join(os.tmpdir(),'komerce-v1-retired-'));
    try {
      const report=runner.writeReports(first,out);
      const json=JSON.parse(fs.readFileSync(report.json,'utf8'));
      const markdown=fs.readFileSync(report.markdown,'utf8');
      expect(json.verdict).toBe('FAIL_OR_BLOCKED');
      expect(markdown).toContain('FAIL_OR_BLOCKED');
      expect(markdown).not.toContain('**PASS_EPHEMERAL_13_STEPS**');
    } finally { fs.rmSync(out,{recursive:true,force:true}); }
  });
});
