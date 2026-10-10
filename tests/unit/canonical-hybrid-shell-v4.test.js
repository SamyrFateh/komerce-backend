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

  test.each(HTML_SURFACES)('%s charge Shell V4 après Theme V2 et une seule Policy de navigation', relative => {
    const html = read(relative);
    const theme = html.search(/\/dashboards\/canonical\/css\/canonical-theme-v2\.css\?v=[^"'<>\s]+/);
    const shell = html.search(/\/dashboards\/canonical\/css\/canonical-shell-v4\.css\?v=[^"'<>\s]+/);
    const v4 = html.search(/\/dashboards\/canonical\/js\/navigation-policy-v4\.js\?v=[^"'<>\s]+/);
    const sync = html.search(/\/dashboards\/canonical\/js\/navigation-shell-v4-sync\.js\?v=[^"'<>\s]+/);
    expect(theme).toBeGreaterThanOrEqual(0);
    expect(shell).toBeGreaterThan(theme);
    expect(html).not.toContain('/dashboards/canonical/js/navigation.js');
    expect(html).not.toContain('/dashboards/canonical/js/navigation-policy-v3.js');
    expect(v4).toBeGreaterThan(shell);
    expect(sync).toBeGreaterThan(v4);
  });

  test('le CSS porte strictement le shell des mocks validés', () => {
    const css = read('public/dashboards/canonical/css/canonical-shell-v4.css');
    expect(css).toContain('--kmc-shell-sidebar-width: 176px');
    expect(css).toContain('--kmc-shell-topbar-height: 52px');
    expect(css).toContain('body.kmc-shell-v4 > .kmc-admin-navigation');
    expect(css).toMatch(/position:\s*fixed/);
    // Fond de la sidebar : la couche Legacy (blanche) gagne la cascade ; le navy du mock n'est plus effectif.
    expect(read('public/dashboards/canonical/css/canonical-legacy-theme-v1.css')).toMatch(/body\.kmc-shell-v4 > \.kmc-admin-navigation\{[^}]*background:#fff/);
    expect(css).toContain('.kmc-admin-topbar');
    expect(css).toContain('.kmc-admin-domain-tabs');
    expect(css).toContain('.kmc-admin-domain-tab.is-active::after');
    expect(css).toMatch(/body\.kmc-shell-v4 \.kmc-ctl-sidebar,[\s\S]*\.kmc-ctl-topbar\s*\{[\s\S]*display:\s*none\s*!important/);
  });

  test('Policy V4 est syntaxiquement valide et formalise les rubriques Catalogue / Atelier', () => {
    const source = read('public/dashboards/canonical/js/navigation-policy-v4.js');
    expect(() => new vm.Script(source)).not.toThrow();
    // Post #1559 (« business truth ») : Sources/Raffinerie/Boutique retirés du
    // menu Catalogue, la nav ne doit plus promettre de destinations qui
    // n'existent pas côté produit — voir @version 2026-09-v4.2-business-truth.
    expect(source).toContain("label: 'Vue catalogue'");
    expect(source).toContain("label: 'Produits'");
    // Atelier prix : plus d'ancres #pricing-* (vue d'ensemble unique).
    expect(source).not.toContain('#pricing-costs');
    expect(source).not.toContain('#pricing-strategy');
    expect(source).not.toContain("label: 'Sources'");
    expect(source).not.toContain("label: 'Raffinerie'");
    expect(source).toContain("data-shell', 'hybrid-sidebar-tabs");
  });

  test('V4 porte seule la taxonomie cible et garde Sourcing/Fournisseurs découvrables', () => {
    const v4 = read('public/dashboards/canonical/js/navigation-policy-v4.js');
    expect(v4).not.toContain('ADMIN_CAPABILITY_GROUPS');
    for (const label of ['Piloter', 'Commerce', 'Opérations', 'Finance', 'Live', 'Marchés', 'Administration']) {
      expect(v4).toContain(`label: '${label}'`);
    }
    expect(v4).toContain("id: 'workspace-sourcing'");
    expect(v4).not.toContain("id: 'entity-suppliers'");
    expect(v4).toContain("surfaces: ['sourcing-workspace', 'supplier-360']");
  });

  test('le sync V4 est syntaxiquement valide et resynchronise après remplacement du header', () => {
    const source = read('public/dashboards/canonical/js/navigation-shell-v4-sync.js');
    expect(() => new vm.Script(source)).not.toThrow();
    expect(source).toContain('let lastHeader = null');
    // Depuis 57896f892 (dédup shell), topbar/domain-tabs sont ciblés via un
    // sélecteur combiné plutôt qu'un id isolé — le comportement (destruction
    // des projections avant reconstruction) est inchangé.
    expect(source).toContain('#canonical-admin-topbar');
    expect(source).toContain('#canonical-admin-domain-tabs');
    expect(source).toContain('nav._applyHybridShell');
    expect(source).toContain('MutationObserver');
  });

  test('le sync rend le marché et le compte au header avant de détruire la topbar (sinon la topbar reconstruite naît sans marché)', () => {
    const source = read('public/dashboards/canonical/js/navigation-shell-v4-sync.js');
    const rescue = source.indexOf("'.kmc-admin-market-control', '.kmc-admin-account'");
    const destroy = source.indexOf('topbars.forEach(node => node.remove');
    expect(rescue).toBeGreaterThan(-1);
    expect(destroy).toBeGreaterThan(rescue);
    expect(source).toContain("header.querySelector?.('.kmc-admin-utility-nav')");
    expect(source).toContain('utilities.prepend(...hosted)');
    // ne duplique jamais un contrôle que le nouveau header possède déjà
    expect(source).toContain('!utilities.querySelector(selector)');
  });

  test('le shell n’invente aucune autorité métier et ne consomme que le resolver canonique read-only', () => {
    const js = read('public/dashboards/canonical/js/navigation-policy-v4.js');
    const sync = read('public/dashboards/canonical/js/navigation-shell-v4-sync.js');
    const css = read('public/dashboards/canonical/css/canonical-shell-v4.css');
    const apiPaths = [...js.matchAll(/['"]((?:\/api\/)[^'"]+)['"]/g)].map(match => match[1]);
    // Hors resolver de référence (read-only), le fichier unique porte seulement
    // les actions de session/staging historiques du header : déconnexion, et
    // Reset/Seed projetés uniquement si le serveur annonce staging (fail-closed).
    expect(apiPaths.sort()).toEqual([
      '/api/admin/dashboard/reference/resolve',
      '/api/admin/reset',
      '/api/admin/seed-test',
      '/api/auth/logout',
    ].sort());
    expect(sync).not.toMatch(/\/api\//);
    expect(js).not.toMatch(/price_kmf|supplier_order_identity|UPDATE |INSERT INTO/i);
    expect(css).not.toMatch(/\/api\//);
    expect(css).not.toMatch(/market_id|price_kmf|supplier_order_identity/i);
  });
});
