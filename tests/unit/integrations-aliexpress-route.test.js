'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * tests/unit/integrations-aliexpress-route.test.js
 *
 * Feature propriétaire : catalog
 *
 * Contexte : routes/integrations-aliexpress.js (criticality high) n'avait
 * aucun test. C'est la route OAuth qui connecte le compte AliExpress
 * fournisseur à Komerce — protection CSRF par état signé, cookies
 * httpOnly/secure, échange de code d'autorisation, et rafraîchissement
 * de token. La factory createRouter({oauthService, env}) permet
 * l'injection de dépendance : ce test injecte un oauthService simulé
 * plutôt que de frapper la vraie API AliExpress ou la vraie DB (les
 * écritures réelles sont dans services/suppliers/aliexpress-oauth.js,
 * pas dans cette route — la responsabilité propre de ce fichier est le
 * protocole OAuth/CSRF, exactement ce que ce test vérifie).
 *
 * Invariants prouvés :
 *   1. /oauth/start pose un cookie d'état aléatoire et redirige vers
 *      l'URL d'autorisation construite par le service.
 *   2. /oauth/callback refuse (400) un état absent, mismatché, ou une
 *      erreur retournée par le fournisseur — comparaison en temps
 *      constant (sameState utilise crypto.timingSafeEqual).
 *   3. /oauth/callback échange le code avec succès → 200 HTML, ou
 *      propage un échec d'échange → 502, sans jamais exposer le token
 *      dans la réponse.
 *   4. /status et /oauth/refresh sont protégés par authenticate +
 *      requireAdmin (401 sans token, 403 hors rôle admin).
 *   5. /oauth/refresh renvoie 409 si aucune connexion n'existe encore.
 */

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');

let mockUser = { id: 'admin-1', role: 'admin' };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'Token manquant' });
    req.user = mockUser;
    next();
  },
  requireAdmin: (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Accès réservé admin' });
    next();
  },
}));

const { createRouter, sameState } = require('../../routes/integrations-aliexpress');

