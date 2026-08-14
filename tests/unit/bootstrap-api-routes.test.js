/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : bootstrap/api-routes.js (Lot 0)
 *
 * `bootstrap/api-routes.js` était absent de `collectCoverageFrom` (angle
 * mort structurel, voir AUDIT_TEST_COVERAGE_GLOBAL_2026-07-03.md, Lot 0).
 * C'est le manifeste de montage de TOUTES les routes API — une régression
 * ici (mauvais path, route non montée, ordre cassé) rend l'API entière
 * indisponible sans qu'aucun test de route individuelle ne le détecte.
 *
 * Stratégie : chaque module `routes/*` est mocké par un routeur factice
 * unique (identifiable), pour ne tester QUE le câblage — pas la logique
 * métier de chaque route (déjà couverte ailleurs). On vérifie que chaque
 * `app.use(path, router)` attendu est bien appelé avec le bon path ET le
 * bon module.
 *
 * Run : npx jest tests/unit/bootstrap-api-routes.test.js
 */

'use strict';

// Tous les modules routes/* référencés par bootstrap/api-routes.js (dédupliqués).
const ROUTE_MODULE_NAMES = [
  'admin', 'admin-boutique-categories', 'admin-cost-components', 'admin-costing',
  'admin-customs-categories', 'admin-customs-shipments', 'admin-dashboard',
  'admin-finance-config', 'admin-loyalty', 'admin-pricing-components',
  'admin-pricing-matrices', 'admin-radar', 'admin-risk-provisions', 'admin-rules',
  // O7.3 (provider catalog) : mounté directement par bootstrap/api-routes.js
  // depuis ce lot (plus via routes/admin/index.js). Voir docs/O7_3_BOUNDARY_ANALYSIS.md.
  'admin/catalog-approval',
  'auth', 'auto-distribute-api', 'baskets', 'boutique-suggestions', 'carriers',
  'cash', 'categories', 'client-auth', 'client-tracking', 'dashboard', 'economic',
  'documents', 'finance', 'health', 'hub', 'hub-dashboard', 'hub-mark-ordered', 'inventory-api',
  'invoices', 'logistics', 'loyalty', 'meta-whatsapp', 'modules', 'notification-api',
  'ops-api', 'order-api-v2', 'orders', 'otp', 'parcel-api-v2', 'parcel-label',
  'parcels', 'payments', 'payments-paypal', 'pickup-secret', 'pricing',
  'pricing-strategy', 'products', 'purchasing', 'relais', 'relay-dashboard', 'scans',
  'shares', 'signals', 'simulator', 'sourcing', 'sourcing-scanner', 'tracking',
  'transit-dashboard', 'transitaire-api', 'unsold', 'wallet',
];

const mockMarkers = {};

function registerRouteMocks() {
  ROUTE_MODULE_NAMES.forEach((name) => {
    const marker = { __mockRouter: name };
    mockMarkers[name] = marker;
    jest.doMock(`../../routes/${name}`, () => marker, { virtual: false });
  });
}

function loadApiRoutes() {
  jest.resetModules();
  registerRouteMocks();
  // eslint-disable-next-line global-require
  return require('../../bootstrap/api-routes');
}

function fakeApp() {
  return { use: jest.fn() };
}

