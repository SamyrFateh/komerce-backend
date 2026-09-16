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

describe('Canonical Hybrid Shell V4 — doctrine + mock style contract', () => {
  test('la doctrine fige N1 sidebar, N2 horizontal, N3 local et topbar transverse', () => {
    const doctrine = read('docs/doctrine/ADMIN_NAVIGATION_DOCTRINE_V3.md');
    expect(doctrine).toContain('N1 = sidebar verticale persistante');
    expect(doctrine).toContain('N2 = onglets horizontaux contextuels');
    expect(doctrine).toContain('N3 = contrôles locaux de la page');
    expect(doctrine).toContain('topbar transverse');
    expect(doctrine).toContain('Un seul shell Komerce');
  });

  test('le contrat de style traduit les mocks en valeurs mesurables', () => {
    const contract = read('docs/doctrine/CANONICAL_UI_STYLE_CONTRACT_V1.md');
    expect(contract).toContain('sidebar desktop : `176px`');
    expect(contract).toContain('topbar cible : `52px`');
    expect(contract).toContain('application background : `#f8fbff`');
    expect(contract).toContain('navy / ink : `#102143`');
    expect(contract).toContain('primary indigo : `#4f67ff`');
    expect(contract).toContain('rayon principal : `8px`');
    expect(contract).toContain('Les mocks ne sont pas une inspiration');
  });

  test.each(HTML_SURFACES)('%s charge Shell V4 après Theme V2 et Policy V4 après V3', relative => {
    const html = read(relative);
    const theme = html.indexOf('/dashboards/canonical/css/canonical-theme-v2.css?v=1901');
    const shell = html.indexOf('/dashboards/canonical/css/canonical-shell-v4.css?v=2101');
    const v3 = html.indexOf('/dashboards/canonical/js/navigation-policy-v3.js?v=2001');
    const v4 = html.indexOf('/dashboards/canonical/js/navigation-policy-v4.js?v=2101');
    expect(theme).toBeGreaterThanOrEqual(0);
    expect(shell).toBeGreaterThan(theme);
    expect(v3).toBeGreaterThanOrEqual(0);
    expect(v4).toBeGreaterThan(v3);
  });

  test('le CSS porte strictement le shell des mocks validés', () => {
    const css = read('public/dashboards/canonical/css/canonical-shell-v4.css');
    expect(css).toContain('--kmc-shell-sidebar-width: 176px');
    expect(css).toContain('--kmc-shell-topbar-height: 52px');
    expect(css).toContain('body.kmc-shell-v4 > .kmc-admin-navigation');
    expect(css).toMatch(/position:\s*fixed/);
    expect(css).toContain('background: #102143');
    expect(css).toContain('.kmc-admin-topbar');
    expect(css).toContain('.kmc-admin-domain-tabs');
    expect(css).toContain('.kmc-admin-domain-tab.is-active::after');
    expect(css).toMatch(/body\.kmc-shell-v4 \.kmc-ctl-sidebar,[\s\S]*\.kmc-ctl-topbar\s*\{[\s\S]*display:\s*none\s*!important/);
  });

  test('Policy V4 est syntaxiquement valide et formalise les rubriques Catalogue / Atelier', () => {
    const source = read('public/dashboards/canonical/js/navigation-policy-v4.js');
    expect(() => new vm.Script(source)).not.toThrow();
    expect(source).toContain("label: 'Sources'");
    expect(source).toContain("label: 'Raffinerie'");
    expect(source).toContain("label: 'Produits'");
    expect(source).toContain("label: 'Boutique'");
    expect(source).toContain("label: 'Coûts'");
    expect(source).toContain("label: 'Stratégie'");
    expect(source).toContain("data-shell', 'hybrid-sidebar-tabs");
  });

  test('le shell n’invente aucune autorité métier', () => {
    const js = read('public/dashboards/canonical/js/navigation-policy-v4.js');
    const css = read('public/dashboards/canonical/css/canonical-shell-v4.css');
    expect(js).not.toMatch(/\/api\//);
    expect(js).not.toMatch(/price_kmf|supplier_order_identity|UPDATE |INSERT INTO/i);
    expect(css).not.toMatch(/\/api\//);
    expect(css).not.toMatch(/market_id|price_kmf|supplier_order_identity/i);
  });
});
