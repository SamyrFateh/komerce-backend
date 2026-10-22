'use strict';

/** @test-kind unit @test-runner jest @test-requires none */


describe('lot 7 — signaux de commandes simulées exclus (services/dashboard-metrics/control-tower.js)', () => {
  test('le lecteur de signaux applique le prédicat réel/RCT1 canonique', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'services/dashboard-metrics/control-tower.js'), 'utf8');
    expect(src).toMatch(/require\('[^']*signal-simulation-scope'\)/);
    expect(src).toMatch(/\$\{EXCLUDE_SIMULATED_ORDER_SIGNALS_SQL\}/);
  });
});