describe('bootstrap/api-routes', () => {
  afterEach(() => {
    jest.dontMock;
    jest.resetModules();
  });

  test('expose bien les deux fonctions de montage', () => {
    const apiRoutes = loadApiRoutes();
    expect(typeof apiRoutes.mountApiRoutesBeforeStripeOwnedBlocks).toBe('function');
    expect(typeof apiRoutes.mountApiRoutesAfterStripeOwnedBlocks).toBe('function');
  });

  describe('mountApiRoutesBeforeStripeOwnedBlocks', () => {
    test('monte toutes les routes attendues sur les bons paths', () => {
      const apiRoutes = loadApiRoutes();
      const app = fakeApp();
      apiRoutes.mountApiRoutesBeforeStripeOwnedBlocks(app);

      const expected = [
        ['/api/transit-dashboard', 'transit-dashboard'],
        ['/api/auth', 'auth'],
        ['/api/products', 'products'],
        ['/api/orders', 'orders'],
        ['/api/relais', 'relais'],
        ['/api/admin/finance', 'finance'],
        ['/api/admin/customs-shipments', 'admin-customs-shipments'],
        ['/api/admin/customs-categories', 'admin-customs-categories'],
        ['/api/categories', 'categories'],
        ['/api/admin/boutique-categories', 'admin-boutique-categories'],
        ['/api/boutique/suggestions', 'boutique-suggestions'],
        ['/api/admin/pricing-components', 'admin-pricing-components'],
        ['/api/admin/cost-components', 'admin-cost-components'],
      ];

      expect(app.use).toHaveBeenCalledTimes(expected.length);
      expected.forEach(([path, moduleName]) => {
        expect(app.use).toHaveBeenCalledWith(path, mockMarkers[moduleName]);
      });
    });

    test("ne monte PAS dashboardRouter (retiré du bloc Before — ZG-4)", () => {
      const apiRoutes = loadApiRoutes();
      const app = fakeApp();
      apiRoutes.mountApiRoutesBeforeStripeOwnedBlocks(app);

      const mountedPaths = app.use.mock.calls.map(c => c[0]);
      expect(mountedPaths).not.toContain('/api/admin/pilotage');
      expect(mountedPaths).not.toContain('/api/admin/stats');
      expect(mountedPaths).not.toContain('/api/dashboard');
    });
  });

  describe('mountApiRoutesAfterStripeOwnedBlocks', () => {
    test('monte le routeur admin générique et les routes admin spécialisées', () => {
      const apiRoutes = loadApiRoutes();
      const app = fakeApp();
      apiRoutes.mountApiRoutesAfterStripeOwnedBlocks(app);

      expect(app.use).toHaveBeenCalledWith('/api/admin', mockMarkers['admin']);
      // O7.3 (provider catalog) : mounté directement, plus via routes/admin/index.js.
      expect(app.use).toHaveBeenCalledWith('/api/admin', mockMarkers['admin/catalog-approval']);
      expect(app.use).toHaveBeenCalledWith('/api/admin/rules', mockMarkers['admin-rules']);
      expect(app.use).toHaveBeenCalledWith('/api/admin/radar', mockMarkers['admin-radar']);
      expect(app.use).toHaveBeenCalledWith('/api/admin/risk-provisions', mockMarkers['admin-risk-provisions']);
      expect(app.use).toHaveBeenCalledWith('/api/admin/dashboard', mockMarkers['admin-dashboard']);
      expect(app.use).toHaveBeenCalledWith('/api/admin/costing', mockMarkers['admin-costing']);
      expect(app.use).toHaveBeenCalledWith('/api/dashboard', mockMarkers['dashboard']);
      expect(app.use).toHaveBeenCalledWith('/api/auth/me/documents', mockMarkers['documents']);
    });

    test('parcel-api-v2 est monté AVANT le générique /api/v2 (ordre critique)', () => {
      const apiRoutes = loadApiRoutes();
      const app = fakeApp();
      apiRoutes.mountApiRoutesAfterStripeOwnedBlocks(app);

      const calls = app.use.mock.calls.map(c => c[0]);
      const idxParcelsV2 = calls.indexOf('/api/v2/parcels');
      const idxGenericV2 = calls.indexOf('/api/v2');
      expect(idxParcelsV2).toBeGreaterThanOrEqual(0);
      expect(idxGenericV2).toBeGreaterThanOrEqual(0);
      expect(idxParcelsV2).toBeLessThan(idxGenericV2);
    });

    test('payments/paypal est monté AVANT /api/payments générique (ordre critique — argent)', () => {
      const apiRoutes = loadApiRoutes();
      const app = fakeApp();
      apiRoutes.mountApiRoutesAfterStripeOwnedBlocks(app);

      const calls = app.use.mock.calls.map(c => c[0]);
      const idxPaypal = calls.indexOf('/api/payments/paypal');
      const idxGeneric = calls.indexOf('/api/payments');
      expect(idxPaypal).toBeGreaterThanOrEqual(0);
      expect(idxGeneric).toBeGreaterThanOrEqual(0);
      expect(idxPaypal).toBeLessThan(idxGeneric);
    });

    test('meta-whatsapp est monté en middleware global (sans path explicite)', () => {
      const apiRoutes = loadApiRoutes();
      const app = fakeApp();
      apiRoutes.mountApiRoutesAfterStripeOwnedBlocks(app);

      // app.use(metaWhatsAppRoutes) — un seul argument, pas de path.
      const call = app.use.mock.calls.find(c => c.length === 1 && c[0] === mockMarkers['meta-whatsapp']);
      expect(call).toBeDefined();
    });

    test('/api/finance répond 301 avec redirection vers /api/admin/finance (alias legacy)', () => {
      const apiRoutes = loadApiRoutes();
      const app = fakeApp();
      apiRoutes.mountApiRoutesAfterStripeOwnedBlocks(app);

      const call = app.use.mock.calls.find(c => c[0] === '/api/finance');
      expect(call).toBeDefined();
      const handler = call[1];
      const req = { path: '/summary' };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      handler(req, res);
      expect(res.status).toHaveBeenCalledWith(301);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          redirect: '/api/admin/finance/summary',
        })
      );
    });

    test("ne monte PAS de route pour /api/admin/collective (ZG-3 — system démonté)", () => {
      const apiRoutes = loadApiRoutes();
      const app = fakeApp();
      apiRoutes.mountApiRoutesAfterStripeOwnedBlocks(app);

      const mountedPaths = app.use.mock.calls.map(c => c[0]);
      expect(mountedPaths).not.toContain('/api/admin/collective');
    });

    test('monte hub-mark-ordered et auto-distribute-api sur le même préfixe /api/hub que hub principal', () => {
      const apiRoutes = loadApiRoutes();
      const app = fakeApp();
      apiRoutes.mountApiRoutesAfterStripeOwnedBlocks(app);

      const hubCalls = app.use.mock.calls.filter(c => c[0] === '/api/hub');
      expect(hubCalls.map(c => c[1])).toEqual(
        expect.arrayContaining([
          mockMarkers['hub'],
          mockMarkers['hub-mark-ordered'],
          mockMarkers['auto-distribute-api'],
        ])
      );
    });

    test('simulator est monté à la fois sur /api/simulator et son alias /api/admin/simulator', () => {
      const apiRoutes = loadApiRoutes();
      const app = fakeApp();
      apiRoutes.mountApiRoutesAfterStripeOwnedBlocks(app);

      const paths = app.use.mock.calls
        .filter(c => c[1] === mockMarkers['simulator'])
        .map(c => c[0]);
      expect(paths).toEqual(expect.arrayContaining(['/api/simulator', '/api/admin/simulator']));
    });
  });
});