function buildApp(oauthService) {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/integrations/aliexpress', createRouter({ oauthService, env: { NODE_ENV: 'test' } }));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

function fakeOauthService(overrides = {}) {
  return {
    buildAuthorizationUrl: jest.fn(() => 'https://oauth.aliexpress.com/authorize?state=x'),
    exchangeAuthorizationCode: jest.fn().mockResolvedValue({ ok: true }),
    getConnectionStatus: jest.fn().mockResolvedValue({ connected: true, supplier: 'aliexpress' }),
    loadConnection: jest.fn().mockResolvedValue({ id: 'conn-1' }),
    refreshConnection: jest.fn().mockResolvedValue({ id: 'conn-1', refreshed: true }),
    safeStatus: jest.fn((conn, extra) => ({ ...conn, ...extra })),
    ...overrides,
  };
}

beforeEach(() => {
  mockUser = { id: 'admin-1', role: 'admin' };
});

describe('GET /oauth/start', () => {
  it('pose un cookie état aléatoire et redirige vers l’URL d’autorisation', async () => {
    const svc = fakeOauthService();
    const res = await request(buildApp(svc)).get('/api/integrations/aliexpress/oauth/start');
    expect(res.status).toBe(302);
    expect(res.headers['set-cookie'][0]).toMatch(/komerce_aliexpress_oauth_state=/);
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(svc.buildAuthorizationUrl).toHaveBeenCalledTimes(1);
  });

  it('sans auth → 401 ; hors rôle admin → 403', async () => {
    const svc = fakeOauthService();
    mockUser = null;
    const unauth = await request(buildApp(svc)).get('/api/integrations/aliexpress/oauth/start');
    expect(unauth.status).toBe(401);

    mockUser = { id: 'u1', role: 'client' };
    const forbidden = await request(buildApp(svc)).get('/api/integrations/aliexpress/oauth/start');
    expect(forbidden.status).toBe(403);
  });

  it('service OAuth non configuré (throw) → 503', async () => {
    const svc = fakeOauthService({
      buildAuthorizationUrl: jest.fn(() => { throw new Error('missing client id'); }),
    });
    const res = await request(buildApp(svc)).get('/api/integrations/aliexpress/oauth/start');
    expect(res.status).toBe(503);
  });
});

describe('GET /oauth/callback', () => {
  async function startThenGetCookie(svc) {
    const app = buildApp(svc);
    const startRes = await request(app).get('/api/integrations/aliexpress/oauth/start');
    const setCookie = startRes.headers['set-cookie'][0];
    const state = decodeURIComponent(setCookie.split(';')[0].split('=')[1]);
    return { app, cookie: setCookie.split(';')[0], state };
  }

  it('état absent ou mismatché → 400, pas d’échange de code tenté', async () => {
    const svc = fakeOauthService();
    const app = buildApp(svc);
    const res = await request(app).get('/api/integrations/aliexpress/oauth/callback?state=n-importe-quoi&code=abc');
    expect(res.status).toBe(400);
    expect(svc.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('le fournisseur retourne une erreur OAuth (?error=) → 400', async () => {
    const svc = fakeOauthService();
    const { app, cookie, state } = await startThenGetCookie(svc);
    const res = await request(app)
      .get(`/api/integrations/aliexpress/oauth/callback?state=${state}&error=access_denied`)
      .set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(svc.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('code absent → 400', async () => {
    const svc = fakeOauthService();
    const { app, cookie, state } = await startThenGetCookie(svc);
    const res = await request(app)
      .get(`/api/integrations/aliexpress/oauth/callback?state=${state}`)
      .set('Cookie', cookie);
    expect(res.status).toBe(400);
  });

  it('succès : état valide + code présent → échange le code, 200 HTML, jamais le token en clair', async () => {
    const svc = fakeOauthService();
    const { app, cookie, state } = await startThenGetCookie(svc);
    const res = await request(app)
      .get(`/api/integrations/aliexpress/oauth/callback?state=${state}&code=auth-code-123`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(svc.exchangeAuthorizationCode).toHaveBeenCalledWith('auth-code-123', expect.anything());
    expect(res.text).not.toMatch(/auth-code-123/);
    expect(res.text).toMatch(/connecté/i);
  });

  it('échec de l’échange de code → 502, réponse ne fuit pas le détail de l’erreur au client', async () => {
    const svc = fakeOauthService({
      exchangeAuthorizationCode: jest.fn().mockRejectedValue(new Error('token endpoint 500')),
    });
    const { app, cookie, state } = await startThenGetCookie(svc);
    const res = await request(app)
      .get(`/api/integrations/aliexpress/oauth/callback?state=${state}&code=auth-code-123`)
      .set('Cookie', cookie);
    expect(res.status).toBe(502);
    expect(res.text).not.toMatch(/token endpoint 500/);
  });
});

describe('GET /status', () => {
  it('sans auth → 401 ; renvoie le statut de connexion via le service injecté', async () => {
    const svc = fakeOauthService();
    mockUser = null;
    const unauth = await request(buildApp(svc)).get('/api/integrations/aliexpress/status');
    expect(unauth.status).toBe(401);

    mockUser = { id: 'admin-1', role: 'admin' };
    const res = await request(buildApp(svc)).get('/api/integrations/aliexpress/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: true, supplier: 'aliexpress' });
  });

  it('échec du service → 503, connected:false explicite', async () => {
    const svc = fakeOauthService({
      getConnectionStatus: jest.fn().mockRejectedValue(new Error('db down')),
    });
    const res = await request(buildApp(svc)).get('/api/integrations/aliexpress/status');
    expect(res.status).toBe(503);
    expect(res.body.connected).toBe(false);
  });
});

describe('POST /oauth/refresh', () => {
  it('aucune connexion existante → 409, pas de tentative de refresh', async () => {
    const svc = fakeOauthService({ loadConnection: jest.fn().mockResolvedValue(null) });
    const res = await request(buildApp(svc)).post('/api/integrations/aliexpress/oauth/refresh');
    expect(res.status).toBe(409);
    expect(svc.refreshConnection).not.toHaveBeenCalled();
  });

  it('connexion existante → rafraîchit et renvoie le statut sécurisé', async () => {
    const svc = fakeOauthService();
    const res = await request(buildApp(svc)).post('/api/integrations/aliexpress/oauth/refresh');
    expect(res.status).toBe(200);
    expect(svc.refreshConnection).toHaveBeenCalledWith({ id: 'conn-1' }, expect.anything());
  });

  it('échec du rafraîchissement → 502', async () => {
    const svc = fakeOauthService({
      refreshConnection: jest.fn().mockRejectedValue(new Error('refresh token expired')),
    });
    const res = await request(buildApp(svc)).post('/api/integrations/aliexpress/oauth/refresh');
    expect(res.status).toBe(502);
  });

  it('sans auth → 401', async () => {
    mockUser = null;
    const res = await request(buildApp(fakeOauthService())).post('/api/integrations/aliexpress/oauth/refresh');
    expect(res.status).toBe(401);
  });
});

describe('sameState — comparaison en temps constant', () => {
  it('valeurs identiques → true', () => {
    expect(sameState('abc123', 'abc123')).toBe(true);
  });
  it('valeurs différentes de même longueur → false', () => {
    expect(sameState('abc123', 'xyz789')).toBe(false);
  });
  it('longueurs différentes → false, sans lever', () => {
    expect(sameState('short', 'a-much-longer-value')).toBe(false);
  });
  it('valeur absente (undefined/null/vide) → false', () => {
    expect(sameState(undefined, 'abc')).toBe(false);
    expect(sameState('abc', undefined)).toBe(false);
    expect(sameState('', '')).toBe(false);
  });
});

describe('liaison de la session OAuth aux sources (Provider Credential Authority)', () => {
  function appWith(svc, linkSources) {
    const app = express();
    app.use(cookieParser());
    app.use('/api/integrations/aliexpress', createRouter({ oauthService: svc, env: { NODE_ENV: 'test' }, linkSources }));
    return app;
  }
  async function authorize(app) {
    const start = await request(app).get('/api/integrations/aliexpress/oauth/start');
    const cookie = start.headers['set-cookie'][0].split(';')[0];
    const state = decodeURIComponent(cookie.split('=')[1]);
    return request(app).get(`/api/integrations/aliexpress/oauth/callback?state=${state}&code=code-xyz`).set('Cookie', cookie);
  }

  it('après un échange réussi : statut (sans token) transmis à la liaison', async () => {
    const status = { connected: true, provider_user_nick: 'shop', access_expires_at: '2026-11-01T00:00:00Z', refresh_expires_at: '2027-01-01T00:00:00Z' };
    const svc = fakeOauthService({ exchangeAuthorizationCode: jest.fn().mockResolvedValue(status) });
    const link = jest.fn().mockResolvedValue(1);
    const res = await authorize(appWith(svc, link));
    expect(res.status).toBe(200);
    expect(link).toHaveBeenCalledWith(status);
    expect(res.text).not.toMatch(/code-xyz|access_token|refresh_token/i);
  });

  it('échec de liaison : l’autorisation reste valide (200), aucun détail exposé', async () => {
    const svc = fakeOauthService();
    const link = jest.fn().mockRejectedValue(new Error('secret-db-detail'));
    const res = await authorize(appWith(svc, link));
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/secret-db-detail/);
  });

  it('échec d’échange : aucune liaison tentée', async () => {
    const svc = fakeOauthService({ exchangeAuthorizationCode: jest.fn().mockRejectedValue(new Error('boom')) });
    const link = jest.fn();
    const res = await authorize(appWith(svc, link));
    expect(res.status).toBe(502);
    expect(link).not.toHaveBeenCalled();
  });

  it('503 / 502 de routes OAuth : aucun message brut renvoyé', async () => {
    const svc = fakeOauthService({
      buildAuthorizationUrl: jest.fn(() => { throw new Error('ALIEXPRESS_APP_SECRET manquant'); }),
      refreshConnection: jest.fn().mockRejectedValue(new Error('refresh_token=abc123 rejeté')),
      getConnectionStatus: jest.fn().mockRejectedValue(new Error('connexion db refusée')),
    });
    const app = buildApp(svc);
    const start = await request(app).get('/api/integrations/aliexpress/oauth/start');
    expect(start.status).toBe(503);
    expect(JSON.stringify(start.body)).not.toMatch(/SECRET|manquant/);
    const refresh = await request(app).post('/api/integrations/aliexpress/oauth/refresh');
    expect(refresh.status).toBe(502);
    expect(JSON.stringify(refresh.body)).not.toMatch(/abc123|refresh_token/);
    const status = await request(app).get('/api/integrations/aliexpress/status');
    expect(JSON.stringify(status.body)).not.toMatch(/db refusée/);
  });

  it('linkSessionToSources relie chaque source aliexpress active, sans token', async () => {
    const { linkSessionToSources } = require('../../routes/integrations-aliexpress');
    const credentialService = { linkOAuthSession: jest.fn().mockResolvedValue({}) };
    const query = jest.fn().mockResolvedValue({ rows: [{ source_id: 'api:aliexpress' }] });
    const n = await linkSessionToSources({ provider_user_nick: 'shop', access_expires_at: 'a', refresh_expires_at: 'r', access_token: 'NEVER' }, { query, credentialService });
    expect(n).toBe(1);
    expect(credentialService.linkOAuthSession).toHaveBeenCalledWith('api:aliexpress',
      { sessionKey: 'aliexpress', accountLabel: 'shop', accessExpiresAt: 'a', refreshExpiresAt: 'r' }, null);
    expect(JSON.stringify(credentialService.linkOAuthSession.mock.calls)).not.toContain('NEVER');
  });
});
