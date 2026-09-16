'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CANONICAL = path.join(ROOT, 'public', 'dashboards', 'canonical');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

const HTML_SURFACES = [
  'public/dashboards/canonical/index.html',
  'public/dashboards/canonical/access.html',
  'public/dashboards/canonical/market-autonomy.html',
  'public/dashboards/canonical/market-catalog.html',
];

describe('Canonical Theme V2 — convergence visuelle', () => {
  test.each(HTML_SURFACES)('%s charge Theme V2 après Visual Freeze V1', relative => {
    const html = read(relative);
    const freeze = html.indexOf('/dashboards/canonical/css/visual-freeze-v1.css?v=1701');
    const theme = html.indexOf('/dashboards/canonical/css/canonical-theme-v2.css?v=1901');
    expect(freeze).toBeGreaterThanOrEqual(0);
    expect(theme).toBeGreaterThan(freeze);
  });

  test('Theme V2 porte les tokens issus de la Control Tower et cible les primitives partagées', () => {
    const css = read('public/dashboards/canonical/css/canonical-theme-v2.css');
    expect(css).toContain('--kmc-canon-bg: #f8fbff');
    expect(css).toContain('--kmc-canon-ink: #102143');
    expect(css).toContain('--kmc-canon-blue: #4f67ff');
    expect(css).toContain('.kmc-dashboard-header');
    expect(css).toContain('.kmc-workspace-header');
    expect(css).toContain('.kmc-decision-surface-card');
    expect(css).toContain('.kmc-workspace-table');
    expect(css).toContain('.kmc-workspace-action');
  });

  test('Catalogue garde sa Control Tower mais rend l’autorité au shell Canonical', () => {
    const css = read('public/dashboards/canonical/css/canonical-theme-v2.css');
    expect(css).toContain('body.kmc-catalog-live-mode > .kmc-admin-navigation');
    expect(css).toMatch(/body\.kmc-catalog-live-mode > \.kmc-admin-navigation\s*\{[\s\S]*display:\s*block\s*!important/);
    expect(css).toMatch(/\.kmc-ctl-sidebar\s*\{[\s\S]*display:\s*none\s*!important/);
    expect(css).toMatch(/\.kmc-catalog-control-tower\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });

  test('le thème reste présentation-only : aucun endpoint ni logique métier', () => {
    const css = read('public/dashboards/canonical/css/canonical-theme-v2.css');
    expect(css).not.toMatch(/\/api\//);
    expect(css).not.toMatch(/market_id|marketId|price_kmf|supplier_order_identity/);
  });
});
