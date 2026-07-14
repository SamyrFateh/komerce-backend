/**
 * KOMERCE — Tests Unitaires : bootstrap/security.js (Lot 0)
 *
 * `bootstrap/security.js` était absent de `collectCoverageFrom` (angle mort
 * structurel, Lot 0). Configuration CORS + Helmet (CSP) — une régression ici
 * ouvre soit une faille CORS (origin non filtrée), soit une faille CSP
 * (script-src trop permissif).
 *
 * `cors` et `helmet` sont mockés pour `applySecurity` (on teste le câblage,
 * pas leurs librairies elles-mêmes). Les fonctions pures (`isAllowedOrigin`,
 * `buildCorsOptions`, `buildHelmetOptions`) sont testées directement.
 *
 * Run : npx jest tests/unit/bootstrap-security.test.js
 */

'use strict';

const mockHelmetMiddleware = { __mock: 'helmet-middleware' };
const mockHelmetFactory = jest.fn(() => mockHelmetMiddleware);
jest.mock('helmet', () => (...args) => mockHelmetFactory(...args));

const mockCorsMiddleware = { __mock: 'cors-middleware' };
const mockCorsFactory = jest.fn(() => mockCorsMiddleware);
jest.mock('cors', () => (...args) => mockCorsFactory(...args));

const {
  isAllowedOrigin,
  buildCorsOptions,
  buildHelmetOptions,
  applySecurity,
} = require('../../bootstrap/security');

