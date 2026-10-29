'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const routeSource = fs.readFileSync(path.join(ROOT, 'routes', 'market-delegation-catalog.js'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(ROOT, 'bootstrap', 'api-routes.js'), 'utf8');

describe('market-delegation catalog routes', () => {
  test('all catalog routes are authenticated', () => {
    const routeDeclarations = routeSource.match(/router\.(get|post|put|delete)\([^\n]+/g) || [];
    expect(routeDeclarations).toHaveLength(4);
    expect(routeDeclarations.every(line => line.includes('authenticate'))).toBe(true);
  });

  test('market_id/marketId supplied by client is rejected; marketCode is the only public locator', () => {
    expect(routeSource).toMatch(/MARKET_ID_FORBIDDEN/);
    expect(routeSource).toMatch(/body\.market_id/);
    expect(routeSource).toMatch(/body\.marketId/);
    expect(routeSource).toMatch(/markets\/:marketCode\/catalog\/exposure/);
    expect(routeSource).not.toMatch(/markets\/:marketId\/catalog/);
  });

  test('catalog exposure is capability based, never user role based', () => {
    expect(routeSource).not.toMatch(/requireRole\(/);
    expect(routeSource).not.toMatch(/req\.user\.role\s*===\s*['"]market_operator/);
  });

  test('GET exposure requires catalog.read — universal read, viewer included', () => {
    const getHandler = routeSource.split(`router.put('/markets/:marketCode/catalog/exposure/:productId'`)[0];
    expect(getHandler).toContain(`requiredCapability: 'catalog.read'`);
    expect(getHandler).not.toContain(`requiredCapability: 'catalog.expose'`);
  });

  test('write authority (catalog.expose) is delegated to the service layer, never re-declared in the route', () => {
    // setExposure() (market-delegation-catalog-service.js) owns the
    // 'catalog.expose' requirement — see market-delegation-catalog-service.test.js
    // ("capability absente → 403, aucune écriture tentée"). The route itself
    // must not hardcode a second, possibly diverging capability check.
    expect(routeSource).not.toMatch(/requiredCapability:\s*['"]catalog\.expose['"]/);
  });

  test('GET renvoie le résumé marché, la file certifiée et la projection Prêts à vendre', () => {
    expect(routeSource).toContain('summarizeExposure');
    expect(routeSource).toContain('listReviewQueue');
    expect(routeSource).toContain('listReadyToSell');
    expect(routeSource).toMatch(/incoming_products:\s*reviewQueue\.total/);
    expect(routeSource).toMatch(/ready_to_sell:\s*result\.readyToSell/);
    expect(routeSource).toMatch(/review_queue:\s*result\.reviewQueue/);
  });

  test('la validation marché possède une route explicite, sans market_id client', () => {
    expect(routeSource).toMatch(/router\.post\('\/markets\/:marketCode\/catalog\/review\/:productId\/validate'/);
    expect(routeSource).toContain('validateForMarket');
  });

  test('no DELETE endpoint — exposure toggles, never removes a decision', () => {
    expect(routeSource).not.toMatch(/router\.delete/);
  });

  test('API is mounted exactly once at the composition root', () => {
    expect(bootstrapSource).toMatch(/const marketDelegationCatalogRouter = require\('\.\.\/routes\/market-delegation-catalog'\)/);
    const mounts = bootstrapSource.match(/app\.use\('\/api\/market-delegation', marketDelegationCatalogRouter\)/g) || [];
    expect(mounts).toHaveLength(1);
  });
});

describe('L13 — garde Q2 sur la nouvelle exposition', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'routes/market-delegation-catalog.js'), 'utf8');
  it('refuse une nouvelle exposition (ENABLED) hors marché actif, jamais un masquage', () => {
    expect(src).toContain("assertMarketOperationAllowed(client, req.params.marketCode, 'catalog_exposure_enable')");
    expect(src).toMatch(/body\.commercial_exposure === 'ENABLED'\) await assertMarketOperationAllowed/);
  });
});
