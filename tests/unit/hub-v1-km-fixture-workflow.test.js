'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const wf = fs.readFileSync(path.join(__dirname, '../../.github/workflows/hub-v1-km-fixture-stop-after-2.yml'), 'utf8');

describe('workflow fixture KM stop-after=2', () => {
  test('declenche par issue du proprietaire a titre exact, KM, arret apres etape 2, dry-run avant ecriture', () => {
    expect(wf).toMatch(/github\.event\.issue\.user\.login == github\.repository_owner/);
    expect(wf).toMatch(/title == '\[staging-op\] hub-v1-km-fixture-stop-after-2'/);
    const runs = wf.split('\n').filter((l) => l.includes('hub-v1-certification-runner.js'));
    expect(runs).toHaveLength(2);
    for (const l of runs) { expect(l).toMatch(/--market=KM/); expect(l).toMatch(/--stop-after=2/); }
    expect(runs[0]).toMatch(/--dry-run/);
    expect(runs[1]).not.toMatch(/--dry-run/);
    expect(wf).not.toMatch(/--market=(CM|CG|YT|DJ)/);
  });
});
