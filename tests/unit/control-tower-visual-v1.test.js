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

describe('Control Tower visual rebuild V1', () => {
  test('la couche est chargée après les thèmes partagés', () => {
    const html = read('public/dashboards/canonical/index.html');
    const legacy = html.indexOf('/dashboards/canonical/css/canonical-legacy-theme-v1.css');
    const cockpit = html.indexOf('/dashboards/canonical/css/cockpit-legacy-v1.css');
    const control = html.indexOf('/dashboards/canonical/css/control-tower-visual-v1.css');
    expect(legacy).toBeGreaterThanOrEqual(0);
    expect(cockpit).toBeGreaterThan(legacy);
    expect(control).toBeGreaterThan(cockpit);
  });

  test('le shell visuel commun passe en navy sans toucher aux vérités métier', () => {
    const css = read('public/dashboards/canonical/css/control-tower-visual-v1.css');
    expect(css).toContain('body.kmc-shell-v4 > .kmc-admin-navigation');
    expect(css).toContain('linear-gradient(180deg, #0b1f3a');
    expect(css).toContain('.kmc-admin-primary-link.is-active');
    expect(css).not.toMatch(/\/api\//);
    expect(css).not.toMatch(/market_id|supplier_order_identity|reconciliation_id/);
  });

  test('les quatre zones visuelles de la Tour sont explicitement stylées', () => {
    const css = read('public/dashboards/canonical/css/control-tower-visual-v1.css');
    expect(css).toContain('[data-dashboard-id="pilotage"] .kmc-decision-strip');
    expect(css).toContain('.is-control-tower-causes');
    expect(css).toContain('.is-control-tower-flow');
    expect(css).toContain('.is-control-tower-actions');
  });

  test('les états critiques, attention, positifs et inconnus restent visuellement distincts', () => {
    const css = read('public/dashboards/canonical/css/control-tower-visual-v1.css');
    expect(css).toContain('.kmc-flow-stage.is-critical');
    expect(css).toContain('.kmc-flow-stage.is-warning');
    expect(css).toContain('.kmc-flow-stage.is-positive');
    expect(css).toContain('.kmc-flow-stage.is-neutral');
  });

  test('la Tour reste responsive', () => {
    const css = read('public/dashboards/canonical/css/control-tower-visual-v1.css');
    expect(css).toContain('@media (max-width: 1180px)');
    expect(css).toContain('@media (max-width: 760px)');
    expect(css).toMatch(/grid-template-columns:\s*1fr/);
  });
});