describe('bootstrap/security', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.FRONTEND_URL;
    delete process.env.ALLOWED_ORIGINS;
    delete process.env.NODE_ENV;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('isAllowedOrigin', () => {
    test('origin absente (requêtes same-origin / server-to-server) → toujours autorisée', () => {
      expect(isAllowedOrigin(undefined)).toBe(true);
      expect(isAllowedOrigin(null)).toBe(true);
      expect(isAllowedOrigin('')).toBe(true);
    });

    test('localhost autorisé hors production, avec ou sans port', () => {
      process.env.NODE_ENV = 'development';
      expect(isAllowedOrigin('http://localhost')).toBe(true);
      expect(isAllowedOrigin('http://localhost:3000')).toBe(true);
      expect(isAllowedOrigin('https://localhost:8080')).toBe(true);
    });

    test('localhost REFUSÉ en production, sauf s’il matche frontendUrl/allowedOrigins', () => {
      process.env.NODE_ENV = 'production';
      expect(isAllowedOrigin('http://localhost:3000')).toBe(false);
    });

    test('NODE_ENV non défini (undefined) → traité comme hors-production (localhost autorisé)', () => {
      delete process.env.NODE_ENV;
      expect(isAllowedOrigin('http://localhost:3000')).toBe(true);
    });

    test('origin correspondant exactement à frontendUrl → autorisée', () => {
      expect(isAllowedOrigin('https://komerce.km', 'https://komerce.km')).toBe(true);
    });

    test('origin ne correspondant pas à frontendUrl et absente de allowedOrigins → refusée', () => {
      expect(isAllowedOrigin('https://evil.com', 'https://komerce.km')).toBe(false);
    });

    test('origin présente dans allowedOrigins (liste CSV) → autorisée', () => {
      expect(isAllowedOrigin('https://partner.km', '', 'https://a.km,https://partner.km,https://b.km')).toBe(true);
    });

    test('allowedOrigins avec espaces autour des virgules → trim appliqué', () => {
      expect(isAllowedOrigin('https://partner.km', '', ' https://a.km , https://partner.km , https://b.km ')).toBe(true);
    });

    test('allowedOrigins avec entrées vides (double virgule) → ignorées sans planter', () => {
      expect(() => isAllowedOrigin('https://x.km', '', 'https://a.km,,https://b.km')).not.toThrow();
      expect(isAllowedOrigin('https://x.km', '', 'https://a.km,,https://b.km')).toBe(false);
    });

    test('origin absente de toutes les listes → refusée', () => {
      expect(isAllowedOrigin('https://random-site.com', 'https://komerce.km', 'https://a.km,https://b.km')).toBe(false);
    });

    test('utilise process.env.FRONTEND_URL / ALLOWED_ORIGINS par défaut si non passés explicitement', () => {
      process.env.FRONTEND_URL = 'https://komerce.km';
      expect(isAllowedOrigin('https://komerce.km')).toBe(true);

      process.env.ALLOWED_ORIGINS = 'https://partner.km';
      expect(isAllowedOrigin('https://partner.km')).toBe(true);
      expect(isAllowedOrigin('https://not-listed.com')).toBe(false);
    });

    test('un domaine qui CONTIENT "localhost" sans être exactement le pattern est refusé', () => {
      process.env.NODE_ENV = 'development';
      expect(isAllowedOrigin('http://notlocalhost.com')).toBe(false);
      expect(isAllowedOrigin('http://evil.com/localhost')).toBe(false);
    });

    // BUGFIX 2026-07 — régression Safari : requêtes fetch same-origin
    // credentialed avec Origin envoyée, et FRONTEND_URL absente/mal
    // configurée en production. Voir commentaire DEFAULT_ALLOWED_ORIGINS
    // dans bootstrap/security.js.
    test('komerce.co est toujours autorisé, même sans FRONTEND_URL/ALLOWED_ORIGINS configurées (prod)', () => {
      process.env.NODE_ENV = 'production';
      expect(isAllowedOrigin('https://komerce.co')).toBe(true);
      expect(isAllowedOrigin('https://www.komerce.co')).toBe(true);
    });

    test('le filet de sécurité komerce.co ne contourne pas le refus des autres origines', () => {
      process.env.NODE_ENV = 'production';
      expect(isAllowedOrigin('https://komerce.co.evil.com')).toBe(false);
      expect(isAllowedOrigin('https://evil.com')).toBe(false);
    });
  });

  describe('buildCorsOptions', () => {
    test('expose credentials: true et les méthodes HTTP attendues', () => {
      const opts = buildCorsOptions();
      expect(opts.credentials).toBe(true);
      expect(opts.methods).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
    });

    test('origin callback : autorise (callback(null, true)) pour une origin permise', () => {
      process.env.NODE_ENV = 'development';
      const opts = buildCorsOptions();
      const callback = jest.fn();
      opts.origin('http://localhost:3000', callback);
      expect(callback).toHaveBeenCalledWith(null, true);
    });

    test('origin callback : refuse avec une Error explicite pour une origin non permise', () => {
      process.env.NODE_ENV = 'production';
      const opts = buildCorsOptions();
      const callback = jest.fn();
      opts.origin('https://evil.com', callback);
      expect(callback).toHaveBeenCalledTimes(1);
      const [err, allowed] = callback.mock.calls[0];
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toMatch(/Not allowed by CORS: https:\/\/evil\.com/);
      expect(allowed).toBeUndefined();
    });

    test('origin callback : origin absente → toujours autorisée', () => {
      const opts = buildCorsOptions();
      const callback = jest.fn();
      opts.origin(undefined, callback);
      expect(callback).toHaveBeenCalledWith(null, true);
    });
  });

  describe('buildHelmetOptions — directives CSP critiques', () => {
    let csp;
    beforeEach(() => {
      csp = buildHelmetOptions().contentSecurityPolicy.directives;
    });

    test('objectSrc et frameAncestors sont bien "none" (anti-clickjacking / anti-plugin)', () => {
      expect(csp.objectSrc).toEqual(["'none'"]);
      expect(csp.frameAncestors).toEqual(["'none'"]);
    });

    test('scriptSrcAttr est "none" — pas de handlers inline (FRESH-030)', () => {
      expect(csp.scriptSrcAttr).toEqual(["'none'"]);
    });

    test('scriptSrc ne contient PAS \'unsafe-inline\' (régression de sécurité)', () => {
      expect(csp.scriptSrc).not.toContain("'unsafe-inline'");
    });

    test('scriptSrc autorise les CDN et fournisseurs de paiement attendus', () => {
      expect(csp.scriptSrc).toEqual(
        expect.arrayContaining([
          "'self'",
          'https://cdnjs.cloudflare.com',
          'https://js.stripe.com',
          'https://www.paypal.com',
        ])
      );
    });

    test('defaultSrc et baseUri restreints à self', () => {
      expect(csp.defaultSrc).toEqual(["'self'"]);
      expect(csp.baseUri).toEqual(["'self'"]);
    });

    test('connectSrc autorise les endpoints Stripe et PayPal (API + sandbox)', () => {
      expect(csp.connectSrc).toEqual(
        expect.arrayContaining([
          'https://api.stripe.com',
          'https://api.paypal.com',
          'https://api.sandbox.paypal.com',
        ])
      );
    });
  });

  describe('applySecurity — câblage sur l’app Express', () => {
    test('monte helmet() PUIS cors() dans cet ordre, avec les bonnes options', () => {
      const app = { use: jest.fn() };
      applySecurity(app);

      expect(mockHelmetFactory).toHaveBeenCalledTimes(1);
      expect(mockHelmetFactory.mock.calls[0][0]).toEqual(buildHelmetOptions());

      expect(mockCorsFactory).toHaveBeenCalledTimes(1);
      const corsCallArg = mockCorsFactory.mock.calls[0][0];
      expect(corsCallArg.credentials).toBe(true);
      expect(typeof corsCallArg.origin).toBe('function');

      expect(app.use).toHaveBeenNthCalledWith(1, mockHelmetMiddleware);
      expect(app.use).toHaveBeenNthCalledWith(2, mockCorsMiddleware);
    });
  });
});
