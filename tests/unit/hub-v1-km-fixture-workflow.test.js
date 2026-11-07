'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const wf = fs.readFileSync(path.join(__dirname, '../../.github/workflows/hub-v1-km-fixture-stop-after-2.yml'), 'utf8');

describe('workflow fixture staging stop-after=2, marché explicitement borné', () => {
  test('déclenché par le propriétaire, KM par défaut, choix KM/CM/CG, dry-run avant écriture', () => {
    expect(wf).toMatch(/github\.event\.issue\.user\.login == github\.repository_owner/);
    expect(wf).toMatch(/github\.actor == github\.repository_owner/);
    expect(wf).toMatch(/title == '\[staging-op\] hub-v1-km-fixture-stop-after-2'/);
    expect(wf).toMatch(/^\s*default:\s*KM\s*$/m);
    expect(wf).toMatch(/^\s*options:\s*\[KM, CM, CG\]\s*$/m);
    expect(wf).toMatch(/HUB_V1_MARKET:\s*\$\{\{\s*inputs\.market\s*\|\|\s*'KM'\s*\}\}/);
    const runs = wf.split('\n').filter(l => l.includes('hub-v1-certification-runner.js'));
    expect(runs).toHaveLength(2);
    for (const line of runs) {
      expect(line).toContain('--market="$HUB_V1_MARKET"');
      expect(line).toMatch(/--stop-after=2/);
      expect(line).toMatch(/--allow-remote-staging/);
    }
    expect(runs[0]).toMatch(/--dry-run/);
    expect(runs[1]).not.toMatch(/--dry-run/);
    expect(wf).not.toMatch(/--market=(CM|CG|YT|DJ)/);
  });
});
