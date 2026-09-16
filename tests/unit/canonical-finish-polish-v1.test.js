'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

const HTML_SURFACES = [
  'public/dashboards/canonical/index.html',
  'public/dashboards/canonical/access.html',
  'public/dashboards/canonical/market-autonomy.html',
  'public/dashboards/canonical/market-catalog.html',
];

describe('Canonical Finish Polish V1', () => {
  test.each(HTML_SURFACES)('%s charge le polish apres le shell V4', relative => {
    const html = read(relative);
    const shellCss = html.indexOf('/dashboards/canonical/css/canonical-shell-v4.css?v=2101');
    const polishCss = html.indexOf('/dashboards/canonical/css/canonical-finish-polish-v1.css?v=2401');
    const shellJs = html.indexOf('/dashboards/canonical/js/navigation-shell-v4-sync.js?v=2101');
    const polishJs = html.indexOf('/dashboards/canonical/js/canonical-finish-polish-v1.js?v=2401');

    expect(shellCss).toBeGreaterThanOrEqual(0);
    expect(polishCss).toBeGreaterThan(shellCss);
    expect(shellJs).toBeGreaterThanOrEqual(0);
    expect(polishJs).toBeGreaterThan(shellJs);
  });

  test('la couche CSS ferme les details responsive et accessibilite sans autorite metier', () => {
    const css = read('public/dashboards/canonical/css/canonical-finish-polish-v1.css');
    expect(css).toContain('overflow-x: clip');
    expect(css).toContain('env(safe-area-inset-top)');
    expect(css).toContain('scroll-snap-type: inline proximity');
    expect(css).toContain('outline: 2px solid #6f7fff');
    expect(css).toMatch(/@media \(max-width: 980px\)[\s\S]*min-height: 44px/);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).not.toMatch(/\/api\//);
    expect(css).not.toMatch(/market_id|price_kmf|supplier_order_identity|UPDATE |INSERT INTO/i);
  });

  test('le polish JS est syntaxiquement valide et reste purement DOM', () => {
    const source = read('public/dashboards/canonical/js/canonical-finish-polish-v1.js');
    expect(() => new vm.Script(source)).not.toThrow();
    expect(source).toContain("'(prefers-reduced-motion: reduce)'");
    expect(source).toContain("'.kmc-admin-primary-link.is-active'");
    expect(source).toContain("'.kmc-admin-domain-tab.is-active'");
    expect(source).toContain("'title'");
    expect(source).toContain("'aria-label'");
    expect(source).toContain('MutationObserver');
    expect(source).not.toMatch(/fetch\(|XMLHttpRequest|\/api\//);
    expect(source).not.toMatch(/market_id|price_kmf|supplier_order_identity|UPDATE |INSERT INTO/i);
  });
});
