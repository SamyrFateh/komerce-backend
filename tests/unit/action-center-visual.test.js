'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

describe('Action Center visual polish V1', () => {
  test('la couche visuelle est chargée après le cockpit partagé', () => {
    const html = read('public/dashboards/canonical/index.html');
    const cockpit = html.indexOf('/dashboards/canonical/css/cockpit-legacy-v1.css');
    const action = html.indexOf('/dashboards/canonical/css/action-center-visual.css');
    expect(cockpit).toBeGreaterThanOrEqual(0);
    expect(action).toBeGreaterThan(cockpit);
  });

  test('le Hero contextuel porte le caractère Action Center sans navigation générique', () => {
    const css = read('public/dashboards/canonical/css/action-center-visual.css');
    expect(css).toContain('.kmc-action-center > .kmc-workspace-header');
    expect(css).toContain('linear-gradient(112deg, #fff8f7');
    expect(css).toContain('min-height: 126px');
  });

  test('les quatre sévérités ont une signalétique explicite sans logique métier', () => {
    const css = read('public/dashboards/canonical/css/action-center-visual.css');
    expect(css).toContain('.kmc-action-signal.is-urgent');
    expect(css).toContain('.kmc-action-signal.is-critical');
    expect(css).toContain('.kmc-action-signal.is-warning');
    expect(css).toContain('.kmc-action-signal.is-info');
    expect(css).not.toMatch(/\/api\//);
    expect(css).not.toMatch(/market_id|marketId|supplier_order_identity/);
  });

  test('la présentation reste responsive', () => {
    const css = read('public/dashboards/canonical/css/action-center-visual.css');
    expect(css).toContain('@media (max-width: 1050px)');
    expect(css).toContain('@media (max-width: 680px)');
    expect(css).toMatch(/grid-template-columns:\s*1fr/);
  });
});
