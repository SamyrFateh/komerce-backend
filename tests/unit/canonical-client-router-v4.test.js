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

describe('Canonical Client Router V4.1 — no flash + tabs fonctionnels', () => {
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

  test('les tabs Catalogue par ancre pointent vers des sections réelles', () => {
    const policy = read('public/dashboards/canonical/js/navigation-policy-v4.js');
    const catalog = read('public/dashboards/canonical/js/catalog-control-tower.js');
    ['catalog-sources', 'catalog-refinery', 'catalog-boutique'].forEach(id => {
      expect(policy).toContain(`#${id}`);
      expect(catalog).toContain(`'${id}'`);
    });
  });

  test('les tabs Atelier économique pointent vers des sections réellement rendues', () => {
    const policy = read('public/dashboards/canonical/js/navigation-policy-v4.js');
    const pricing = read('public/dashboards/canonical/js/pricing-workspace.js');
    const routerSource = read('public/dashboards/canonical/js/canonical-client-router-v4.js');
    const expectations = [
      ['pricing-products', 'Décision produit'],
      ['pricing-costs', 'Atelier des coûts'],
      ['pricing-strategy', 'Stratégie & concurrence'],
    ];
    expectations.forEach(([id, title]) => {
      expect(policy).toContain(`#${id}`);
      expect(pricing).toContain(`'${title}'`);
      expect(routerSource).toContain(`'${id}': '${title}'`);
    });
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
