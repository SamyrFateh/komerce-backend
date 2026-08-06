/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : bootstrap/html-routes.js (Lot 0)
 *
 * `bootstrap/html-routes.js` était absent de `collectCoverageFrom` (angle
 * mort structurel, Lot 0). Manifeste de routage des pages HTML (boutique,
 * dashboards admin, relais, hub, redirections panier partagé/événement).
 *
 * Stratégie : `app` est un faux objet capturant chaque `app.get(path, handler)`
 * sans monter un vrai serveur Express ni toucher au système de fichiers
 * (`res.sendFile` est mocké — on vérifie l'appel, pas la lecture disque
 * réelle). On teste le câblage des routes ET la logique pure (safeToken,
 * construction des URLs de redirection, gestion ENOENT).
 *
 * Run : npx jest tests/unit/bootstrap-html-routes.test.js
 */

'use strict';

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('../../utils/logger', () => ({ child: () => mockLog }));

const { mountHtmlRoutes } = require('../../bootstrap/html-routes');

const ROOT_DIR = '/fake/root';
const PUBLIC_DIR = require('path').join(ROOT_DIR, 'public');

function fakeApp() {
  const routes = {}; // path -> handler (dernier enregistré, comme Express le ferait au dispatch)
  const allRegistrations = [];
  return {
    get: jest.fn((routePath, handler) => {
      routes[routePath] = handler;
      allRegistrations.push(routePath);
    }),
    _routes: routes,
    _allRegistrations: allRegistrations,
  };
}

