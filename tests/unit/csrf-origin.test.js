'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { getAuthCookieName, cookieOptions } = require('../../utils/auth-cookie');
const { csrfOriginGuard } = require('../../middleware/csrf-origin');

function makeReq({ method = 'POST', cookie = false, origin, authorization } = {}) {
  const headers = {};
  if (origin !== undefined) headers.origin = origin;
  if (authorization) headers.authorization = authorization;
  return {
    method,
    headers,
    cookies: cookie ? { [getAuthCookieName()]: 'jwt-value' } : {},
    get(name) { return headers[String(name).toLowerCase()]; },
  };
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

describe('AUTH-8b/c cookie + CSRF origin policy', () => {
  const oldNodeEnv = process.env.NODE_ENV;
  const oldKomerceEnv = process.env.KOMERCE_ENV;
  const oldFrontendUrl = process.env.FRONTEND_URL;
  const oldAllowedOrigins = process.env.ALLOWED_ORIGINS;

  afterEach(() => {
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldNodeEnv;
    if (oldKomerceEnv === undefined) delete process.env.KOMERCE_ENV; else process.env.KOMERCE_ENV = oldKomerceEnv;
    if (oldFrontendUrl === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = oldFrontendUrl;
    if (oldAllowedOrigins === undefined) delete process.env.ALLOWED_ORIGINS; else process.env.ALLOWED_ORIGINS = oldAllowedOrigins;
  });

  it('garde SameSite=Lax par défaut pour les liens entrants WhatsApp/email', () => {
    expect(cookieOptions().sameSite).toBe('Lax');
    expect(cookieOptions().httpOnly).toBe(true);
  });

  it('laisse passer les méthodes sûres même avec cookie sans Origin', () => {
    const next = jest.fn();
    csrfOriginGuard(makeReq({ method: 'GET', cookie: true }), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('laisse passer une mutation sans cookie (webhook/server-to-server/Bearer)', () => {
    const next = jest.fn();
    csrfOriginGuard(makeReq({ authorization: 'Bearer api-token' }), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('refuse une mutation avec cookie quand Origin est absente', () => {
    const next = jest.fn();
    const res = makeRes();
    csrfOriginGuard(makeReq({ cookie: true }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('csrf_origin_required');
  });

  it('refuse une mutation __Host- depuis une Origin étrangère', () => {
    process.env.KOMERCE_ENV = 'production';
    process.env.NODE_ENV = 'production';
    const next = jest.fn();
    const res = makeRes();
    csrfOriginGuard(makeReq({ cookie: true, origin: 'https://evil.example' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('csrf_origin_invalid');
  });

  it('accepte une mutation __Host- depuis komerce.co', () => {
    process.env.KOMERCE_ENV = 'production';
    process.env.NODE_ENV = 'production';
    const next = jest.fn();
    csrfOriginGuard(
      makeReq({ cookie: true, origin: 'https://komerce.co' }),
      makeRes(),
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('accepte une Origin explicitement configurée pour le frontend staging', () => {
    process.env.KOMERCE_ENV = 'staging';
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'https://staging.komerce.example';
    const next = jest.fn();
    csrfOriginGuard(
      makeReq({ cookie: true, origin: 'https://staging.komerce.example' }),
      makeRes(),
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});
