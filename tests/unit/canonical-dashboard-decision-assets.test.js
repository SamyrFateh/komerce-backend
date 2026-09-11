/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const INDEX = path.join(ROOT, 'public', 'dashboards', 'canonical', 'index.html');
const CSS = path.join(ROOT, 'public', 'dashboards', 'canonical', 'css', 'decision-visual.css');
const PILOTAGE_DECISION = path.join(ROOT, 'public', 'dashboards', 'canonical', 'js', 'pilotage-decision.js');

describe('DASHBOARD DECISION VISUAL V1 — wiring', () => {
  test('charge les assets de décision dans le bon ordre', () => {
    const html = fs.readFileSync(INDEX, 'utf8');
    expect(html).toContain('/dashboards/canonical/css/decision-visual.css?v=1601');
    expect(html.indexOf('/dashboards/canonical/js/decision-primitives.js?v=1601'))
      .toBeGreaterThan(html.indexOf('/dashboards/canonical/js/primitives.js?v=1204'));
    expect(html.indexOf('/dashboards/canonical/js/pilotage-decision.js?v=1601'))
      .toBeGreaterThan(html.indexOf('/dashboards/canonical/js/pilotage.js'));
    expect(html.indexOf('/dashboards/canonical/js/pilotage-decision.js?v=1601'))
      .toBeLessThan(html.indexOf('/dashboards/canonical/js/app.js?v=1503'));
  });

  test('la couche Pilotage décision ne fetch pas et ne contient aucune valeur mock', () => {
    const source = fs.readFileSync(PILOTAGE_DECISION, 'utf8');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\.innerHTML\b/);
    expect(source).not.toMatch(/125\s*430|1\s*240\s*000|312\s*produits/i);
  });

  test('le CSS reste dans le namespace Canonical décision', () => {
    const css = fs.readFileSync(CSS, 'utf8');
    expect(css).toMatch(/\.kmc-decision-strip/);
    expect(css).toMatch(/\.kmc-trust-footer/);
    expect(css).not.toMatch(/\.legacy-|#admin-app|dashboards\/admin/);
  });
});