function fakeRes() {
  const res = {
    headersSent: false,
    _headers: {},
    setHeader: jest.fn((k, v) => { res._headers[k] = v; }),
    sendFile: jest.fn(),
    redirect: jest.fn(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
    json: jest.fn(),
  };
  return res;
}

describe('bootstrap/html-routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = fakeApp();
    mountHtmlRoutes(app, ROOT_DIR);
  });

  // ── sendHtml (via une route simple) ─────────────────────────────────────
  describe('/s/:token — page de suivi', () => {
    test('sert suivi.html', () => {
      const res = fakeRes();
      app._routes['/s/:token']({ params: { token: 'abc' } }, res);
      expect(res.sendFile).toHaveBeenCalledWith(
        require('path').join(PUBLIC_DIR, 'suivi.html'),
        expect.any(Function)
      );
    });
  });

  describe('sendHtml — comportement générique (via /mon-compte)', () => {
    test('fixe Content-Type et Cache-Control, appelle res.sendFile avec le bon chemin', () => {
      const res = fakeRes();
      app._routes['/mon-compte']({}, res);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8');
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
      expect(res.sendFile).toHaveBeenCalledWith(
        require('path').join(PUBLIC_DIR, 'mon-compte.html'),
        expect.any(Function)
      );
    });

    test('ENOENT → log.error et 404 si les headers ne sont pas encore envoyés', () => {
      const res = fakeRes();
      app._routes['/mon-compte']({}, res);
      const sendFileCallback = res.sendFile.mock.calls[0][1];
      sendFileCallback({ code: 'ENOENT' });
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'ENOENT' }),
        expect.stringMatching(/introuvable/)
      );
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.send).toHaveBeenCalledWith('Page introuvable');
    });

    test('ENOENT mais headers déjà envoyés → pas de double réponse', () => {
      const res = fakeRes();
      res.headersSent = true;
      app._routes['/mon-compte']({}, res);
      const sendFileCallback = res.sendFile.mock.calls[0][1];
      sendFileCallback({ code: 'ENOENT' });
      expect(res.status).not.toHaveBeenCalled();
      expect(res.send).not.toHaveBeenCalled();
    });

    test('erreur non-ENOENT → pas de 404, pas de crash', () => {
      const res = fakeRes();
      app._routes['/mon-compte']({}, res);
      const sendFileCallback = res.sendFile.mock.calls[0][1];
      expect(() => sendFileCallback({ code: 'EACCES' })).not.toThrow();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('pas d’erreur (callback(undefined)) → aucune action supplémentaire', () => {
      const res = fakeRes();
      app._routes['/mon-compte']({}, res);
      const sendFileCallback = res.sendFile.mock.calls[0][1];
      expect(() => sendFileCallback(undefined)).not.toThrow();
      expect(res.status).not.toHaveBeenCalled();
      expect(mockLog.error).not.toHaveBeenCalled();
    });
  });

  // ── safeToken / redirectToGroup (via les routes qui les exercent) ───────
  describe('/c/:token — safeToken + redirection groupe', () => {
    test('token valide (alphanum + tirets) → redirige vers /boutique/?p=...&tab=group', () => {
      const res = fakeRes();
      app._routes['/c/:token']({ params: { token: 'abc-123_XYZ' } }, res);
      expect(res.redirect).toHaveBeenCalledWith(302, '/boutique/?p=abc-123_XYZ&tab=group');
    });

    test('token invalide (caractères interdits) → fallback /Komerce_Boutique.html', () => {
      const res = fakeRes();
      app._routes['/c/:token']({ params: { token: 'abc/../etc' } }, res);
      expect(res.redirect).toHaveBeenCalledWith('/Komerce_Boutique.html');
    });

    test('token trop long (>80 caractères) → fallback', () => {
      const res = fakeRes();
      const longToken = 'a'.repeat(81);
      app._routes['/c/:token']({ params: { token: longToken } }, res);
      expect(res.redirect).toHaveBeenCalledWith('/Komerce_Boutique.html');
    });

    test('token de 80 caractères exactement → accepté (limite inclusive)', () => {
      const res = fakeRes();
      const token80 = 'a'.repeat(80);
      app._routes['/c/:token']({ params: { token: token80 } }, res);
      expect(res.redirect).toHaveBeenCalledWith(302, `/boutique/?p=${token80}&tab=group`);
    });

    test('token vide/absent → fallback', () => {
      const res = fakeRes();
      app._routes['/c/:token']({ params: {} }, res);
      expect(res.redirect).toHaveBeenCalledWith('/Komerce_Boutique.html');
    });
  });

  describe('/cart/shared/success et /cancel — extra param shared_payment', () => {
    test('success : query.p prioritaire, extra=success', () => {
      const res = fakeRes();
      app._routes['/cart/shared/success']({ query: { p: 'tok1', token: 'tok2' } }, res);
      expect(res.redirect).toHaveBeenCalledWith(
        302, '/boutique/?p=tok1&shared_payment=success&tab=group'
      );
    });

    test('success : fallback sur query.token si query.p absent', () => {
      const res = fakeRes();
      app._routes['/cart/shared/success']({ query: { token: 'tok2' } }, res);
      expect(res.redirect).toHaveBeenCalledWith(
        302, '/boutique/?p=tok2&shared_payment=success&tab=group'
      );
    });

    test('cancel : extra=cancel', () => {
      const res = fakeRes();
      app._routes['/cart/shared/cancel']({ query: { p: 'tok1' } }, res);
      expect(res.redirect).toHaveBeenCalledWith(
        302, '/boutique/?p=tok1&shared_payment=cancel&tab=group'
      );
    });

    test('cancel : fallback sur query.token si query.p absent', () => {
      const res = fakeRes();
      app._routes['/cart/shared/cancel']({ query: { token: 'tok2' } }, res);
      expect(res.redirect).toHaveBeenCalledWith(
        302, '/boutique/?p=tok2&shared_payment=cancel&tab=group'
      );
    });
  });

  describe('/cart/shared/:token — sans extra param', () => {
    test('redirige sans shared_payment', () => {
      const res = fakeRes();
      app._routes['/cart/shared/:token']({ params: { token: 'tok3' } }, res);
      expect(res.redirect).toHaveBeenCalledWith(302, '/boutique/?p=tok3&tab=group');
    });
  });

  describe('/cart/shared et /account/shared-carts — ordre de priorité p > token > share', () => {
    test('/cart/shared : utilise query.share en dernier recours', () => {
      const res = fakeRes();
      app._routes['/cart/shared']({ query: { share: 'tok4' } }, res);
      expect(res.redirect).toHaveBeenCalledWith(302, '/boutique/?p=tok4&tab=group');
    });

    test('/account/shared-carts : même logique de priorité', () => {
      const res = fakeRes();
      app._routes['/account/shared-carts']({ query: { p: 'tokA', token: 'tokB', share: 'tokC' } }, res);
      expect(res.redirect).toHaveBeenCalledWith(302, '/boutique/?p=tokA&tab=group');
    });

    test('/account/shared-carts : fallback sur query.token si query.p absent', () => {
      const res = fakeRes();
      app._routes['/account/shared-carts']({ query: { token: 'tokB' } }, res);
      expect(res.redirect).toHaveBeenCalledWith(302, '/boutique/?p=tokB&tab=group');
    });

    test('/account/shared-carts : fallback sur query.share en dernier recours', () => {
      const res = fakeRes();
      app._routes['/account/shared-carts']({ query: { share: 'tokC' } }, res);
      expect(res.redirect).toHaveBeenCalledWith(302, '/boutique/?p=tokC&tab=group');
    });

    test('aucun paramètre → redirection sans p (token vide)', () => {
      const res = fakeRes();
      app._routes['/cart/shared']({ query: {} }, res);
      expect(res.redirect).toHaveBeenCalledWith(302, '/boutique/?tab=group');
    });
  });

  // ── Dashboards admin ──────────────────────────────────────────────────
  describe('routes dashboard admin', () => {
    const EXPECTED_ADMIN_PATHS = [
      '/admin/pilotage', '/admin/control-tower', '/admin/costing',
      '/admin/orders-logistics', '/admin/sourcing',
      '/admin/sourcing-scanner', '/admin/pricing', '/admin/pricing-workshop',
      '/admin/pricing-strategy', '/admin/customs', '/admin/suppliers',
      '/admin/alerts', '/admin/categories', '/admin/products', '/admin/sales',
      '/admin/clients', '/admin/problems', '/admin/hub-relais',
      '/admin/transitaire', '/admin/inventory', '/admin/economic',
      '/admin/pilotage-fin', '/admin/invoices', '/admin/sante',
      '/admin/shared-carts', '/admin/economic-flow', '/admin/accounting',
      '/admin/settings', '/admin/simulator',
    ];

    test('les 30 chemins admin sont bien enregistrés', () => {
      EXPECTED_ADMIN_PATHS.forEach(p => {
        expect(app._allRegistrations).toContain(p);
      });
      expect(EXPECTED_ADMIN_PATHS).toHaveLength(29);
    });

    test('chaque chemin admin sert dashboards/admin/index.html', () => {
      const res = fakeRes();
      app._routes['/admin/pilotage']({}, res);
      expect(res.sendFile).toHaveBeenCalledWith(
        require('path').join(PUBLIC_DIR, 'dashboards', 'admin', 'index.html'),
        expect.any(Function)
      );
    });

    test('un second chemin admin au hasard sert bien le même index.html (pas de copier-coller cassé)', () => {
      const res = fakeRes();
      app._routes['/admin/simulator']({}, res);
      expect(res.sendFile).toHaveBeenCalledWith(
        require('path').join(PUBLIC_DIR, 'dashboards', 'admin', 'index.html'),
        expect.any(Function)
      );
    });
  });

  describe('/portail et /pilotage — portail de pilotage', () => {
    test.each(['/portail', '/pilotage'])('%s sert portal-pilotage.html', (routePath) => {
      const res = fakeRes();
      app._routes[routePath]({}, res);
      expect(res.sendFile).toHaveBeenCalledWith(
        require('path').join(PUBLIC_DIR, 'dashboards', 'admin', 'portal-pilotage.html'),
        expect.any(Function)
      );
    });
  });

  describe('/control-tower.html — legacy conditionné par ADMIN_LEGACY_ENABLED', () => {
    const ORIGINAL_ENV = process.env;
    afterEach(() => { process.env = ORIGINAL_ENV; });

    test("ADMIN_LEGACY_ENABLED='1' → sert la page legacy avec header X-Deprecated", () => {
      process.env = { ...ORIGINAL_ENV, ADMIN_LEGACY_ENABLED: '1' };
      const res = fakeRes();
      app._routes['/control-tower.html']({}, res);
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Deprecated', expect.stringMatching(/control-tower\.html/)
      );
      expect(res.sendFile).toHaveBeenCalledWith(
        require('path').join(PUBLIC_DIR, 'dashboards', 'admin-legacy', 'control-tower.html'),
        expect.any(Function)
      );
      expect(res.redirect).not.toHaveBeenCalled();
    });

    test('sans la variable → redirection 301 vers /admin/pilotage', () => {
      process.env = { ...ORIGINAL_ENV };
      delete process.env.ADMIN_LEGACY_ENABLED;
      const res = fakeRes();
      app._routes['/control-tower.html']({}, res);
      expect(res.redirect).toHaveBeenCalledWith(301, '/admin/pilotage');
      expect(res.sendFile).not.toHaveBeenCalled();
    });

    test("ADMIN_LEGACY_ENABLED='0' (autre valeur) → redirection aussi (comparaison stricte à '1')", () => {
      process.env = { ...ORIGINAL_ENV, ADMIN_LEGACY_ENABLED: '0' };
      const res = fakeRes();
      app._routes['/control-tower.html']({}, res);
      expect(res.redirect).toHaveBeenCalledWith(301, '/admin/pilotage');
    });
  });

  describe('relais / hub', () => {
    test.each(['/Komerce_Relais.html', '/relais'])('%s sert relais/index.html', (routePath) => {
      const res = fakeRes();
      app._routes[routePath]({}, res);
      expect(res.sendFile).toHaveBeenCalledWith(
        require('path').join(PUBLIC_DIR, 'relais', 'index.html'),
        expect.any(Function)
      );
    });

    test('/hub sert hub/index.html', () => {
      const res = fakeRes();
      app._routes['/hub']({}, res);
      expect(res.sendFile).toHaveBeenCalledWith(
        require('path').join(PUBLIC_DIR, 'hub', 'index.html'),
        expect.any(Function)
      );
    });
  });

  describe('routes /event/* et /workspace/:publicToken — redirection boutique', () => {
    test.each([
      '/event/create',
      '/event/manage/:creatorToken',
      '/event/w/:publicToken',
      '/event/pay/:paymentToken',
      '/event/:creatorToken/manage',
      '/workspace/:publicToken',
    ])('%s redirige (302) vers /boutique', (routePath) => {
      const res = fakeRes();
      app._routes[routePath]({}, res);
      expect(res.redirect).toHaveBeenCalledWith(302, '/boutique');
    });
  });

  describe('boutique / login', () => {
    test.each(['/Komerce_Boutique.html', '/boutique'])('%s sert boutique/index.html', (routePath) => {
      const res = fakeRes();
      app._routes[routePath]({}, res);
      expect(res.sendFile).toHaveBeenCalledWith(
        require('path').join(PUBLIC_DIR, 'boutique', 'index.html'),
        expect.any(Function)
      );
    });

    test('/login.html sert login.html', () => {
      const res = fakeRes();
      app._routes['/login.html']({}, res);
      expect(res.sendFile).toHaveBeenCalledWith(
        require('path').join(PUBLIC_DIR, 'login.html'),
        expect.any(Function)
      );
    });
  });

  describe('catch-all *', () => {
    test('requête /api/* inconnue → 404 JSON, pas de sendFile', () => {
      const res = fakeRes();
      app._routes['*']({ path: '/api/does-not-exist' }, res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Endpoint introuvable' });
      expect(res.sendFile).not.toHaveBeenCalled();
    });

    test('requête non-API inconnue → sert boutique/index.html (fallback SPA)', () => {
      const res = fakeRes();
      app._routes['*']({ path: '/une-route-inconnue' }, res);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8');
      expect(res.sendFile).toHaveBeenCalledWith(
        require('path').join(PUBLIC_DIR, 'boutique', 'index.html')
      );
      // Contrairement à sendHtml(), le catch-all n'a pas de callback ENOENT dédié.
      expect(res.sendFile.mock.calls[0].length).toBe(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  // ── Câblage global ────────────────────────────────────────────────────
  test('mountHtmlRoutes enregistre bien toutes les routes attendues (pas de doublon accidentel sur *)', () => {
    const wildcardRegistrations = app._allRegistrations.filter(p => p === '*');
    expect(wildcardRegistrations).toHaveLength(1);
    expect(app._allRegistrations[app._allRegistrations.length - 1]).toBe('*'); // catch-all monté en dernier
  });
});
