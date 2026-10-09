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

afterEach(() => {
  delete globalThis.Translator;
  delete globalThis.__KOMERCE_CATALOG_FR_TRANSLATOR__;
});

describe('Canonical Client Router V4.2 — no flash + tabs fonctionnels', () => {
  test('toutes les routes admin portées par les tabs V4 sont routables sans reload document', () => {
    const policy = read('public/dashboards/canonical/js/navigation-policy-v4.js');
    const hrefs = [...policy.matchAll(/href:\s*'([^']+)'/g)].map(match => match[1]);
    // Les cockpits Live (coque noire dédiée) sont des documents complets par
    // conception : ils ne passent volontairement pas par le routeur client.
    const LIVE_DOCUMENT_ROUTES = ['/admin/import-runtime', '/admin/hub-live', '/admin/relais-live'];
    const adminRoutes = hrefs.filter(href => href.startsWith('/admin') && !LIVE_DOCUMENT_ROUTES.includes(href));
    expect(adminRoutes.length).toBeGreaterThan(0);
    adminRoutes.forEach(href => {
      const url = new URL(href, 'https://komerce.test');
      expect(router.canonicalPath(url.pathname)).toBe(true);
    });
  });

  test('/admin/suppliers est une route canonique V4 sans reload document', () => {
    expect(router.canonicalPath('/admin/suppliers')).toBe(true);
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

  test('Atelier économique ne propose plus de tabs vers des sections supprimées', () => {
    const policy = read('public/dashboards/canonical/js/navigation-policy-v4.js');
    const routerSource = read('public/dashboards/canonical/js/canonical-client-router-v4.js');
    const pricingBlock = policy.slice(
      policy.indexOf('pricing: Object.freeze(['),
      policy.indexOf('catalog: Object.freeze([')
    );
    expect(pricingBlock).toContain("id: 'pricing-overview'");
    expect(pricingBlock).not.toContain('pricing-products');
    expect(pricingBlock).not.toContain('pricing-costs');
    expect(pricingBlock).not.toContain('pricing-strategy');
    expect(routerSource).toContain('const PRICING_ANCHORS = Object.freeze({});');
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

  test('une navigation cross-workspace applique le hash après le commit du DOM final', () => {
    const source = read('public/dashboards/canonical/js/canonical-client-router-v4.js');
    const renderIndex = source.indexOf('await app.renderReady(stage, user, adminContext)');
    const commitIndex = source.indexOf('commitStage(doc, oldRoot, stage, user, adminContext, surface, targetUrl)', renderIndex);
    const commitFunctionIndex = source.indexOf('function commitStage');
    const autoHashIndex = source.indexOf("queueMicrotask(() => scrollLocalTarget(doc, targetUrl, { behavior: 'auto' }))", commitFunctionIndex);
    expect(renderIndex).toBeGreaterThanOrEqual(0);
    expect(commitIndex).toBeGreaterThan(renderIndex);
    expect(autoHashIndex).toBeGreaterThan(commitFunctionIndex);
  });

  test('le clic Catalogue préchauffe le traducteur local FR avant la navigation', async () => {
    const create = jest.fn(async () => ({ translate: jest.fn() }));
    globalThis.Translator = { create };

    const primed = router._primeCatalogFrenchTranslator('en-US');
    expect(create).toHaveBeenCalledWith({ sourceLanguage: 'en', targetLanguage: 'fr' });
    expect(globalThis.__KOMERCE_CATALOG_FR_TRANSLATOR__).toMatchObject({
      sourceLanguage: 'en',
      targetLanguage: 'fr',
    });
    await expect(primed).resolves.toEqual(expect.objectContaining({ translate: expect.any(Function) }));

    const source = read('public/dashboards/canonical/js/canonical-client-router-v4.js');
    const primeIndex = source.indexOf("primeCatalogFrenchTranslator('en')");
    const navigateIndex = source.indexOf("navigate(targetUrl).catch", primeIndex);
    expect(primeIndex).toBeGreaterThanOrEqual(0);
    expect(navigateIndex).toBeGreaterThan(primeIndex);
  });

  test('le polish de navigation ne peut plus déplacer verticalement la page', () => {
    const polish = read('public/dashboards/canonical/js/canonical-finish-polish-v1.js');
    expect(polish).toContain('function revealWithoutViewportShift');
    expect(polish).toContain('const top = Number(global.scrollY ?? global.pageYOffset ?? 0)');
    expect(polish).toContain("global.scrollTo({ left, top, behavior: 'auto' })");
    expect(polish).toContain('revealWithoutViewportShift(activeTab');
  });

  test('index charge le routeur après le shell V4', () => {
    const html = read('public/dashboards/canonical/index.html');
    const shell = html.indexOf('/dashboards/canonical/js/navigation-shell-v4-sync.js?v=2101');
    const clientRouter = html.indexOf('/dashboards/canonical/js/canonical-client-router-v4.js?v=261003-2');
    expect(shell).toBeGreaterThanOrEqual(0);
    expect(clientRouter).toBeGreaterThan(shell);
  });
});

test('/admin/providers est une route canonique sans reload document', () => {
  expect(router.canonicalPath('/admin/providers')).toBe(true);
});

test('/admin/users est une route canonique sans reload document', () => {
  expect(router.canonicalPath('/admin/users')).toBe(true);
});
