'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const router = require('../../public/dashboards/canonical/js/canonical-client-router-v4.js');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

describe('Canonical Client Router V4.2 — no flash + tabs fonctionnels', () => {
  test('toutes les routes admin portées par les tabs V4 sont routables sans reload document', () => {
    const policy = read('public/dashboards/canonical/js/navigation-policy-v4.js');
    const hrefs = [...policy.matchAll(/href:\s*'([^']+)'/g)].map(match => match[1]);
    const adminRoutes = hrefs.filter(href => href.startsWith('/admin'));
    expect(adminRoutes.length).toBeGreaterThan(0);
    adminRoutes.forEach(href => {
      const url = new URL(href, 'https://komerce.test');
      expect(router.canonicalPath(url.pathname)).toBe(true);
    });
  });

  test('Catalogue ne répète plus Sources, Raffinerie et Boutique comme onglets', () => {
    const policy = read('public/dashboards/canonical/js/navigation-policy-v4.js');
    const catalogBlock = policy.slice(
      policy.indexOf('catalog: Object.freeze(['),
      policy.indexOf('orders: Object.freeze([')
    );
    expect(catalogBlock).toContain("id: 'catalog-overview'");
    expect(catalogBlock).toContain("id: 'catalog-products'");
    expect(catalogBlock).not.toContain('catalog-sources');
    expect(catalogBlock).not.toContain('catalog-refinery');
    expect(catalogBlock).not.toContain('catalog-boutique');
    expect(catalogBlock).not.toContain('catalog-country');
  });

  test('Catalogue pays appartient au domaine Marchés', () => {
    const policy = read('public/dashboards/canonical/js/navigation-policy-v4.js');
    const marketsBlock = policy.slice(
      policy.indexOf('markets: Object.freeze(['),
      policy.indexOf('const PRICING_SECTION_IDS')
    );
    expect(marketsBlock).toContain("id: 'catalog-country'");
    expect(marketsBlock).toContain('/dashboards/canonical/market-catalog.html');
  });

  test('les tabs Atelier économique pointent vers des sections réellement rendues', () => {
    // pricing-economic-cockpit.js peint le DOM de pricing-workspace.js dans une
    // racine détachée (jamais visible — cf. son doctrine
    // mock_is_ui_contract) ; la vraie surface visible en mode Global est
    // construite par renderOverview() dans pricing-workspace-decision.js,
    // chargé en dernier et qui remplace le rendu précédent. C'est donc ce
    // fichier qu'il faut vérifier, pas pricing-workspace.js.
    const policy = read('public/dashboards/canonical/js/navigation-policy-v4.js');
    const overview = read('public/dashboards/canonical/js/pricing-workspace-decision.js');
    const routerSource = read('public/dashboards/canonical/js/canonical-client-router-v4.js');
    const expectations = [
      ['pricing-products', 'Frontières prix produit'],
      ['pricing-costs', 'Coûts'],
      ['pricing-strategy', 'Stratégie & concurrence'],
    ];
    expectations.forEach(([id, title]) => {
      expect(policy).toContain(`#${id}`);
      expect(overview).toContain(`'${title}'`);
      expect(overview).toContain(`'${id}'`);
    });
    // Le routeur porte son propre libellé (utilisé pour le titre de
    // document/breadcrumb au changement de hash) — distinct du titre visuel
    // de la section elle-même, mais doit rester cohérent avec 'Stratégie & concurrence'.
    expect(routerSource).toContain(`'pricing-strategy': 'Stratégie & concurrence'`);
  });

  test('une navigation locale hash reste dans le même document', () => {
    const from = new URL('https://komerce.test/admin/workspaces/pricing#pricing-products');
    const to = new URL('https://komerce.test/admin/workspaces/pricing#pricing-costs');
    expect(router.sameDocumentScope(from, to)).toBe(true);
    expect(router.sameRoute(from, to)).toBe(true);
  });

  test('un changement N1/N2 admin reste dans le routeur Canonical', () => {
    const from = new URL('https://komerce.test/admin/workspaces/catalog');
    const to = new URL('https://komerce.test/admin/workspaces/pricing');
    expect(router.sameDocumentScope(from, to)).toBe(true);
    expect(router.sameRoute(from, to)).toBe(false);
  });

  test('le rendu cible est préparé avant le commit du root visible', () => {
    const source = read('public/dashboards/canonical/js/canonical-client-router-v4.js');
    const renderIndex = source.indexOf('await app.renderReady(stage, user, adminContext)');
    const commitCallIndex = source.indexOf('commitStage(doc, oldRoot, stage, user, adminContext, surface, targetUrl)', renderIndex);
    const commitFunctionIndex = source.indexOf('function commitStage');
    const swapIndex = source.indexOf('oldRoot.replaceWith(stage)', commitFunctionIndex);
    expect(renderIndex).toBeGreaterThanOrEqual(0);
    expect(commitCallIndex).toBeGreaterThan(renderIndex);
    expect(commitFunctionIndex).toBeGreaterThanOrEqual(0);
    expect(swapIndex).toBeGreaterThan(commitFunctionIndex);
    expect(source).toContain("global.history.pushState({}, '', targetUrl.href)");
    expect(source).not.toMatch(/global\.location\.href\s*=\s*targetUrl/);
  });

  test('index charge le routeur après le shell V4', () => {
    const html = read('public/dashboards/canonical/index.html');
    const shell = html.indexOf('/dashboards/canonical/js/navigation-shell-v4-sync.js?v=2101');
    const clientRouter = html.indexOf('/dashboards/canonical/js/canonical-client-router-v4.js?v=2201');
    expect(shell).toBeGreaterThanOrEqual(0);
    expect(clientRouter).toBeGreaterThan(shell);
  });
});
